import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { getStripe, STRIPE_APP_TAG } from "@/lib/stripe";
import { getVenueBySlug } from "@/lib/availability";
import { getBusyRanges } from "@/lib/google-calendar";
import { buildQuote, QuoteError } from "@/lib/quote";
import { getSessionUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { calcInvoiceDueAt, createAndSendInvoice, isInvoiceEligible } from "@/lib/invoice";
import { sendAdminAlert, sendMail } from "@/lib/mail";
import {
  jstToUtc,
  overlaps,
  validateBookingRequest,
  hourToTimeStr,
  formatDuration,
  PENDING_HOLD_MINUTES,
} from "@/lib/slots";

export const dynamic = "force-dynamic";

type CheckoutBody = {
  venueSlug: string;
  date: string; // 'YYYY-MM-DD' (JST)
  startHour: number;
  hours: number;
  name: string;
  email: string;
  phone: string;
  purpose?: string;
  optionIds?: string[];
  couponCode?: string;
  customerType?: string; // individual | corporate
  companyName?: string;
  partySize?: number;
  paymentMethod?: string; // card | invoice
};

/**
 * POST /api/checkout
 * 仮押さえ（pending予約）を作成し、Stripe CheckoutのURLを返す。
 * 金額は必ずサーバー側で計算する（クライアントから受け取らない）。
 */
export async function POST(req: NextRequest) {
  // 簡易レートリミット（IP単位）
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`checkout:${ip}`)) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
      { status: 429 }
    );
  }

  let body: CheckoutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  // --- 入力バリデーション ---
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim();
  if (!name || name.length > 100) {
    return NextResponse.json({ error: "お名前を入力してください" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (!/^[0-9+\-() ]{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
  }
  const customerType = body.customerType === "corporate" ? "corporate" : "individual";
  const companyName = (body.companyName ?? "").trim().slice(0, 120);
  // 利用人数（1〜100名。不正値は1名扱い）
  const partySize =
    Number.isInteger(body.partySize) && body.partySize! >= 1 && body.partySize! <= 100
      ? body.partySize!
      : 1;
  const paymentMethod = body.paymentMethod === "invoice" ? "invoice" : "card";
  if (customerType === "corporate" && !companyName) {
    return NextResponse.json({ error: "会社名を入力してください" }, { status: 400 });
  }
  if (paymentMethod === "invoice" && customerType !== "corporate") {
    return NextResponse.json({ error: "請求書払いは法人のお客様向けです" }, { status: 400 });
  }

  try {
    const venue = await getVenueBySlug(body.venueSlug ?? "");
    if (!venue) {
      return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });
    }

    const now = new Date();
    const validationError = validateBookingRequest(
      venue,
      body.date,
      body.startHour,
      body.hours,
      now
    );
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const startAt = jstToUtc(body.date, body.startHour);
    const endAt = jstToUtc(body.date, body.startHour + body.hours);

    // --- Googleカレンダーを直前再確認（他サイト予約との競合チェック・fail closed） ---
    try {
      const busy = await getBusyRanges(venue.calendar_id, startAt, endAt);
      if (busy.some((b) => overlaps({ start: startAt, end: endAt }, b))) {
        return NextResponse.json(
          { error: "申し訳ありません。この時間帯は先に予約が入りました" },
          { status: 409 }
        );
      }
    } catch (e) {
      console.error("[checkout] FreeBusy確認失敗（fail closed）:", e);
      return NextResponse.json(
        { error: "空き状況の確認に失敗しました。時間をおいてお試しください" },
        { status: 503 }
      );
    }

    // --- 価格計算（サーバー側。休日料金・割引・オプション・クーポン込み） ---
    let breakdown;
    try {
      breakdown = await buildQuote(
        venue,
        body.date,
        body.startHour,
        body.hours,
        Array.isArray(body.optionIds) ? body.optionIds : [],
        typeof body.couponCode === "string" ? body.couponCode : "",
        now
      );
    } catch (e) {
      if (e instanceof QuoteError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    // 本人専用クーポン（自動配布分）は、宛先メールでの予約のみ許可。
    // さらにログイン中の場合はログインメールとの一致も要求（他人のクーポンコードの流用を防ぐ）。
    if (breakdown.coupon) {
      const { data: couponRow } = await getDb()
        .from("coupons")
        .select("restrict_email")
        .ilike("code", breakdown.coupon.code)
        .maybeSingle<{ restrict_email: string | null }>();
      const restrictEmail = couponRow?.restrict_email?.toLowerCase();
      if (restrictEmail) {
        const loginEmail = (await getSessionUser())?.email?.toLowerCase() ?? null;
        const mismatch =
          restrictEmail !== email.toLowerCase() ||
          (loginEmail !== null && loginEmail !== restrictEmail);
        if (mismatch) {
          return NextResponse.json(
            { error: "このクーポンはお届けした方ご本人さま専用です。クーポンが届いたメールアドレスでご予約ください" },
            { status: 400 }
          );
        }
      }
    }
    // Stripeの最低決済額（¥50）未満は決済できない
    if (breakdown.total < 50) {
      return NextResponse.json(
        { error: "クーポン適用後の金額が小さすぎるため、このクーポンは利用できません" },
        { status: 400 }
      );
    }

    // --- 請求書払いの適格性チェック（法人＋利用開始72時間以上前） ---
    if (paymentMethod === "invoice" && !isInvoiceEligible(startAt, now)) {
      return NextResponse.json(
        { error: "請求書払いは利用開始の3日（72時間）前までのご予約で選択できます。カード決済をご利用ください" },
        { status: 400 }
      );
    }

    // --- 仮押さえ作成（DB関数：期限切れ掃除→INSERTを同一トランザクションで） ---
    // ログイン中ならマイページ用に会員IDを紐付ける（ゲスト予約はnull）
    const sessionUser = await getSessionUser();
    const db = getDb();
    // カード=30分 / 請求書=支払期限まで枠を保持
    const expiresAt =
      paymentMethod === "invoice"
        ? calcInvoiceDueAt(startAt, now)
        : new Date(now.getTime() + PENDING_HOLD_MINUTES * 60 * 1000);
    const { data: bookingId, error: rpcError } = await db.rpc("create_pending_booking", {
      p_user_id: sessionUser?.id ?? null,
      p_venue_id: venue.id,
      p_start_at: startAt.toISOString(),
      p_end_at: endAt.toISOString(),
      p_customer_name: name,
      p_customer_email: email,
      p_customer_phone: phone,
      p_purpose: (body.purpose ?? "").trim().slice(0, 500),
      p_total_amount: breakdown.total,
      p_price_breakdown: breakdown,
      p_expires_at: expiresAt.toISOString(),
    });

    if (rpcError) {
      if (rpcError.message.includes("slot_taken")) {
        return NextResponse.json(
          { error: "申し訳ありません。この時間帯は先に予約が入りました" },
          { status: 409 }
        );
      }
      if (rpcError.message.includes("too_many_pending")) {
        return NextResponse.json(
          { error: "未決済の仮予約が多すぎます。30分ほど待つか、決済を完了してください" },
          { status: 429 }
        );
      }
      throw new Error(`仮押さえ作成エラー: ${rpcError.message}`);
    }

    const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    const endHour = body.startHour + body.hours;
    const label = `${venue.name} ${body.date} ${hourToTimeStr(body.startHour)}〜${hourToTimeStr(endHour)}（${formatDuration(body.hours)}）`;

    // ===== 請求書払い（法人・銀行振込）フロー =====
    if (paymentMethod === "invoice") {
      try {
        const { invoiceId, hostedInvoiceUrl } = await createAndSendInvoice({
          bookingId,
          email,
          customerName: name,
          companyName,
          description: `レンタルスペース利用料 ${label}`,
          amount: breakdown.total,
          dueAt: expiresAt,
        });
        await db
          .from("bookings")
          .update({
            payment_method: "invoice",
            customer_type: customerType,
            company_name: companyName,
            party_size: partySize,
            stripe_invoice_id: invoiceId,
            coupon_code: breakdown.coupon?.code ?? null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", bookingId);
        await sendAdminAlert(
          `請求書発行（入金待ち） ${venue.name}`,
          [
            `法人の請求書払い予約が入りました。入金が確認されると自動確定します。`,
            ``,
            `拠点: ${label}`,
            `会社: ${companyName}（${name}様）`,
            `人数: ${partySize}名`,
            `メール: ${email}`,
            `金額: ¥${breakdown.total.toLocaleString()}`,
            `支払期限: ${expiresAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
            `予約ID: ${bookingId}`,
          ].join("\n")
        );
        // 自社ブランドの受付確認メール（Stripe発の請求書メールが迷惑メール判定された場合の保険）
        await sendMail({
          to: email,
          subject: `【仮予約受付】${label} のご請求書について`,
          text: [
            `${name} 様`,
            ``,
            `ご予約ありがとうございます。以下の内容で仮予約を受け付けました。`,
            `お支払い（銀行振込）の確認をもって本予約が確定します。`,
            ``,
            `▼ご予約内容`,
            `拠点: ${label}`,
            `会社: ${companyName}`,
            `金額: ¥${breakdown.total.toLocaleString()}`,
            `お支払い期限: ${expiresAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}`,
            ``,
            hostedInvoiceUrl
              ? [`▼請求書（お振込先はこちらから確認できます）`, hostedInvoiceUrl].join("\n")
              : `請求書（お振込先記載）は別途Stripeよりメールでお送りしています。`,
            ``,
            `お支払い期限までに入金が確認できない場合、本予約は自動的にキャンセルとなりますのでご注意ください。`,
            ``,
            `ブルーステージ合同会社`,
          ].join("\n"),
        });
        return NextResponse.json({
          invoiceFlow: true,
          bookingId,
          hostedInvoiceUrl,
          dueAt: expiresAt.toISOString(),
        });
      } catch (e) {
        console.error("[checkout] 請求書発行失敗:", e);
        await db
          .from("bookings")
          .update({ booking_status: "expired", updated_at: new Date().toISOString() })
          .eq("id", bookingId)
          .eq("booking_status", "pending");
        await sendAdminAlert(
          "🚨 請求書発行失敗",
          `Stripe請求書の発行に失敗しました。銀行振込（customer_balance）がStripeで有効か確認してください。\nエラー: ${String(e)}`
        );
        return NextResponse.json(
          { error: "請求書の発行に失敗しました。お手数ですがカード決済をご利用いただくか、お問い合わせください" },
          { status: 500 }
        );
      }
    }

    // ===== カード決済（Stripe Checkout）フロー =====

    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "jpy",
              unit_amount: breakdown.total,
              product_data: { name: label },
            },
            quantity: 1,
          },
        ],
        customer_email: email,
        metadata: { booking_id: bookingId, app: STRIPE_APP_TAG },
        payment_intent_data: { metadata: { booking_id: bookingId, app: STRIPE_APP_TAG } },
        // 仮押さえと同じ30分で失効させる（Stripeの最短は30分）
        expires_at: Math.floor(now.getTime() / 1000) + PENDING_HOLD_MINUTES * 60,
        success_url: `${site}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/${venue.slug}?canceled=1`,
      });

      // セッションIDと実際の失効時刻を保存。
      // この保存に失敗するとWebhook側の照合が必ず失敗する（支払済みなのに未確定）ため、
      // 失敗時はセッションを失効させて予約も解放し、エラーを返す。
      const { error: saveError } = await db
        .from("bookings")
        .update({
          stripe_session_id: session.id,
          coupon_code: breakdown.coupon?.code ?? null,
          customer_type: customerType,
          company_name: companyName || null,
          party_size: partySize,
          expires_at: session.expires_at
            ? new Date(session.expires_at * 1000).toISOString()
            : expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingId)
        .eq("booking_status", "pending")
        .select("id")
        .single();
      if (saveError) {
        try {
          await stripe.checkout.sessions.expire(session.id);
        } catch (e) {
          console.error("[checkout] セッション失効失敗:", e);
        }
        throw new Error(`セッションID保存エラー: ${saveError.message}`);
      }

      return NextResponse.json({ url: session.url });
    } catch (e) {
      // Stripeセッション作成に失敗したら仮押さえを解放する
      await db
        .from("bookings")
        .update({ booking_status: "expired", updated_at: new Date().toISOString() })
        .eq("id", bookingId)
        .eq("booking_status", "pending");
      throw e;
    }
  } catch (e) {
    console.error("[checkout]", e);
    return NextResponse.json(
      { error: "決済ページの作成に失敗しました。時間をおいてお試しください" },
      { status: 500 }
    );
  }
}
