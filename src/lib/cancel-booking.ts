import { getDb } from "./supabase";
import { sendAdminAlert, sendMail } from "./mail";
import { formatBookingPeriod } from "./confirm";
import { effectiveTotal, collectPaymentIntents, refundFromPaymentIntents } from "./adjustment";
import type { Booking, Venue } from "./types";
import { google } from "googleapis";

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
            payment_status: actualRefunded >= effective ? "refunded" : "partially_refunded",
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

  // 3. Googleカレンダーのイベント削除（失敗してもDBは確定）
  if (booking.calendar_event_id && venue?.calendar_id) {
    try {
      const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
      if (b64) {
        const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
        const auth = new google.auth.JWT({
          email: sa.client_email,
          key: sa.private_key,
          scopes: ["https://www.googleapis.com/auth/calendar"],
        });
        await google.calendar({ version: "v3", auth }).events.delete({
          calendarId: venue.calendar_id,
          eventId: booking.calendar_event_id,
        });
      }
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
  await sendMail({
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
  await sendAdminAlert(
    `予約キャンセル ${venue?.name ?? ""} ${period}`,
    [
      `予約がキャンセルされました（${cancelledBy}による）。`,
      ``,
      `拠点: ${venue?.name ?? ""}`,
      `日時: ${period}`,
      `お客様: ${booking.customer_name} <${booking.customer_email}>`,
      `元金額: ¥${effective.toLocaleString()}`,
      `返金額: ¥${refundAmount.toLocaleString()}（${tierLabel}）`,
      refundId ? `Stripe Refund ID: ${refundId}` : "返金処理: なし or 失敗",
      `予約ID: ${booking.id}`,
    ].join("\n")
  );

  return { ok: true, refundId };
}
