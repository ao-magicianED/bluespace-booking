import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, STRIPE_APP_TAG } from "@/lib/stripe";
import { getDb } from "@/lib/supabase";
import { runConfirmationSideEffects, formatBookingPeriod } from "@/lib/confirm";
import { sendMail, sendAdminAlert } from "@/lib/mail";
import { adminBookingUrl, myBookingUrl } from "@/lib/site-url";
import type { Booking, BookingAdjustment, BookingChangeRequest, Venue } from "@/lib/types";
import { applyApprovedTimeChange } from "@/lib/apply-time-change";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe
 * Stripeからの決済イベント受信。
 * - 署名検証必須
 * - stripe_eventsテーブルでイベントID重複排除（再送対策）
 * - 状態遷移は WHERE booking_status='pending' で原子的に（順序ずれ対策）
 * - 金額・セッションIDを照合してから確定（改ざん・取り違え対策）
 */
export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET 未設定");
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "signature missing" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await req.text();
    event = getStripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch (e) {
    console.error("[webhook] 署名検証失敗:", e);
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const db = getDb();

  // --- 冪等化: 同じイベントは一度しか処理しない（status方式） ---
  // processing/processed → 重複としてスキップ / failed → 再送時に再処理を許可
  const { error: dupError } = await db
    .from("stripe_events")
    .insert({ event_id: event.id, type: event.type, status: "processing" });
  if (dupError) {
    if (dupError.code === "23505") {
      const { data: existing } = await db
        .from("stripe_events")
        .select("status")
        .eq("event_id", event.id)
        .single();
      if (existing?.status !== "failed") {
        // 処理済み（または処理中）の再送 → 正常終了
        return NextResponse.json({ received: true, duplicate: true });
      }
      // 前回失敗 → 再処理する
      await db
        .from("stripe_events")
        .update({ status: "processing", processed_at: new Date().toISOString() })
        .eq("event_id", event.id);
    } else {
      console.error("[webhook] イベント記録失敗:", dupError);
      return NextResponse.json({ error: "event log failed" }, { status: 500 });
    }
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "checkout.session.expired":
        await handleExpired(event.data.object as Stripe.Checkout.Session);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;
      case "invoice.voided":
      case "invoice.marked_uncollectible":
        await handleInvoiceVoided(event.data.object as Stripe.Invoice);
        break;
      case "refund.failed":
        await handleRefundFailed(event.data.object as Stripe.Refund);
        break;
      default:
        break;
    }
    await db.from("stripe_events").update({ status: "processed" }).eq("event_id", event.id);
    return NextResponse.json({ received: true });
  } catch (e) {
    console.error(`[webhook] 処理失敗 (${event.type}):`, e);
    // failedにしてから500を返す → Stripeの再送時に再処理される
    await db.from("stripe_events").update({ status: "failed" }).eq("event_id", event.id);
    await sendAdminAlert(
      "⚠️ Webhook処理失敗（要確認）",
      `イベント: ${event.id} (${event.type})\nエラー: ${String(e)}\nStripeから自動再送されます。`
    );
    return NextResponse.json({ error: "processing failed" }, { status: 500 });
  }
}

