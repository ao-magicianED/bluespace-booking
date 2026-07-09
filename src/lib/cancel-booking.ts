import { getDb } from "./supabase";
import { sendAdminAlert, sendMail } from "./mail";
import { formatBookingPeriod } from "./confirm";
import {
  effectiveTotal,
  collectPaymentIntents,
  refundFromPaymentIntents,
  paymentStatusAfterRefund,
} from "./adjustment";
import { deleteBookingEvent } from "./google-calendar";
import { adminBookingUrl } from "./site-url";
import type { Booking, Venue } from "./types";

export type CancelResult = {
  ok: boolean;
  error?: string;
  refundId: string | null;
};

/**
 * キャンセルの実行部（会員セルフキャンセルと管理者キャンセルの共通処理）。
 * 1. confirmed → cancelled へ原子的に遷移（排他制約から枠を解放）
 * 2. Stripe返金（refundAmount > 0）— 複数PIがある場合は順に返金
 * 3. Googleカレンダーのイベント削除
 * 4. お客様メール＋管理者通知
 */
export async function executeCancellation(params: {
  booking: Booking;
  venue: Venue | null;
  refundAmount: number;
  feeAmount: number;
  tierLabel: string;
  reason: string;
  cancelledBy: "お客様ご本人" | "管理者";
}): Promise<CancelResult> {
  const { booking, venue, refundAmount, feeAmount, tierLabel, reason, cancelledBy } = params;
  const db = getDb();
  const now = new Date();
  const effective = effectiveTotal(booking);

  // 1. 原子的にキャンセルへ遷移
  const { data: updated, error: updError } = await db
    .from("bookings")
    .update({
      booking_status: "cancelled",
      cancelled_at: now.toISOString(),
      cancel_reason: reason,
      updated_at: now.toISOString(),
    })
    .eq("id", booking.id)
    .eq("booking_status", "confirmed")
    .select("id");
  if (updError || (updated ?? []).length === 0) {
    return { ok: false, error: "キャンセルに失敗しました（既に処理済みの可能性）", refundId: null };
  }

  // 決済待ちの追加請求があれば期限切れにする
  await db
    .from("booking_adjustments")
    .update({ status: "expired" })
    .eq("booking_id", booking.id)
    .eq("status", "pending_payment");

  // 進行中の変更申請（承認待ち・延長の決済待ち）も取り下げる。
  // 延長のCheckoutセッションが生きていると、キャンセル後に支払われてしまうため失効させる
  const { data: staleCrs } = await db
    .from("booking_change_requests")
    .update({ status: "expired", decided_at: now.toISOString() })
    .eq("booking_id", booking.id)
    .in("status", ["pending", "pending_payment"])
    .select("stripe_session_id");
  for (const cr of (staleCrs ?? []) as { stripe_session_id: string | null }[]) {
    if (cr.stripe_session_id) {
      try {
        const { getStripe } = await import("./stripe");
        await getStripe().checkout.sessions.expire(cr.stripe_session_id);
      } catch (e) {
        // 既に完了/失効済みのセッションはexpireできないが、その場合は害がないので無視
        console.error("[cancel] 延長Checkoutセッション失効失敗:", e);
      }
    }
  }

  // 2. Stripe返金（複数PI対応）
  let refundId: string | null = null;
  if (refundAmount > 0) {
    const pis = await collectPaymentIntents(
      booking.id,
      booking.stripe_payment_intent_id,
      booking.stripe_invoice_id,
      db
    );

    if (pis.length > 0) {
      try {
        const { refundIds, remainingAmount } = await refundFromPaymentIntents(
          pis,
          refundAmount,
          `cancel-${booking.id}-${Date.now()}`
        );
        refundId = refundIds[0] ?? null;
        const actualRefunded = refundAmount - remainingAmount;
        await db
          .from("bookings")
          .update({
            payment_status: paymentStatusAfterRefund(booking, actualRefunded),
            refunded_amount: (booking.refunded_amount ?? 0) + actualRefunded,
            updated_at: new Date().toISOString(),
          })
          .eq("id", booking.id);

        if (remainingAmount > 0) {
          await sendAdminAlert(
            "⚠️ 返金不足（手動対応必要）",
            `キャンセル返金の一部が自動処理できませんでした。\n予約ID: ${booking.id}\n未返金額: ¥${remainingAmount.toLocaleString()}\nStripeダッシュボードから手動で返金してください。`
          );
        }
      } catch (e) {
        console.error("[cancel] Stripe返金失敗:", e);
        await sendAdminAlert(
          "🚨 自動返金失敗（手動対応必要）",
          `予約はキャンセルしましたが、Stripeでの返金処理に失敗しました。\nStripeダッシュボードから手動で返金してください。\n\n予約ID: ${booking.id}\nお客様: ${booking.customer_name} <${booking.customer_email}>\n返金予定額: ¥${refundAmount.toLocaleString()}\nエラー: ${String(e)}`
        );
      }
    } else {
      await sendAdminAlert(
        "⚠️ 返金元のStripe決済情報なし（手動対応必要）",
        `予約をキャンセルしましたが、返金元のPayment Intentが見つかりません。\n手動でStripeダッシュボードから返金してください。\n\n予約ID: ${booking.id}\n返金予定額: ¥${refundAmount.toLocaleString()}`
      );
    }
  }

  // 3. Googleカレンダーのイベント削除（失敗してもDBは確定・404/410は既に削除済みとして成功扱い）
  if (booking.calendar_event_id && venue?.calendar_id) {
    try {
      await deleteBookingEvent(venue.calendar_id, booking.calendar_event_id);
      await db
        .from("bookings")
        .update({ calendar_sync_status: "none", updated_at: new Date().toISOString() })
        .eq("id", booking.id);
    } catch (e) {
      console.error("[cancel] カレンダー削除失敗:", e);
      await sendAdminAlert(
        "⚠️ カレンダー削除失敗",
        `予約をキャンセルしましたが、Googleカレンダーのイベント削除に失敗しました。\n手動で削除してください。\n\n予約ID: ${booking.id}\nイベントID: ${booking.calendar_event_id}`
      );
    }
  }

  // 4. 通知メール
  const period = formatBookingPeriod(booking);
  const mailOk = await sendMail({
    to: booking.customer_email,
    subject: `【キャンセル完了】${venue?.name ?? ""} ${period}`,
    text: [
      `${booking.customer_name} 様`,
      "",
      "ご予約のキャンセル手続きが完了しました。",
      "",
      "▼予約内容",
      `スペース: ${venue?.name ?? ""}`,
      `日時: ${period}`,
      `予約番号: ${booking.id.replace(/-/g, "").slice(-8).toUpperCase()}`,
      "",
      "▼返金内容",
      `お支払い金額: ¥${effective.toLocaleString()}`,
      `キャンセル手数料: ¥${feeAmount.toLocaleString()}（${tierLabel}）`,
      `ご返金額: ¥${refundAmount.toLocaleString()}`,
      refundAmount > 0
        ? "ご返金はクレジットカードへ自動で行われます。明細への反映は5〜10営業日かかる場合があります。"
        : "キャンセルポリシーにより返金はございません。ご了承ください。",
      "",
      "またのご利用をお待ちしております。",
      "ブルーステージ合同会社",
    ].join("\n"),
  });
  if (!mailOk) {
    await sendAdminAlert(
      "🚨 キャンセル完了メール送信失敗（要フォロー）",
      `お客様へのキャンセル完了メールの送信に失敗しました。返金内容を電話等で個別に案内してください。\n\n予約ID: ${booking.id}\nお客様: ${booking.customer_name} <${booking.customer_email}> ${booking.customer_phone}`
    );
  }

  // 返金行: ポリシー上ゼロ／返金成功／自動返金失敗（別アラート送信済み）を明確に区別する
  const refundLine =
    refundAmount === 0
      ? "返金: なし（ポリシー適用）"
      : refundId
        ? `返金: ¥${refundAmount.toLocaleString()} 済み（Refund ID: ${refundId}）`
        : `返金: ¥${refundAmount.toLocaleString()} ★自動返金に失敗しました（別途アラート済み・Stripeダッシュボードで手動対応してください）`;

  await sendAdminAlert(
    `予約キャンセル ${venue?.name ?? ""} ${period}`,
    [
      `予約がキャンセルされました（${cancelledBy}による）。`,
      ``,
      `拠点: ${venue?.name ?? ""}`,
      `日時: ${period}`,
      `お客様: ${booking.customer_name} <${booking.customer_email}>`,
      `元金額: ¥${effective.toLocaleString()}`,
      `キャンセル手数料: ¥${feeAmount.toLocaleString()}（${tierLabel}）`,
      `理由: ${reason || "(なし)"}`,
      refundLine,
      `予約ID: ${booking.id}`,
      ``,
      `▼予約詳細`,
      adminBookingUrl(booking.id),
    ].join("\n")
  );

  return { ok: true, refundId };
}
