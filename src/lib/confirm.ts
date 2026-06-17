import { getDb } from "./supabase";
import { createBookingEvent, getBusyRanges } from "./google-calendar";
import { sendAdminAlert, sendMail } from "./mail";
import { utcToJstDateStr, JST_OFFSET_MS } from "./slots";
import type { Booking, Venue } from "./types";

function jstTime(iso: string): { hour: number; minute: number } {
  const j = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  return { hour: j.getUTCHours(), minute: j.getUTCMinutes() };
}

function fmtTime(h: number, m: number): string {
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function formatBookingPeriod(b: Pick<Booking, "start_at" | "end_at">): string {
  const date = utcToJstDateStr(new Date(b.start_at));
  const start = jstTime(b.start_at);
  const end = jstTime(b.end_at);
  // 終了が翌日0:00の場合は同一営業日の「24:00」として表示（0-24時営業の境界）
  const endHour = end.hour === 0 && end.minute === 0 ? 24 : end.hour;
  const endMin = end.hour === 0 && end.minute === 0 ? 0 : end.minute;
  return `${date} ${fmtTime(start.hour, start.minute)}〜${fmtTime(endHour, endMin)}`;
}

/**
 * 予約確定後の副作用（カレンダー登録・メール送信）。
 * Webhook本体とCron再試行の両方から呼ばれるため、すべて冪等
 * （カレンダー: calendar_event_idの有無 / メール: confirmation_email_sent_at で判定）。
 * 失敗してもthrowしない（Webhook全体を失敗させない）。
 * notifyAdmin はWebhookでの初回確定時のみtrue（Cron再試行で重複通知しないため）。
 */
export async function runConfirmationSideEffects(
  booking: Booking,
  venue: Venue,
  notifyAdmin = true
): Promise<void> {
  const db = getDb();
  const period = formatBookingPeriod(booking);

  // --- Googleカレンダー登録（冪等） ---
  if (!booking.calendar_event_id && venue.calendar_id) {
    // 決済中（最大30分）に外部サイト経由の予約が入っていないか最終チェック。
    // 衝突していても決済済みのため確定は維持し、管理者へ即アラート（人が調整する）
    try {
      const busy = await getBusyRanges(
        venue.calendar_id,
        new Date(booking.start_at),
        new Date(booking.end_at)
      );
      if (busy.length > 0) {
        await sendAdminAlert(
          "🚨 二重予約の可能性（至急確認）",
          [
            `決済完了時点で、Googleカレンダー上に同時間帯の予定が存在します。`,
            `外部サイト経由の予約と衝突している可能性があります。両方の予約内容を確認し、`,
            `必要ならどちらかへ返金・代替提案をしてください。`,
            ``,
            `拠点: ${venue.name}`,
            `日時: ${period}`,
            `予約ID: ${booking.id}`,
            `お客様: ${booking.customer_name} <${booking.customer_email}> ${booking.customer_phone}`,
          ].join("\n")
        );
      }
    } catch (e) {
      console.error("[confirm] 衝突チェック失敗（処理は継続）:", e);
    }
    try {
      const eventId = await createBookingEvent(
        venue.calendar_id,
        booking.id,
        new Date(booking.start_at),
        new Date(booking.end_at)
      );
      await db
        .from("bookings")
        .update({
          calendar_event_id: eventId,
          calendar_sync_status: "synced",
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);
      booking.calendar_event_id = eventId;
    } catch (e) {
      console.error("[confirm] カレンダー登録失敗:", e);
      await db
        .from("bookings")
        .update({ calendar_sync_status: "failed", updated_at: new Date().toISOString() })
        .eq("id", booking.id);
      await sendAdminAlert(
        "⚠️ カレンダー登録失敗（要対応）",
        [
          `予約のGoogleカレンダー登録に失敗しました。`,
          `外部サイトに空きのまま表示され二重予約の恐れがあります。手動でカレンダーに登録してください。`,
          ``,
          `拠点: ${venue.name}`,
          `日時: ${period}`,
          `予約ID: ${booking.id}`,
          `お名前: ${booking.customer_name}`,
        ].join("\n")
      );
    }
  }

  // --- 利用者への確認メール（冪等） ---
  if (!booking.confirmation_email_sent_at) {
    const accessSection = venue.access_info?.trim()
      ? [``, `▼入退室のご案内`, venue.access_info.trim()]
      : [];
    const ok = await sendMail({
      to: booking.customer_email,
      subject: `【予約確定】${venue.name} ${period}`,
      text: [
        `${booking.customer_name} 様`,
        ``,
        `ご予約ありがとうございます。以下の内容で確定しました。`,
        ``,
        `▼ご予約内容`,
        `スペース: ${venue.name}`,
        `住所: ${venue.address}`,
        `日時: ${period}`,
        ...(booking.party_size ? [`ご利用人数: ${booking.party_size}名`] : []),
        `料金: ¥${booking.total_amount.toLocaleString()}（決済済み）`,
        `予約番号: ${booking.id.replace(/-/g, "").slice(-8)}`,
        ...accessSection,
        ``,
        `▼キャンセルについて`,
        `キャンセルをご希望の場合は、このメールへの返信でご連絡ください。`,
        ``,
        `ブルーステージ合同会社`,
      ].join("\n"),
    });
    if (ok) {
      await db
        .from("bookings")
        .update({
          confirmation_email_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", booking.id);
    }
  }

  // --- 管理者通知（初回確定時のみ） ---
  if (!notifyAdmin) return;
  await sendAdminAlert(
    `新規予約 ${venue.name} ${period}`,
    [
      `新しい予約が確定しました。`,
      ``,
      `拠点: ${venue.name}`,
      `日時: ${period}`,
      `金額: ¥${booking.total_amount.toLocaleString()}`,
      `お名前: ${booking.customer_name}`,
      `人数: ${booking.party_size ?? "-"}名`,
      `メール: ${booking.customer_email}`,
      `電話: ${booking.customer_phone}`,
      `目的: ${booking.purpose || "(未記入)"}`,
      `予約ID: ${booking.id}`,
    ].join("\n")
  );
}