async function handleCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // 追加請求（料金増額）の決済完了
  if (session.metadata?.adjustment_id) {
    await handleAdjustmentCompleted(session);
    return;
  }
  // 予約時間変更（延長）の決済完了
  if (session.metadata?.change_request_id) {
    await handleChangeRequestCompleted(session);
    return;
  }

  const db = getDb();
  const bookingId = session.metadata?.booking_id;
  if (!bookingId) {
    if (session.metadata?.app !== STRIPE_APP_TAG) {
      // 同一Stripeアカウントを共有する他サービス（あおサロン等）の決済。
      // このシステムが作成したCheckout Sessionではないため何もしない。
      // 新しいサービスが同じStripeアカウントに追加されても、appタグを持たない限り自動的に無視される
      return;
    }
    await sendAdminAlert(
      "⚠️ booking_idのない決済を検知",
      `Checkoutセッション ${session.id} にbooking_idがありません。Stripeダッシュボードで確認してください。`
    );
    return;
  }

  const { data: booking, error } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (error) throw new Error(`予約取得エラー: ${error.message}`);

  // --- 検証5点セット（1つでも不一致なら確定しない） ---
  const problems: string[] = [];
  if (!booking) problems.push("予約が存在しない");
  if (booking && booking.stripe_session_id !== session.id) problems.push("セッションID不一致");
  if (session.payment_status !== "paid") problems.push(`payment_status=${session.payment_status}`);
  if (booking && session.amount_total !== booking.total_amount) {
    problems.push(`金額不一致 (stripe=${session.amount_total}, db=${booking.total_amount})`);
  }
  if (session.currency !== "jpy") problems.push(`通貨不一致 (${session.currency})`);

  if (!booking || problems.length > 0) {
    await sendAdminAlert(
      "🚨 決済検証エラー（返金調査が必要な可能性）",
      [
        `決済は完了しましたが、予約の検証に失敗したため自動確定しませんでした。`,
        `Stripeダッシュボードで決済内容を確認し、必要なら返金してください。`,
        ``,
        `予約ID: ${bookingId}`,
        `セッション: ${session.id}`,
        `問題: ${problems.join(" / ")}`,
      ].join("\n")
    );
    return;
  }

  // --- 原子的に確定（pendingのときだけ。confirmedを上書きしない） ---
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { data: updated, error: updError } = await db
    .from("bookings")
    .update({
      booking_status: "confirmed",
      payment_status: "paid",
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("booking_status", "pending")
    .select("id");
  if (updError) throw new Error(`予約確定エラー: ${updError.message}`);

  let freshlyConfirmed = (updated ?? []).length > 0;
  if (!freshlyConfirmed && booking.booking_status === "confirmed") {
    // すでに確定済み（イベント再送など）→ 何もしない
    return;
  }
  if (!freshlyConfirmed && booking.booking_status === "expired") {
    // 期限切れ後に決済完了が届いたレアケース → 復旧を試みる。
    // expired→confirmedへの更新は排他制約の対象に戻るため、
    // 枠が他の予約に取られていればDBが拒否する（その場合のみ返金対応）。
    const { data: recovered, error: recoverError } = await db
      .from("bookings")
      .update({
        booking_status: "confirmed",
        payment_status: "paid",
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .eq("booking_status", "expired")
      .select("id");
    if (!recoverError && (recovered ?? []).length > 0) {
      freshlyConfirmed = true;
    }
  }
  if (!freshlyConfirmed) {
    // 復旧もできなかった（枠が他の予約で埋まった等）→ 人の判断が必要
    await sendAdminAlert(
      "🚨 期限切れ予約への決済を検知（返金確認）",
      [
        `決済完了時点で予約が ${booking.booking_status} で、枠の復旧もできませんでした。`,
        `枠が別の予約で埋まっている可能性があります。Stripeで返金し、お客様へ連絡してください。`,
        ``,
        `予約ID: ${bookingId}`,
        `日時: ${formatBookingPeriod(booking)}`,
        `お客様: ${booking.customer_name} <${booking.customer_email}>`,
      ].join("\n")
    );
    return;
  }

  // クーポン使用回数を消化（確定した予約のみ・原子的に上限チェック）
  if (booking.coupon_code) {
    const { data: consumed, error: couponError } = await db.rpc("increment_coupon_use", {
      p_code: booking.coupon_code,
    });
    if (couponError) {
      console.error("[webhook] クーポン消化エラー:", couponError.message);
    } else if (consumed === false) {
      // 既に上限到達済み＝同一クーポンの二重使用。決済は済んでいるため確定は維持し、人手で確認/返金判断
      await sendAdminAlert(
        "⚠️ クーポン利用上限を超えた決済を検知",
        [
          `利用上限に達したクーポンで決済が完了しました（同一クーポンの重複利用の可能性）。`,
          `必要に応じて差額請求または返金をご検討ください。`,
          ``,
          `クーポン: ${booking.coupon_code}`,
          `予約ID: ${bookingId}`,
          `日時: ${formatBookingPeriod(booking)}`,
          `お客様: ${booking.customer_name} <${booking.customer_email}>`,
        ].join("\n")
      );
    }
  }

  // --- 確定後の副作用（カレンダー登録・メール）---
  const { data: venue } = await db
    .from("venues")
    .select("*")
    .eq("id", booking.venue_id)
    .single<Venue>();
  if (venue) {
    const confirmedBooking: Booking = {
      ...booking,
      booking_status: "confirmed",
      payment_status: "paid",
    };
    await runConfirmationSideEffects(confirmedBooking, venue, true);
  }
}

/** 請求書払い: 銀行振込の入金確認 → 予約確定（カード決済と同じ後続処理に合流） */
async function handleInvoicePaid(invoice: Stripe.Invoice): Promise<void> {
  const db = getDb();
  const bookingId = invoice.metadata?.booking_id;
  if (!bookingId) return; // 予約システム外の請求書（手動発行等）は無視

  const { data: booking, error } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (error) throw new Error(`予約取得エラー: ${error.message}`);

  // 検証（カード決済と同じ思想: 1つでも不一致なら自動確定しない）
  const problems: string[] = [];
  if (!booking) problems.push("予約が存在しない");
  if (booking && booking.stripe_invoice_id !== invoice.id) problems.push("請求書ID不一致");
  if ((invoice.amount_paid ?? 0) < (booking?.total_amount ?? Infinity)) {
    problems.push(`入金額不足 (paid=${invoice.amount_paid}, db=${booking?.total_amount})`);
  }
  if (invoice.currency !== "jpy") problems.push(`通貨不一致 (${invoice.currency})`);

  if (!booking || problems.length > 0) {
    await sendAdminAlert(
      "🚨 請求書入金の検証エラー（要確認）",
      [
        `銀行振込の入金がありましたが、予約の検証に失敗したため自動確定しませんでした。`,
        `Stripeダッシュボードで請求書を確認してください。`,
        ``,
        `予約ID: ${bookingId}`,
        `請求書: ${invoice.id}`,
        `問題: ${problems.join(" / ")}`,
      ].join("\n")
    );
    return;
  }

  // 原子的に確定（pendingのときだけ）。期限ギリギリの入金で expired になっていた場合は復旧を試みる
  const { data: updated, error: updError } = await db
    .from("bookings")
    .update({
      booking_status: "confirmed",
      payment_status: "paid",
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId)
    .eq("booking_status", "pending")
    .select("id");
  if (updError) throw new Error(`予約確定エラー: ${updError.message}`);

  let freshlyConfirmed = (updated ?? []).length > 0;
  if (!freshlyConfirmed && booking.booking_status === "confirmed") return; // 再送
  if (!freshlyConfirmed && booking.booking_status === "expired") {
    const { data: recovered } = await db
      .from("bookings")
      .update({
        booking_status: "confirmed",
        payment_status: "paid",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId)
      .eq("booking_status", "expired")
      .select("id");
    if ((recovered ?? []).length > 0) freshlyConfirmed = true;
  }
  if (!freshlyConfirmed) {
    await sendAdminAlert(
      "🚨 期限切れ請求書への入金を検知（返金確認）",
      [
        `入金時点で予約が ${booking.booking_status} で、枠の復旧もできませんでした。`,
        `枠が別の予約で埋まっている可能性があります。Stripeで返金し、お客様へ連絡してください。`,
        ``,
        `予約ID: ${bookingId}`,
        `日時: ${formatBookingPeriod(booking)}`,
        `お客様: ${booking.customer_name} <${booking.customer_email}>`,
      ].join("\n")
    );
    return;
  }

  if (booking.coupon_code) {
    const { error: couponError } = await db.rpc("increment_coupon_use", { p_code: booking.coupon_code });
    if (couponError) console.error("[webhook] クーポン消化エラー:", couponError.message);
  }

  const { data: venue } = await db.from("venues").select("*").eq("id", booking.venue_id).single<Venue>();
  if (venue) {
    const confirmedBooking: Booking = { ...booking, booking_status: "confirmed", payment_status: "paid" };
    await runConfirmationSideEffects(confirmedBooking, venue, true);
  }
}

/**
 * 請求書が無効化された（Cronの期限切れ処理・Stripeダッシュボードからの手動void等）→ 仮押さえを解放。
 * Cron側（/api/cron/maintenance）で既に期限切れ処理済みの場合は更新0件になるため、
 * その場合は通知せず二重送信を防ぐ（Cron側が既にお客様・管理者へ通知済みのため）。
 */
async function handleInvoiceVoided(invoice: Stripe.Invoice): Promise<void> {
  const db = getDb();
  const bookingId = invoice.metadata?.booking_id;
  if (!bookingId) return;

  const { data: updated, error } = await db
    .from("bookings")
    .update({ booking_status: "expired", updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("stripe_invoice_id", invoice.id as string)
    .eq("booking_status", "pending")
    .select("*");
  if (error) throw new Error(`請求書無効化処理エラー: ${error.message}`);
  const booking = ((updated ?? []) as Booking[])[0];
  if (!booking) return; // 既に処理済み（Cron等）

  const { data: venue } = await db
    .from("venues")
    .select("name")
    .eq("id", booking.venue_id)
    .maybeSingle<{ name: string }>();
  const period = formatBookingPeriod(booking);

  await sendMail({
    to: booking.customer_email,
    subject: `【ご予約キャンセルのお知らせ】${venue?.name ?? ""} ${period}`,
    text: [
      `${booking.customer_name} 様`,
      "",
      "請求書が無効化されたため、以下のご予約はキャンセルされました。",
      "",
      `スペース: ${venue?.name ?? ""}`,
      `日時: ${period}`,
      "",
      "引き続きご利用をご希望の場合は、お手数ですが再度ご予約ください。",
      "ご不明な点がございましたら、このメールへの返信でご連絡ください。",
      "ブルーステージ合同会社",
    ].join("\n"),
  });
  await sendAdminAlert(
    "請求書の無効化により予約をキャンセルしました",
    [
      `Stripe側で請求書が無効化(void / uncollectible)されたため、予約を自動キャンセルしました。`,
      `管理画面から手動でvoidした場合はこの通知は想定通りです。心当たりがない場合はStripeダッシュボードをご確認ください。`,
      ``,
      `拠点: ${venue?.name ?? ""}`,
      `日時: ${period}`,
      `お客様: ${booking.customer_name} <${booking.customer_email}>`,
      `予約ID: ${booking.id}`,
      ``,
      `▼予約詳細`,
      adminBookingUrl(booking.id),
    ].join("\n")
  );
}

/** 返金が非同期に失敗した（refund.failed）→ 手動対応が必要。お客様には自動返金と案内済みの可能性があるため要注意 */
async function handleRefundFailed(refund: Stripe.Refund): Promise<void> {
  const db = getDb();
  const piId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (!piId) {
    await sendAdminAlert(
      "🚨 返金失敗（payment_intent不明）",
      `Refund ${refund.id} が失敗しましたが、payment_intentが特定できません。Stripeダッシュボードで確認してください。\n失敗理由: ${refund.failure_reason ?? "不明"}\n金額: ¥${refund.amount.toLocaleString()}`
    );
    return;
  }

  // 主決済PI（bookings）→ 追加請求PI（booking_adjustments）の順で予約を特定
  let booking: Booking | null = null;
  const { data: mainMatch } = await db
    .from("bookings")
    .select("*")
    .eq("stripe_payment_intent_id", piId)
    .maybeSingle<Booking>();
  booking = mainMatch ?? null;
  if (!booking) {
    const { data: adj } = await db
      .from("booking_adjustments")
      .select("booking_id")
      .eq("stripe_payment_intent_id", piId)
      .maybeSingle<{ booking_id: string }>();
    if (adj?.booking_id) {
      const { data: b } = await db
        .from("bookings")
        .select("*")
        .eq("id", adj.booking_id)
        .maybeSingle<Booking>();
      booking = b ?? null;
    }
  }

  if (!booking) {
    // このシステムの予約に紐づかない。同一Stripeアカウントを共有する他サービス（あおサロン等）の
    // 返金失敗である可能性が高いため、PaymentIntentのappタグを見て通知の要否を判断する。
    // 新しいサービスが同じStripeアカウントに追加されても、appタグを持たない限り自動的に無視される
    try {
      const pi = await getStripe().paymentIntents.retrieve(piId);
      if (pi.metadata?.app !== STRIPE_APP_TAG) {
        return;
      }
    } catch (e) {
      // 判定できない場合は原因調査できるよう安全側に倒してアラートを出す
      console.error("[webhook] PaymentIntent取得失敗（返金失敗の予約特定用）:", e);
    }
    await sendAdminAlert(
      "🚨 返金失敗（予約が特定できません・手動対応必要）",
      `Refund ${refund.id}（PaymentIntent: ${piId}）が失敗しましたが、対応する予約が見つかりません。Stripeダッシュボードで手動対応してください。\n失敗理由: ${refund.failure_reason ?? "不明"}\n金額: ¥${refund.amount.toLocaleString()}`
    );
    return;
  }

  await sendAdminAlert(
    "🚨 返金失敗（手動対応必要）",
    [
      `Stripeでの返金処理が失敗しました。お客様には既に「返金します」とご案内済みの可能性があります。`,
      `至急Stripeダッシュボードで返金状況を確認し、必要なら別の方法（別カード情報の確認等）で手動対応してください。`,
      ``,
      `予約ID: ${booking.id}`,
      `お客様: ${booking.customer_name} <${booking.customer_email}>`,
      `失敗金額: ¥${refund.amount.toLocaleString()}`,
      `失敗理由: ${refund.failure_reason ?? "不明"}`,
      `Refund ID: ${refund.id}`,
      ``,
      `▼予約詳細`,
      adminBookingUrl(booking.id),
    ].join("\n")
  );

  await sendMail({
    to: booking.customer_email,
    subject: `【重要】ご返金処理についてのご連絡`,
    text: [
      `${booking.customer_name} 様`,
      "",
      "ご返金のお手続き中に問題が発生し、自動でのご返金が完了しませんでした。",
      "お手数をおかけいたしますが、担当より個別にご連絡させていただきますので少々お待ちください。",
      "",
      "ご不明な点がございましたら、このメールへの返信でご連絡ください。",
      "",
      "ブルーステージ合同会社",
    ].join("\n"),
  });
}

async function handleExpired(session: Stripe.Checkout.Session): Promise<void> {
  const db = getDb();

  // 時間変更（延長）Checkoutの期限切れ
  if (session.metadata?.change_request_id) {
    const { data: updatedCr } = await db
      .from("booking_change_requests")
      .update({ status: "expired", decided_at: new Date().toISOString() })
      .eq("id", session.metadata.change_request_id)
      .eq("stripe_session_id", session.id)
      .eq("status", "pending_payment")
      .select("booking_id");
    const crBookingId = ((updatedCr ?? []) as { booking_id: string }[])[0]?.booking_id;
    if (!crBookingId) return; // 既に処理済み（二重通知防止）

    await sendAdminAlert(
      "⚠️ 予約延長の決済期限切れ",
      `予約延長の追加お支払いの期限が切れました。\n変更申請ID: ${session.metadata.change_request_id}\n元の予約時間のままです。`
    );
    const { data: booking } = await db
      .from("bookings")
      .select("*")
      .eq("id", crBookingId)
      .maybeSingle<Booking>();
    if (booking) {
      await sendMail({
        to: booking.customer_email,
        subject: `【お知らせ】予約延長のお支払い期限が切れました`,
        text: [
          `${booking.customer_name} 様`,
          "",
          "予約延長の追加お支払いの期限が切れたため、延長は反映されず、元のご予約内容のままとなっております。",
          "",
          `現在のご予約: ${formatBookingPeriod(booking)}`,
          "",
          "改めて延長をご希望の場合は、マイページから再度お手続きください。",
          `マイページ: ${myBookingUrl(booking.id)}`,
          "",
          "ブルーステージ合同会社",
        ].join("\n"),
      });
    }
    return;
  }

  // 追加請求の期限切れ
  if (session.metadata?.adjustment_id) {
    const { data: updatedAdj } = await db
      .from("booking_adjustments")
      .update({ status: "expired" })
      .eq("id", session.metadata.adjustment_id)
      .eq("stripe_session_id", session.id)
      .eq("status", "pending_payment")
      .select("booking_id, previous_amount, new_amount");
    const adj = ((updatedAdj ?? []) as BookingAdjustment[])[0];
    if (!adj) return; // 既に処理済み

    await sendAdminAlert(
      "⚠️ 追加請求の決済期限切れ",
      `追加お支払いの期限が切れました。\n予約ID: ${adj.booking_id}\n変更: ¥${adj.previous_amount.toLocaleString()} → ¥${adj.new_amount.toLocaleString()}`
    );
    const { data: booking } = await db
      .from("bookings")
      .select("*")
      .eq("id", adj.booking_id)
      .maybeSingle<Booking>();
    if (booking) {
      await sendMail({
        to: booking.customer_email,
        subject: `【お知らせ】追加お支払いの期限が切れました`,
        text: [
          `${booking.customer_name} 様`,
          "",
          "ご案内していた追加お支払いの期限が切れたため、料金変更は反映されておりません。",
          "",
          `現在のご予約金額: ¥${adj.previous_amount.toLocaleString()}`,
          "",
          "ご不明な点がございましたら、このメールへの返信でご連絡ください。",
          "ブルーステージ合同会社",
        ].join("\n"),
      });
    }
    return;
  }

  const bookingId = session.metadata?.booking_id;
  if (!bookingId) return;

  // pendingのときだけexpiredへ（confirmedには絶対に触らない）。
  // セッションIDも照合し、別セッションのイベントで誤って失効させない
  const { error } = await db
    .from("bookings")
    .update({ booking_status: "expired", updated_at: new Date().toISOString() })
    .eq("id", bookingId)
    .eq("stripe_session_id", session.id)
    .eq("booking_status", "pending");
  if (error) throw new Error(`期限切れ処理エラー: ${error.message}`);
}

/**
 * 追加請求（料金増額）の決済完了処理。
 * 検証: adjustment存在・status=pending_payment・session一致・金額一致・予約がキャンセルされていないこと
 */
async function handleAdjustmentCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const db = getDb();
  const adjustmentId = session.metadata?.adjustment_id;
  const bookingId = session.metadata?.booking_id;
  if (!adjustmentId || !bookingId) {
    await sendAdminAlert(
      "⚠️ 追加請求Webhookにメタデータ不足",
      `セッション ${session.id} にadjustment_idまたはbooking_idがありません。`
    );
    return;
  }

  // 調整レコードの検証
  const { data: adj } = await db
    .from("booking_adjustments")
    .select("*")
    .eq("id", adjustmentId)
    .maybeSingle<BookingAdjustment>();

  const problems: string[] = [];
  if (!adj) problems.push("調整レコードが存在しない");
  if (adj && adj.status !== "pending_payment") problems.push(`status=${adj.status}（pending_payment以外）`);
  if (adj && adj.adjustment_type !== "price_increase") problems.push(`type=${adj.adjustment_type}`);
  if (adj && adj.stripe_session_id !== session.id) problems.push("セッションID不一致");
  if (adj && adj.booking_id !== bookingId) problems.push("予約ID不一致");
  if (session.payment_status !== "paid") problems.push(`payment_status=${session.payment_status}`);
  if (adj && session.amount_total !== adj.amount_delta) {
    problems.push(`金額不一致 (stripe=${session.amount_total}, adj=${adj.amount_delta})`);
  }
  if (session.currency !== "jpy") problems.push(`通貨不一致 (${session.currency})`);

  // 予約がキャンセルされていないか
  const { data: booking } = await db
    .from("bookings")
    .select("booking_status, customer_name, customer_email")
    .eq("id", bookingId)
    .maybeSingle();
  if (!booking) problems.push("予約が存在しない");
  if (booking && booking.booking_status !== "confirmed") {
    problems.push(`予約が${booking.booking_status}状態`);
  }

  if (!adj || !booking || problems.length > 0) {
    await sendAdminAlert(
      "🚨 追加請求の検証エラー（要確認）",
      [
        `追加請求の決済が完了しましたが、検証に失敗しました。`,
        `Stripeダッシュボードで確認してください。`,
        ``,
        `調整ID: ${adjustmentId}`,
        `予約ID: ${bookingId}`,
        `セッション: ${session.id}`,
        `問題: ${problems.join(" / ")}`,
      ].join("\n")
    );
    return;
  }

  // 原子的にpending_payment→completedへ遷移
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { data: updated } = await db
    .from("booking_adjustments")
    .update({
      status: "completed",
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", adjustmentId)
    .eq("status", "pending_payment")
    .select("id");

  if ((updated ?? []).length === 0) return; // 既に処理済み

  // extra_paid_amountの加算はDB側の単一UPDATEで完結させる（同時実行での加算漏れを防ぐ。
  // supabase/migrations/0017参照）。adjusted_totalは絶対値の上書きなので通常のupdateでよい
  const { error: incErr } = await db.rpc("increment_extra_paid_amount", {
    p_booking_id: bookingId,
    p_delta: adj.amount_delta,
  });
  if (incErr) {
    console.error("[webhook] extra_paid_amount加算失敗:", incErr);
    await sendAdminAlert(
      "🚨 追加請求の反映に失敗（手動対応必要）",
      `予約ID: ${bookingId}\n決済は完了していますが、extra_paid_amountの加算に失敗しました。手動で確認・修正してください。\nエラー: ${String(incErr.message ?? incErr)}`
    );
  }
  await db
    .from("bookings")
    .update({
      adjusted_total: adj.new_amount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);

  // 通知
  await sendMail({
    to: booking.customer_email as string,
    subject: `【追加お支払い完了】ご予約料金の変更が確定しました`,
    text: [
      `${booking.customer_name} 様`,
      "",
      "追加のお支払いが完了しました。ご予約料金の変更が確定しましたのでお知らせいたします。",
      "",
      `変更前: ¥${adj.previous_amount.toLocaleString()}`,
      `変更後: ¥${adj.new_amount.toLocaleString()}`,
      `追加お支払い額: ¥${adj.amount_delta.toLocaleString()}`,
      "",
      "ご不明な点がございましたらお気軽にお問い合わせください。",
      "ブルーステージ合同会社",
    ].join("\n"),
  });
  await sendAdminAlert(
    `追加請求の決済完了`,
    `予約ID: ${bookingId}\n¥${adj.previous_amount.toLocaleString()} → ¥${adj.new_amount.toLocaleString()}（追加¥${adj.amount_delta.toLocaleString()}）`
  );
}

/**
 * 予約時間変更（延長）Checkout決済完了処理。
 * 検証: change_request存在・status=pending_payment・session一致・金額一致・予約がconfirmed
 * 通過後: bookings の時刻＋adjusted_total を更新、Googleカレンダーも更新。
 */
async function handleChangeRequestCompleted(session: Stripe.Checkout.Session): Promise<void> {
  const db = getDb();
  const changeRequestId = session.metadata?.change_request_id;
  const bookingId = session.metadata?.booking_id;
  if (!changeRequestId || !bookingId) {
    await sendAdminAlert(
      "⚠️ 予約変更Webhookにメタデータ不足",
      `セッション ${session.id} にchange_request_idまたはbooking_idがありません。`
    );
    return;
  }

  const { data: cr } = await db
    .from("booking_change_requests")
    .select("*")
    .eq("id", changeRequestId)
    .maybeSingle<BookingChangeRequest>();

  const { data: booking } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();

  const problems: string[] = [];
  if (!cr) problems.push("変更申請が存在しない");
  if (cr && cr.status !== "pending_payment") problems.push(`status=${cr.status}`);
  if (cr && cr.stripe_session_id !== session.id) problems.push("セッションID不一致");
  if (cr && cr.booking_id !== bookingId) problems.push("予約ID不一致");
  if (cr && session.amount_total !== cr.extra_amount) {
    problems.push(`金額不一致 (stripe=${session.amount_total}, cr=${cr.extra_amount})`);
  }
  if (session.payment_status !== "paid") problems.push(`payment_status=${session.payment_status}`);
  if (session.currency !== "jpy") problems.push(`通貨不一致 (${session.currency})`);
  if (!booking) problems.push("予約が存在しない");
  if (booking && booking.booking_status !== "confirmed") problems.push(`予約が${booking.booking_status}状態`);

  if (!cr || !booking || problems.length > 0) {
    await sendAdminAlert(
      "🚨 予約変更（延長）の検証エラー（要確認）",
      [
        `延長の決済が完了しましたが、検証に失敗したため反映を保留しました。`,
        `Stripeダッシュボードと予約状態を確認してください。`,
        ``,
        `申請ID: ${changeRequestId}`,
        `予約ID: ${bookingId}`,
        `セッション: ${session.id}`,
        `問題: ${problems.join(" / ")}`,
      ].join("\n")
    );
    return;
  }

  // 原子的に pending_payment → approved（重複処理防止）。
  // statusを変えずにstripe_payment_intent_idだけ更新すると、Webhookの重複配信時に
  // 両方とも同じ .eq("status","pending_payment") 条件を通過してしまい、
  // applyApprovedTimeChange（金額の加算RPCを含む）が二重に呼ばれてしまう
  const paymentIntentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id ?? null;

  const { data: claimed, error: claimErr } = await db
    .from("booking_change_requests")
    .update({
      status: "approved",
      stripe_payment_intent_id: paymentIntentId,
    })
    .eq("id", changeRequestId)
    .eq("status", "pending_payment")
    .select("id");
  if (claimErr) {
    // DB障害と「既に処理済み(0件)」を区別する。前者を無視すると決済済みなのに
    // 反映されないまま気づかれない恐れがあるため、必ず手動対応のアラートを出す
    await sendAdminAlert(
      "🚨 予約変更の反映クレームに失敗（要確認）",
      `予約ID: ${bookingId}\n申請ID: ${changeRequestId}\nセッション: ${session.id}\nDB更新エラーのため反映を保留しました。Stripeダッシュボードで決済状況を確認し、手動対応してください。\nエラー: ${String(claimErr.message ?? claimErr)}`
    );
    return;
  }
  if ((claimed ?? []).length === 0) return; // 別経路で処理済み（Webhook重複配信等）

  // 適用直前に再度排他チェック（決済中に他の予約が入った場合の保険）
  const { data: venue } = await db
    .from("venues")
    .select("*")
    .eq("id", booking.venue_id)
    .single<Venue>();
  if (!venue) {
    await sendAdminAlert("🚨 予約変更適用エラー: 拠点取得失敗", `予約ID: ${bookingId}`);
    return;
  }

  try {
    // 失敗時（枠が埋まっている等）はapplyApprovedTimeChange内で既に管理者アラート
    // 送信済み。戻り値をここで明示的に受け取るのみで、Webhookとしては200を返す
    // （Stripeの再送はcrがapproved済みのため無効化しても意味がなく、再送させる
    // 必要はない＝手動対応に委ねる）。
    const applyResult = await applyApprovedTimeChange({
      bookingId,
      venue,
      booking,
      start: new Date(cr.requested_start_at),
      end: new Date(cr.requested_end_at),
      amounts: {
        newAmount: cr.new_amount,
        extraAmount: cr.extra_amount,
        refundAmount: cr.refund_amount,
      },
      reason: cr.reason || "予約延長（決済完了）",
      changeRequestId,
    });
    if (!applyResult.ok) return;
  } catch (e) {
    await sendAdminAlert(
      "🚨 予約変更の適用失敗（手動対応必要）",
      `決済は完了しましたが、予約への反映に失敗しました。\n申請ID: ${changeRequestId}\nエラー: ${String(e)}`
    );
  }
}
