import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth-server";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import { calcRefund, describePolicy } from "@/lib/cancellation";
import { effectiveTotal } from "@/lib/adjustment";
import CancelBookingButton from "@/components/CancelBookingButton";
import ChangeTimeForm from "@/components/ChangeTimeForm";
import { canSelfChange } from "@/lib/change-request";
import { isReviewEligible } from "@/lib/reviews";
import type { Booking, BookingAdjustment, BookingChangeRequest, Venue } from "@/lib/types";
import type { PriceBreakdown } from "@/lib/pricing";

export const dynamic = "force-dynamic";

const DISCOUNT_LABEL: Record<string, string> = {
  last_minute: "直前割",
  early_bird: "早割",
};

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const db = getDb();
  const { data: booking } = await db.from("bookings").select("*").eq("id", id).maybeSingle<Booking>();
  if (!booking) notFound();
  // 本人確認: 会員IDか、登録メールと予約メールの一致
  if (booking.user_id !== user.id && booking.customer_email !== user.email) notFound();

  const { data: venue } = await db
    .from("venues")
    .select("*")
    .eq("id", booking.venue_id)
    .single<Venue>();

  const bd = booking.price_breakdown as Partial<PriceBreakdown> | null;
  const effective = effectiveTotal(booking);
  const shortId = booking.id.replace(/-/g, "").slice(-8).toUpperCase();
  const now = new Date();
  const isFuture = new Date(booking.end_at) > now;
  const refundPreview =
    booking.booking_status === "confirmed" && booking.payment_status !== "refunded" && isFuture
      ? calcRefund(effective, new Date(booking.start_at), now, venue?.cancellation_policy ?? null)
      : null;
  const policyLines = describePolicy(venue?.cancellation_policy ?? null);

  // 料金調整（未払いの追加請求があるか確認）
  const { data: adjustments } = await db
    .from("booking_adjustments")
    .select("*")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false });
  const adjs = (adjustments ?? []) as BookingAdjustment[];
  const pendingIncrease = adjs.find((a) => a.adjustment_type === "price_increase" && a.status === "pending_payment");

  // 時間変更申請（pending / pending_payment があれば変更ボタンは出さない）
  const { data: changeRequests } = await db
    .from("booking_change_requests")
    .select("*")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false })
    .limit(5);
  const crs = (changeRequests ?? []) as BookingChangeRequest[];
  const activeChangeRequest = crs.find(
    (c) => c.status === "pending" || c.status === "pending_payment"
  );
  const selfChangeOk = canSelfChange(booking, now);
  const bdRule = (booking.price_breakdown ?? {}) as { pricePerHour?: number };
  const pricePerHour = typeof bdRule.pricePerHour === "number" ? bdRule.pricePerHour : venue?.hourly_price ?? 0;

  // レビュー導線（利用終了後30日以内・未投稿の予約にだけ表示）
  const reviewEligible = isReviewEligible(booking, now);
  const { data: existingReview } = reviewEligible.ok
    ? await db.from("booking_reviews").select("id").eq("booking_id", booking.id).maybeSingle()
    : { data: null };
  const showReviewCta = reviewEligible.ok && !existingReview;

  return (
    <>
      <p>
        <Link href="/my">← マイページへ戻る</Link>
      </p>
      <h1>予約詳細</h1>
      <div className="booking-panel">
        <table className="legal-table">
          <tbody>
            <tr>
              <th>予約番号</th>
              <td>{shortId}</td>
            </tr>
            <tr>
              <th>スペース</th>
              <td>
                {venue?.name}
                <br />
                {venue?.address}
              </td>
            </tr>
            <tr>
              <th>日時</th>
              <td>{formatBookingPeriod(booking)}</td>
            </tr>
            {booking.party_size != null && (
              <tr>
                <th>ご利用人数</th>
                <td>{booking.party_size}名</td>
              </tr>
            )}
            <tr>
              <th>状態</th>
              <td>
                {booking.booking_status === "confirmed"
                  ? "確定（決済済み）"
                  : booking.booking_status === "pending"
                    ? "決済待ち"
                    : "キャンセル済み"}
              </td>
            </tr>
            <tr>
              <th>料金</th>
              <td>
                {bd?.rule === "v2" ? (
                  <>
                    {bd.dayType === "holiday" ? "土日祝" : "平日"} ¥
                    {bd.pricePerHour?.toLocaleString()} × {bd.hours}時間 = ¥
                    {bd.baseSubtotal?.toLocaleString()}
                    {bd.discount && (
                      <>
                        <br />
                        {DISCOUNT_LABEL[bd.discount.kind]} -¥{bd.discount.amount.toLocaleString()}
                      </>
                    )}
                    {(bd.options ?? []).map((o) => (
                      <span key={o.id}>
                        <br />
                        {o.name} +¥{o.amount.toLocaleString()}
                      </span>
                    ))}
                    {bd.coupon && (
                      <>
                        <br />
                        クーポン（{bd.coupon.code}） -¥{bd.coupon.amount.toLocaleString()}
                      </>
                    )}
                    <br />
                  </>
                ) : null}
                {booking.adjusted_total != null && booking.adjusted_total !== booking.total_amount ? (
                  <>
                    <strong>現在の金額: ¥{effective.toLocaleString()}（税込）</strong>
                    <br />
                    <span className="policy">当初金額: ¥{booking.total_amount.toLocaleString()}</span>
                  </>
                ) : (
                  <strong>合計 ¥{booking.total_amount.toLocaleString()}（税込）</strong>
                )}
              </td>
            </tr>
          </tbody>
        </table>

        {pendingIncrease && (
          <div className="notice" style={{ marginTop: "1rem" }}>
            <strong>追加お支払いのお願い</strong>
            <br />
            料金が ¥{pendingIncrease.previous_amount.toLocaleString()} → ¥{pendingIncrease.new_amount.toLocaleString()} に変更されました。
            追加 ¥{pendingIncrease.amount_delta.toLocaleString()} のお支払いをお願いいたします。
            <br />
            <span className="policy">メールに記載のお支払いリンクからお手続きください。</span>
          </div>
        )}

        {booking.booking_status === "confirmed" &&
          isFuture &&
          (venue?.access_info?.trim() ? (
            <div className="access-info-box">
              <h3>🔑 入退室のご案内</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{venue.access_info.trim()}</p>
            </div>
          ) : null)}

        {booking.booking_status === "confirmed" && booking.payment_status === "paid" && (
          <p style={{ marginTop: "1rem" }}>
            <Link href={`/my/${booking.id}/receipt`} className="receipt-link">
              🧾 領収書を発行する
            </Link>
          </p>
        )}

        {showReviewCta && (
          <p style={{ marginTop: "0.5rem" }}>
            <Link href={`/review/${booking.review_token}`} className="receipt-link">
              ⭐ このスペースのレビューを書く（1分で完了）
            </Link>
          </p>
        )}

        {activeChangeRequest && (
          <div className="notice" style={{ marginTop: "1rem" }}>
            <strong>
              {activeChangeRequest.status === "pending_payment"
                ? "予約時間変更のお支払い待ち"
                : "予約時間変更の承認待ち"}
            </strong>
            <br />
            希望時間: {new Date(activeChangeRequest.requested_start_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}〜
            {new Date(activeChangeRequest.requested_end_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
            <br />
            {activeChangeRequest.extra_amount > 0 && (
              <>追加お支払い: ¥{activeChangeRequest.extra_amount.toLocaleString()}<br /></>
            )}
            {activeChangeRequest.refund_amount > 0 && (
              <>差額返金見込み: ¥{activeChangeRequest.refund_amount.toLocaleString()}<br /></>
            )}
            <span className="policy">
              {activeChangeRequest.status === "pending_payment"
                ? "メールに記載のお支払いリンクからお手続きください。期限を過ぎると無効となります。"
                : "管理者が確認のうえご連絡いたします。72時間以内に処理されなかった場合は自動で取り下げとなります。"}
            </span>
          </div>
        )}

        {booking.booking_status === "confirmed" &&
          isFuture &&
          !activeChangeRequest &&
          selfChangeOk.ok &&
          venue && (
            <ChangeTimeForm
              bookingId={booking.id}
              currentStartIso={booking.start_at}
              currentEndIso={booking.end_at}
              pricePerHour={pricePerHour}
              minHours={venue.min_hours}
              maxHours={venue.max_hours}
              openHour={venue.open_hour}
              closeHour={venue.close_hour}
            />
          )}

        {refundPreview && (
          <div className="cancel-section">
            <h3>キャンセルポリシー</h3>
            <ul className="policy-list">
              {policyLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p>
              現在キャンセルした場合の返金額: <strong>¥{refundPreview.refundAmount.toLocaleString()}</strong>
              （{refundPreview.tierLabel}・キャンセル料 {refundPreview.feePercent}%）
            </p>
            <CancelBookingButton
              bookingId={booking.id}
              refundPreview={refundPreview.refundAmount}
              feePercent={refundPreview.feePercent}
              tierLabel={refundPreview.tierLabel}
            />
          </div>
        )}
        {booking.booking_status === "cancelled" && (
          <p className="policy">この予約はキャンセル済みです。</p>
        )}
      </div>
    </>
  );
}
