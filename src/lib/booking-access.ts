import type { Booking } from "./types";

/**
 * ログイン中ユーザーがこの予約の本人かどうか（マイページ・キャンセル・変更申請の共通判定）。
 * - 会員予約（user_id あり）: 会員IDの一致のみで判定する。customer_email は予約フォームの
 *   自由入力のため、メール一致での代用は認めない（同じメールを認証した別アカウントからの操作を防ぐ）。
 * - ゲスト予約（user_id なし）: 認証済みメールと customer_email の一致で本人とみなす。
 */
export function isBookingOwner(
  booking: Pick<Booking, "user_id" | "customer_email">,
  user: { id: string; email?: string | null }
): boolean {
  if (booking.user_id) return booking.user_id === user.id;
  return Boolean(user.email) && booking.customer_email === user.email;
}
