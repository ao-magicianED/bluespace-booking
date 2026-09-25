import { after, NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getDb } from "@/lib/supabase";
import { getStripe, STRIPE_APP_TAG } from "@/lib/stripe";
import { getVenueBySlug } from "@/lib/availability";
import { getBusyRanges } from "@/lib/google-calendar";
import { resolveTier } from "@/lib/entry-tier";
import { buildQuote, checkCouponRestrictEmail, QuoteError } from "@/lib/quote";
import { getSessionUser } from "@/lib/auth-server";
import { checkRateLimit } from "@/lib/rate-limit";
import { calcInvoiceDueAt, createAndSendInvoice, isInvoiceEligible } from "@/lib/invoice";
import { sendAdminAlert, sendMail } from "@/lib/mail";
import { notifyPendingPayment, runNotifyWithSlowLog } from "@/lib/pending-payment-mail";
import { CheckoutAbortError, rollbackCheckout } from "@/lib/checkout-rollback";
import { scheduleAfterResponse } from "@/lib/after-response";
import { siteUrl } from "@/lib/site-url";
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
  /** 予約フォームは "[カテゴリ] 詳細"（usage-categories.ts の formatPurpose）で送る。旧来の自由記述もそのまま受け付ける */
  purpose?: string;
  optionIds?: string[];
  couponCode?: string;
  customerType?: string; // individual | corporate
  companyName?: string;
  partySize?: number;
  paymentMethod?: string; // card | invoice
  /**
   * 画面に表示した合計金額（必須）。サーバーは価格の権威としては一切使わず、
   * 再計算した合計と一致しないときは409を返して再見積させる
   * （管理者が料金を変更した瞬間に決済した利用者が、表示と違う金額で請求される事故を防ぐ）。
   * 省略で整合チェックを迂回できないよう、非負整数でなければ400。
   */
  expectedTotal?: number;
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
  // 表示額の同意確認は必須（省略で迂回させない）。古い画面からの送信は再読み込みを促す
  if (
    typeof body.expectedTotal !== "number" ||
    !Number.isInteger(body.expectedTotal) ||
    body.expectedTotal < 0
  ) {
    return NextResponse.json(
      { error: "画面の情報が古い可能性があります。ページを再読み込みして、もう一度お手続きください" },
      { status: 400 }
    );
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

    // ログイン中ユーザー（本人専用クーポンの判定と、マイページ用の会員ID紐付けに使う。ゲスト予約はnull）
    const sessionUser = await getSessionUser();

    // --- 価格計算（サーバー側。休日料金・時間帯別料金・割引・オプション・クーポン込み） ---
    // ティアはCookie（署名＋DB照合）のみで判定。bodyのティア指定は一切読まない（R2）
    const tier = await resolveTier();
    let breakdown;
    try {
      breakdown = await buildQuote(
        venue,
        body.date,
        body.startHour,
        body.hours,
        Array.isArray(body.optionIds) ? body.optionIds : [],
        typeof body.couponCode === "string" ? body.couponCode : "",
        now,
        tier
      );
    } catch (e) {
      if (e instanceof QuoteError) {
        return NextResponse.json({ error: e.message }, { status: e.status });
      }
      throw e;
    }
    // 表示額と再計算額の整合チェック（見積→決済の間に料金が変わっていたら再見積させる）
    if (body.expectedTotal !== breakdown.total) {
      return NextResponse.json(
        { error: "価格が更新されました。金額をご確認のうえ、もう一度お手続きください" },
        { status: 409 }
      );
    }
    // 本人専用クーポン（自動配布分）はログイン必須とし、認証済みのログインメール一致のみで許可。
    // 予約フォームの自由入力メールでは判定しない（コードと宛先を知る第三者の流用・枠の使い潰しを防ぐ）。
    if (breakdown.coupon) {
      const { data: couponRow, error: couponFetchError } = await getDb()
        .from("coupons")
        .select("restrict_email")
        .ilike("code", breakdown.coupon.code)
        .maybeSingle<{ restrict_email: string | null }>();
      // 取得失敗時に本人確認が素通りしないようfail closed
      if (couponFetchError) {
        return NextResponse.json(
          { error: "クーポンの確認に失敗しました。時間をおいてお試しください" },
          { status: 503 }
        );
      }
      const restrictEmail = couponRow?.restrict_email;
      if (restrictEmail) {
        const couponError = checkCouponRestrictEmail(restrictEmail, sessionUser?.email);
        if (couponError) {
          return NextResponse.json({ error: couponError.message }, { status: couponError.status });
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
      // 集計用のティア列。RPC内で予約INSERTと同時に保存し、breakdown.tierとの一致も検証される
      p_price_tier: breakdown.tier ?? "standard",
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

    // セッション作成後に起きた想定外の例外（CAS クエリの throw・レスポンス構築の失敗等）でも
    // 作成済みセッションを失効できるよう、ID は catch の外側に保持する
    let createdSessionId: string | null = null;

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
        // 仮押さえと同じ30分で失効させる（Stripeの最短は30分）。
        // 処理開始時の now ではなく作成直前の時刻を基準にする（FreeBusy・見積・RPC の処理時間ぶん
        // Stripe から見た期限が30分を下回るのを防ぐ）。さらに安全マージン（定数のコメント参照）を
        // 加算し、通信時間・秒境界・時計差で作成が間欠的に拒否されるのを防ぐ。
        // DB・メールの期限は Stripe が返す実値を使う
        expires_at: Math.floor(Date.now() / 1000) + PENDING_HOLD_MINUTES * 60 + STRIPE_EXPIRY_SAFETY_SECONDS,
        success_url: `${site}/thanks?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${site}/${venue.slug}?canceled=1`,
      });
      createdSessionId = session.id;

      // Stripe が決済URLを返さなかった場合は決済不能。セッションIDを保存せず、外側の catch で
      // 仮押さえ解放→セッション失効の順に巻き戻す（「URL の無い pending」を残さない）
      if (!session.url) {
        throw new CheckoutAbortError("Stripe Checkout URL が返されませんでした", session.id);
      }
      // after() のクロージャ内では型の絞り込みが効かないため、ここで string として確定させる
      const checkoutUrl: string = session.url;
      // Stripe が返した実際の失効時刻を DB とメールの権威にする
      const sessionExpiresAt = session.expires_at
        ? new Date(session.expires_at * 1000)
        : expiresAt;

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
          expires_at: sessionExpiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingId)
        .eq("booking_status", "pending")
        .select("id")
        .single();
      if (saveError) {
        // 外側の catch で仮押さえ解放→セッション失効の順に巻き戻す
        throw new CheckoutAbortError(`セッションID保存エラー: ${saveError.message}`, session.id);
      }

      // --- 仮予約受付メール（Checkout URL入り）---
      // 決済画面を閉じてしまった利用者が、期限内なら同じセッションで支払いを再開できるようにする。
      // 必ず CAS 成功後に登録する（保存失敗→巻き戻し後に「生きて見える決済リンク」だけが残るのを防ぐ）。
      // after() でレスポンス返却後に実行する: 利用者を待たせず、Vercel は after() の完了（関数の最大実行時間内）
      // まで関数を維持する。after() が追跡するのはコールバックが返す Promise までなので、通知は最後まで
      // await し、遅いときはログを出すだけにする（タイマー側を先に解決させて打ち切ると追跡外になる）。
      // after() の登録自体が throw する環境でも決済本体に波及させず、その場で実行する（この経路だけ総時間上限つき・超過時は URL 応答を優先）。
      // 応答は登録前に構築する（登録後に応答生成が throw すると、巻き戻し後に失効した URL の
      // メールが送られる経路ができるため）
      const response = NextResponse.json({ url: checkoutUrl });
      await scheduleAfterResponse(
        after,
        async () => {
          await runNotifyWithSlowLog(
            () =>
              notifyPendingPayment(
                {
                  bookingId,
                  sessionId: session.id,
                  email,
                  phone,
                  customerName: name,
                  label,
                  partySize,
                  amount: breakdown.total,
                  checkoutUrl,
                  expiresAt: sessionExpiresAt,
                  rebookUrl: `${siteUrl()}/${venue.slug}`,
                },
                {
                  sendMail,
                  sendAdminAlert,
                  markSent: async (id, sentAtIso) => {
                    const { error } = await db
                      .from("bookings")
                      .update({ pending_payment_email_sent_at: sentAtIso })
                      .eq("id", id);
                    return { error };
                  },
                }
              ),
            {
              slowAfterMs: PENDING_MAIL_SLOW_LOG_MS,
              onSlow: () =>
                console.error(
                  `[checkout] 仮予約受付メール処理が ${PENDING_MAIL_SLOW_LOG_MS}ms を超過（完了まで待機中）booking=${bookingId}`
                ),
              onError: (e) => console.error("[checkout] 仮予約受付メール処理エラー:", e),
            }
          );
        },
        {
          onRegisterError: (e) => console.error("[checkout] after() への登録に失敗（その場で実行）:", e),
          onFallbackTimeout: () =>
            console.error(
              `[checkout] after() 未対応環境での受付メール処理が ${PENDING_MAIL_FALLBACK_TIMEOUT_MS}ms 以内に完了せず、URL 応答を優先（メールは届かない可能性）booking=${bookingId}`
            ),
        },
        PENDING_MAIL_FALLBACK_TIMEOUT_MS
      );

      return response;
    } catch (e) {
      // セッション作成・URL取得・セッションID保存のいずれかに失敗したら仮押さえを解放し、
      // 作成済みのセッションがあれば失効させる（順序は DB → Stripe。checkout-rollback.ts 参照）
      // CheckoutAbortError（想定内の中断）以外の想定外の例外でも、作成済みセッションがあれば失効させる
      const sessionId = e instanceof CheckoutAbortError ? e.sessionId : createdSessionId;
      await rollbackCheckout(
        { bookingId, sessionId, reason: e instanceof Error ? e.message : String(e) },
        {
          releaseBooking: async () => {
            const { error } = await db
              .from("bookings")
              .update({ booking_status: "expired", updated_at: new Date().toISOString() })
              .eq("id", bookingId)
              .eq("booking_status", "pending");
            return { error };
          },
          expireSession: (id) => getStripe().checkout.sessions.expire(id, STRIPE_ROLLBACK_REQUEST_OPTIONS),
        }
      );
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

/** 受付メール処理の遅延観測の閾値。超えてもログを出すだけで、通知は最後まで await する（after() が追跡するのはコールバックの Promise まで） */
const PENDING_MAIL_SLOW_LOG_MS = 8000;

/**
 * after() が使えない環境で inline 実行にフォールバックしたときの総時間上限。
 * 超過時は劣化ログを残して URL 応答を優先する（メールは届かない可能性。after() 側は上限なし）
 */
const PENDING_MAIL_FALLBACK_TIMEOUT_MS = 8000;

/**
 * Stripe Checkout の失効までの安全マージン（秒）。Stripe の下限は「セッション作成から30分」で、
 * ちょうど30分を指定すると通信時間・秒境界・時計差で作成が間欠的に拒否され得る。
 * DB・メールの期限は Stripe が返す実値を使うので、実際の猶予は31分程度になる。
 */
const STRIPE_EXPIRY_SAFETY_SECONDS = 60;

/** 巻き戻し時の Stripe 呼び出しは短い時間上限・再試行なし（DB 解放後の best-effort） */
const STRIPE_ROLLBACK_REQUEST_OPTIONS: Stripe.RequestOptions = { timeout: 10_000, maxNetworkRetries: 0 };
