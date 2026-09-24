import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { getStripe, STRIPE_APP_TAG } from "@/lib/stripe";
import { getVenueBySlug } from "@/lib/availability";
import { getBusyRanges } from "@/lib/google-calendar";
import { overlaps } from "@/lib/slots";
import { sendAdminAlert } from "@/lib/mail";
import type { PriceBreakdown } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const MAX_AMOUNT = 1_000_000;
/**
 * 決済リンクの有効期限（時間）。Stripe Checkout Sessionのexpires_atは
 * 作成時点から30分〜24時間以内という制約があるため、24時間を超えられない。
 */
const LINK_VALID_HOURS = 24;

type ManualCheckoutBody = {
  venueSlug?: string;
  startAt?: string; // ISO8601
  endAt?: string; // ISO8601
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  purpose?: string;
  totalAmount?: number;
  customerType?: string; // individual | corporate
  companyName?: string;
};

/**
 * POST /api/admin/manual-checkout
 * 管理者専用: 通常のオンライン予約フォーム（時間帯選択→自動見積）に乗らない
 * 個別交渉案件（定期・長期利用等）向けに、手動で確定した金額でbookingsのpending
 * レコードを作成し、Stripe Checkout SessionのURLを発行する。
 *
 * 既存の /api/checkout と同じ契約（bookings.stripe_session_id と
 * Checkout SessionのIDを一致させる）に乗せることで、決済完了時のWebhook処理
 * （カレンダー登録・確認メール送信・管理者通知）をそのまま利用できる。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: ManualCheckoutBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const venueSlug = (body.venueSlug ?? "").trim();
  const name = (body.customerName ?? "").trim();
  const email = (body.customerEmail ?? "").trim();
  const phone = (body.customerPhone ?? "").trim();
  const purpose = (body.purpose ?? "").trim().slice(0, 500);
  const customerType = body.customerType === "corporate" ? "corporate" : "individual";
  const companyName = (body.companyName ?? "").trim().slice(0, 120);
  const totalAmount = body.totalAmount;

  if (!name || name.length > 100) {
    return NextResponse.json({ error: "お名前を入力してください" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (!/^[0-9+\-() ]{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
  }
  if (customerType === "corporate" && !companyName) {
    return NextResponse.json({ error: "法人の場合は会社名を入力してください" }, { status: 400 });
  }
  if (
    typeof totalAmount !== "number" ||
    !Number.isInteger(totalAmount) ||
    totalAmount < 50 ||
    totalAmount > MAX_AMOUNT
  ) {
    return NextResponse.json(
      { error: `金額は50〜${MAX_AMOUNT.toLocaleString()}の整数で指定してください` },
      { status: 400 }
    );
  }

  // タイムゾーンオフセット必須（"Z" または "+09:00" 等）。省略を許すとVercelのUTC実行環境で
  // JSTから9時間ずれて保存される事故になるため、あいまいな入力はここで拒否する
  const TZ_AWARE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})$/;
  if (!body.startAt || !TZ_AWARE_ISO.test(body.startAt) || !body.endAt || !TZ_AWARE_ISO.test(body.endAt)) {
    return NextResponse.json(
      { error: "利用日時はタイムゾーン付きのISO8601形式で指定してください（例: 2026-10-29T18:00:00+09:00）" },
      { status: 400 }
    );
  }
  const startAt = new Date(body.startAt);
  const endAt = new Date(body.endAt);
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
    return NextResponse.json({ error: "利用日時の形式が正しくありません" }, { status: 400 });
  }
  if (endAt <= startAt) {
    return NextResponse.json({ error: "終了日時は開始日時より後にしてください" }, { status: 400 });
  }
  const now0 = new Date();
  if (startAt.getTime() < now0.getTime() - 60 * 60 * 1000) {
    return NextResponse.json({ error: "開始日時が過去です。日時を確認してください" }, { status: 400 });
  }
  const MAX_SPAN_DAYS = 31;
  if (endAt.getTime() - startAt.getTime() > MAX_SPAN_DAYS * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: `利用期間が長すぎます（最大${MAX_SPAN_DAYS}日）` }, { status: 400 });
  }

  const venue = await getVenueBySlug(venueSlug);
  if (!venue) {
    return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });
  }

  // Googleカレンダーの空き最終確認（fail closed）
  try {
    const busy = await getBusyRanges(venue.calendar_id, startAt, endAt);
    if (busy.some((b) => overlaps({ start: startAt, end: endAt }, b))) {
      return NextResponse.json(
        { error: "この時間帯は既にカレンダー上に予定があります（仮押さえの削除漏れ等をご確認ください）" },
        { status: 409 }
      );
    }
  } catch (e) {
    console.error("[manual-checkout] FreeBusy確認失敗（fail closed）:", e);
    return NextResponse.json(
      { error: "空き状況の確認に失敗しました。時間をおいてお試しください" },
      { status: 503 }
    );
  }

  const hours = (endAt.getTime() - startAt.getTime()) / (60 * 60 * 1000);
  const priceBreakdown: PriceBreakdown = {
    rule: "v2",
    date: startAt.toISOString().slice(0, 10),
    dayType: "weekday",
    pricePerHour: hours > 0 ? Math.round(totalAmount / hours) : totalAmount,
    hours,
    baseSubtotal: totalAmount,
    discount: null,
    options: [],
    optionsSubtotal: 0,
    coupon: null,
    total: totalAmount,
  };

  const db = getDb();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + LINK_VALID_HOURS * 60 * 60 * 1000);

  const { data: bookingId, error: rpcError } = await db.rpc("create_pending_booking", {
    p_user_id: null,
    p_venue_id: venue.id,
    p_start_at: startAt.toISOString(),
    p_end_at: endAt.toISOString(),
    p_customer_name: name,
    p_customer_email: email,
    p_customer_phone: phone,
    p_purpose: purpose,
    p_total_amount: totalAmount,
    p_price_breakdown: priceBreakdown,
    p_expires_at: expiresAt.toISOString(),
    p_price_tier: "standard",
  });

  if (rpcError) {
    if (rpcError.message.includes("slot_taken")) {
      return NextResponse.json({ error: "この時間帯は既に予約が入っています" }, { status: 409 });
    }
    return NextResponse.json(
      { error: `仮押さえ作成エラー: ${rpcError.message}` },
      { status: 500 }
    );
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";
  // 商品名は固定文言にする（purposeの自由入力をそのまま連結するとStripeの名称制限に
  // 抵触しうるため）。詳細はdescriptionとbookings.purposeの側にのみ保存する
  const label = `${venue.name} ご利用料金（個別お見積り）`;

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [
          {
            price_data: {
              currency: "jpy",
              unit_amount: totalAmount,
              product_data: {
                name: label,
                ...(purpose ? { description: purpose.slice(0, 200) } : {}),
              },
            },
            quantity: 1,
          },
        ],
        customer_email: email,
        metadata: { booking_id: bookingId, app: STRIPE_APP_TAG },
        payment_intent_data: { metadata: { booking_id: bookingId, app: STRIPE_APP_TAG } },
        expires_at: Math.floor(now.getTime() / 1000) + LINK_VALID_HOURS * 60 * 60,
        success_url: `${site}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/${venue.slug}?canceled=1`,
      },
      { idempotencyKey: `manual-checkout-${bookingId}` }
    );

    const { error: saveError } = await db
      .from("bookings")
      .update({
        stripe_session_id: session.id,
        customer_type: customerType,
        company_name: companyName || null,
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
        console.error("[manual-checkout] セッション失効失敗:", e);
        await sendAdminAlert(
          "🚨 手動決済リンクの後始末に失敗（要確認）",
          `セッションID保存に失敗し、Stripeセッションの失効にも失敗しました。決済リンクが有効なまま残っている可能性があります。Stripeダッシュボードで確認してください。\n予約ID: ${bookingId}\nセッション: ${session.id}`
        );
      }
      throw new Error(`セッションID保存エラー: ${saveError.message}`);
    }

    return NextResponse.json({ bookingId, checkoutUrl: session.url, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    const { data: expired } = await db
      .from("bookings")
      .update({ booking_status: "expired", updated_at: new Date().toISOString() })
      .eq("id", bookingId)
      .eq("booking_status", "pending")
      .select("id");
    console.error("[manual-checkout]", e);
    if (!expired || expired.length === 0) {
      await sendAdminAlert(
        "🚨 手動決済リンク作成失敗後の後始末に失敗（要確認）",
        `決済ページ作成中にエラーが発生し、仮押さえの失効処理も期待通りに完了しませんでした。予約が中途半端な状態で残っている可能性があります。\n予約ID: ${bookingId}\nエラー: ${String(e)}`
      );
    }
    return NextResponse.json(
      { error: "決済ページの作成に失敗しました。時間をおいてお試しください" },
      { status: 500 }
    );
  }
}
