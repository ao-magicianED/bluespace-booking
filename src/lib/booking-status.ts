import type { Booking } from "./types";

/**
 * 予約状態の日本語ラベル。pending×invoiceは「決済待ち」ではなく「入金待ち」と表示する
 * （カードの30分放置と、正常に数十時間続く請求書の入金待ちを区別するため）。
 */
const DEFAULT_STATUS_LABEL: Record<string, string> = {
  pending: "決済待ち",
  confirmed: "確定",
  cancelled: "キャンセル",
  expired: "期限切れ",
};

export function bookingStatusLabel(
  booking: Pick<Booking, "booking_status" | "payment_method">
): string {
  if (booking.booking_status === "pending" && booking.payment_method === "invoice") {
    return "入金待ち";
  }
  return DEFAULT_STATUS_LABEL[booking.booking_status] ?? booking.booking_status;
}
