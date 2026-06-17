import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import { calcRefund } from "@/lib/cancellation";
import { computeRepeatNumbers, formatMemberNo } from "@/lib/ledger";
import { effectiveTotal } from "@/lib/adjustment";
import AdminBookingActions from "@/components/AdminBookingActions";
import AdminChangeTimeForm from "@/components/AdminChangeTimeForm";
import AdminChangeRequestDecision from "@/components/AdminChangeRequestDecision";
import type { Booking, BookingAdjustment, BookingChangeRequest, Venue } from "@/lib/types";
import type { PriceBreakdown } from "@/lib/pricing";

export const dynamic = "force-dynamic";

export default async function AdminBookingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();

  const db = getDb();
  const { data: booking } = await db.from("bookings").select("*").eq("id", id).maybeSingle<Booking>();
  if (!booking) notFound();
  const { data: venue } = await db.from("venues").select("*").eq("id", booking.venue_id).single<Venue>();

  // 同一顧客（メール一致）のリピート状況と会員番号
  const [{ data: sameCustomer }, memberRes] = await Promise.all([
    db
      .from("bookings")
      .select("id, customer_email, booking_status, start_at")
      .ilike("customer_email", booking.customer_email),
    booking.user_id
      ? db.from("member_profiles").select("member_no").eq("user_id", booking.user_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const repeat = computeRepeatNumbers(
    (sameCustomer ?? []) as Pick<Booking, "id" | "customer_email" | "booking_status" | "start_at">[]
  ).get(booking.id);
  const memberNo = (memberRes.data as { member_no: number } | null)?.member_no ?? null;

  const bd = booking.price_breakdown as Partial<PriceBreakdown> | null;
  const effective = effectiveTotal(booking);
  const now = new Date();
  const canCancel =
    booking.booking_status === "confirmed" &&
    booking.payment_status !== "refunded" &&
    new Date(booking.end_at) > now;
  const policyRefund = canCancel
    ? calcRefund(effective, new Date(booking.start_at), now, venue?.cancellation_policy ?? null).refundAmount
    : 0;

  // 料金調整履歴
  const { data: adjustments } = await db
    .from("booking_adjustments")
    .select("*")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false });
  const adjs = (adjustments ?? []) as BookingAdjustment[];

  // 時間変更履歴
  const { data: changeRequests } = await db
    .from("booking_change_requests")
    .select("*")
    .eq("booking_id", booking.id)
    .order("created_at", { ascending: false });
  const crs = (changeRequests ?? []) as BookingChangeRequest[];
  const pendingCr = crs.find((c) => c.status === "pending");
  const activeAnyCr = crs.find((c) => c.status === "pending" || c.status === "pending_payment");

  return (
    <>
      <p>
        <Link href="/admin">← 一覧へ戻る</Link>
      </p>
      <h1>予約詳細（管理）</h1>
      <div className="booking-panel">
        <table className="legal-table">
          <tbody>
            <tr>
              <th>予約ID</th>
              <td>
                {booking.id}
                <br />
                <span className="policy">予約番号: {booking.id.replace(/-/g, "").slice(-8).toUpperCase()}</span>
              </td>
            </tr>
            <tr>
              <th>拠点 / 日時</th>
              <td>
                {venue?.name}
                <br />
                {formatBookingPeriod(booking)}
              </td>
            </tr>
            <tr>
              <th>お客様</th>
              <td>
                {booking.customer_name}
                <br />
                📧 <a href={`mailto:${booking.customer_email}`}>{booking.customer_email}</a>
                <br />
                📞 {booking.customer_phone || "—"}
                <br />
                人数: {booking.party_size != null ? `${booking.party_size}名` : "—"}　目的:{" "}
                {booking.purpose || "—"}
                <br />
                {memberNo != null && <>会員番号: {formatMemberNo(memberNo)}　</>}
                {repeat ? (
                  <strong className={repeat.seq > 1 ? "repeat-badge" : ""}>
                    {repeat.seq}回目のご利用（確定計{repeat.total}回）
                  </strong>
                ) : (
                  "利用実績なし（未確定）"
                )}
                {booking.user_id && (
                  <>
                    <br />
                    <span className="policy">会員予約（user_id: {booking.user_id.slice(0, 8)}…）</span>
                  </>
                )}
              </td>
            </tr>
            <tr>
              <th>金額</th>
              <td>
                {booking.adjusted_total != null && booking.adjusted_total !== booking.total_amount ? (
                  <>
                    <strong>現在の金額: ¥{effective.toLocaleString()}</strong>
                    <br />
                    <span className="policy">当初金額: ¥{booking.total_amount.toLocaleString()}</span>
                  </>
                ) : (
                  <>合計 ¥{booking.total_amount.toLocaleString()}</>
                )}
                {bd?.rule === "v2" && (
                  <span className="policy">
                    {" "}
                    （{bd.dayType === "holiday" ? "土日祝" : "平日"} ¥{bd.pricePerHour?.toLocaleString()}×
                    {bd.hours}h
                    {bd.discount ? ` / 割引-¥${bd.discount.amount.toLocaleString()}` : ""}
                    {bd.coupon ? ` / クーポン${bd.coupon.code}-¥${bd.coupon.amount.toLocaleString()}` : ""}
                    {(bd.options ?? []).length > 0 ? ` / オプション+¥${bd.optionsSubtotal?.toLocaleString()}` : ""}
                    ）
                  </span>
                )}
                {(booking.refunded_amount ?? 0) > 0 && (
                  <>
                    <br />
                    返金済み: ¥{booking.refunded_amount.toLocaleString()}
                  </>
                )}
              </td>
            </tr>
            <tr>
              <th>状態</th>
              <td>
                予約: {booking.booking_status} / 決済: {booking.payment_status}
                <br />
                カレンダー同期:{" "}
                {booking.calendar_sync_status === "synced"
                  ? "✅ 登録済み"
                  : booking.calendar_sync_status === "failed"
                    ? "🚨 失敗（要対応）"
                    : "—"}
                <br />
                確認メール: {booking.confirmation_email_sent_at ? "送信済み" : "未送信"}
                {booking.cancelled_at && (
                  <>
                    <br />
                    キャンセル: {booking.cancelled_at.slice(0, 16).replace("T", " ")}（{booking.cancel_reason}）
                  </>
                )}
              </td>
            </tr>
            <tr>
              <th>Stripe</th>
              <td>
                {booking.stripe_payment_intent_id ? (
                  <a
                    href={`https://dashboard.stripe.com/test/payments/${booking.stripe_payment_intent_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    決済をStripeで開く →
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          </tbody>
        </table>

        <AdminBookingActions
          bookingId={booking.id}
          canCancel={canCancel}
          policyRefund={policyRefund}
          fullRefund={effective}
          effectiveAmount={effective}
          syncFailed={booking.calendar_sync_status === "failed" || !booking.confirmation_email_sent_at}
        />

        {pendingCr && (
          <AdminChangeRequestDecision
            changeRequest={pendingCr}
            currentPeriod={formatBookingPeriod(booking)}
            requestedPeriod={formatBookingPeriod({
              start_at: pendingCr.requested_start_at,
              end_at: pendingCr.requested_end_at,
            })}
          />
        )}

        {booking.booking_status === "confirmed" && !activeAnyCr && venue && (
          <AdminChangeTimeForm
            bookingId={booking.id}
            currentStartIso={booking.start_at}
            currentEndIso={booking.end_at}
            minHours={venue.min_hours}
            maxHours={venue.max_hours}
          />
        )}

        {crs.length > 0 && (
          <div style={{ marginTop: "1.5rem" }}>
            <h3>予約時間変更履歴</h3>
            <table className="legal-table" style={{ fontSize: "0.9rem" }}>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>区分</th>
                  <th>変更内容</th>
                  <th>金額</th>
                  <th>状態</th>
                  <th>理由 / メモ</th>
                </tr>
              </thead>
              <tbody>
                {crs.map((c) => (
                  <tr key={c.id}>
                    <td>{new Date(c.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                    <td>
                      {c.request_type === "self_extend"
                        ? "延長(お客様)"
                        : c.request_type === "self_modify"
                          ? "短縮/ずらし(お客様)"
                          : "管理者変更"}
                    </td>
                    <td>
                      {formatBookingPeriod({ start_at: c.previous_start_at, end_at: c.previous_end_at })}
                      <br />→ {formatBookingPeriod({ start_at: c.requested_start_at, end_at: c.requested_end_at })}
                    </td>
                    <td>
                      ¥{c.previous_amount.toLocaleString()} → ¥{c.new_amount.toLocaleString()}
                      {c.extra_amount > 0 && (
                        <>
                          <br />
                          <span className="policy">追加 ¥{c.extra_amount.toLocaleString()}</span>
                        </>
                      )}
                      {c.refund_amount > 0 && (
                        <>
                          <br />
                          <span className="policy">返金 ¥{c.refund_amount.toLocaleString()}</span>
                        </>
                      )}
                    </td>
                    <td>
                      <span
                        className={`status-badge ${
                          c.status === "approved"
                            ? "st-confirmed"
                            : c.status === "pending" || c.status === "pending_payment"
                              ? "st-pending"
                              : "st-cancelled"
                        }`}
                      >
                        {c.status === "approved"
                          ? "承認/確定"
                          : c.status === "pending"
                            ? "承認待ち"
                            : c.status === "pending_payment"
                              ? "決済待ち"
                              : c.status === "rejected"
                                ? "却下"
                                : "期限切れ"}
                      </span>
                    </td>
                    <td>
                      {c.reason}
                      {c.admin_note && (
                        <>
                          <br />
                          <span className="policy">メモ: {c.admin_note}</span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {adjs.length > 0 && (
          <div style={{ marginTop: "1.5rem" }}>
            <h3>料金調整履歴</h3>
            <table className="legal-table" style={{ fontSize: "0.9rem" }}>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>種別</th>
                  <th>変更</th>
                  <th>状態</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {adjs.map((a) => (
                  <tr key={a.id}>
                    <td>{new Date(a.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                    <td>
                      {a.adjustment_type === "price_decrease"
                        ? "減額"
                        : a.adjustment_type === "price_increase"
                          ? "増額"
                          : "キャンセル料変更"}
                    </td>
                    <td>
                      ¥{a.previous_amount.toLocaleString()} → ¥{a.new_amount.toLocaleString()}
                      <br />
                      <span className="policy">
                        {a.amount_delta > 0 ? `+¥${a.amount_delta.toLocaleString()}` : `¥${a.amount_delta.toLocaleString()}`}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-badge ${a.status === "completed" ? "st-confirmed" : a.status === "pending_payment" ? "st-pending" : "st-cancelled"}`}
                      >
                        {a.status === "completed"
                          ? "完了"
                          : a.status === "pending_payment"
                            ? "決済待ち"
                            : a.status === "expired"
                              ? "期限切れ"
                              : "失敗"}
                      </span>
                    </td>
                    <td>{a.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
