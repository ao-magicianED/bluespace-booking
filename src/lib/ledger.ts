import { effectiveTotal } from "./adjustment";
import type { Booking } from "./types";

/** 会員番号の表示形式（例: BS-00012） */
export function formatMemberNo(no: number | null | undefined): string {
  if (no == null) return "";
  return `BS-${String(no).padStart(5, "0")}`;
}

/**
 * 実収額（返金控除後）。入金実績がある予約＝paid（確定）と partially_refunded
 * （部分返金キャンセル＝キャンセル料が残る）を対象にする。
 * これにより、キャンセル料収入が売上集計から漏れない。
 * adjusted_totalがあればそちらを基準にする（追加請求の入金分は元amountに上乗せされていない）。
 */
export function realizedRevenue(
  b: Pick<Booking, "payment_status" | "total_amount" | "refunded_amount" | "adjusted_total">
): number {
  if (b.payment_status === "paid" || b.payment_status === "partially_refunded") {
    return effectiveTotal(b) - (b.refunded_amount ?? 0);
  }
  return 0;
}

export type RepeatInfo = {
  /** その予約が同一顧客の何回目の利用か（確定予約のみカウント、利用日時順） */
  seq: number;
  /** 同一顧客の確定予約の総数 */
  total: number;
};

/**
 * 予約一覧から「同一顧客（メールアドレス小文字一致）の何回目の利用か」を計算する。
 * 確定（confirmed）予約のみカウント対象。キャンセル等の行はカウントに含めない。
 * 戻り値: booking.id → RepeatInfo
 */
export function computeRepeatNumbers(
  rows: Pick<Booking, "id" | "customer_email" | "booking_status" | "start_at">[]
): Map<string, RepeatInfo> {
  const byEmail = new Map<string, { id: string; start_at: string }[]>();
  for (const r of rows) {
    if (r.booking_status !== "confirmed") continue;
    const key = r.customer_email.trim().toLowerCase();
    const list = byEmail.get(key) ?? [];
    list.push({ id: r.id, start_at: r.start_at });
    byEmail.set(key, list);
  }
  const result = new Map<string, RepeatInfo>();
  for (const list of byEmail.values()) {
    list.sort((a, b) => a.start_at.localeCompare(b.start_at));
    list.forEach((b, i) => result.set(b.id, { seq: i + 1, total: list.length }));
  }
  return result;
}
