import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { getDb } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { sendAdminAlert, sendMail } from "@/lib/mail";
import { formatBookingPeriod } from "@/lib/confirm";
import {
  validateTimeRange,
  checkTimeSlotAvailable,
  calcChangeAmounts,
  canSelfChange,
  classifyChange,
  EXTEND_CHECKOUT_EXPIRY_SECONDS,
} from "@/lib/change-request";
import { effectiveTotal } from "@/lib/adjustment";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/booking/change-request
 * お客様セルフの予約時間変更申請。
 * - 延長: 仮押さえ → Checkout発行 → 決済完了で確定（Webhook）
 * - 短縮/時間ずらし: pending申請を作成 → 管理者承認で確定
 * 利用2時間前まで・確定予約のみ・重複申請不可。
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  let body: { bookingId?: string; startAt?: string; endAt?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const bookingId = body.bookingId ?? "";
  const startAtIso = body.startAt ?? "";
  const endAtIso = body.endAt ?? "";
  const reason = (body.reason ?? "").trim();

  if (!/^[0-9a-f-]{36}$/.test(bookingId)) {
    return NextResponse.json({ error: "予約IDが不正です" }, { status: 400 });
  }
  const start = new Date(startAtIso);
  const end = new Date(endAtIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return NextResponse.json({ error: "日時の形式が不正です" }, { status: 400 });
  }
  if (reason.length > 500) {
    return NextResponse.json({ error: "理由は500文字以内で入力してください" }, { status: 400 });
  }

  const db = getDb();
  const { data: booking } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (!booking || (booking.user_id !== user.id && booking.customer_email !== user.email)) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }

  const now = new Date();
  const eligible = canSelfChange(booking, now);
  if (!eligible.ok) return NextResponse.json({ error: eligible.reason }, { status: 400 });

  const { data: venue } = await db
    .from("venues")
    .select("*")
    .eq("id", booking.venue_id)
    .single<Venue>();
  if (!venue) return NextResponse.json({ error: "拠点情報が取得できません" }, { status: 500 });

  const vr = validateTimeRange(venue, start, end);
  if (!vr.ok) return NextResponse.json({ error: vr.reason }, { status: 400 });

  const previous = { start: new Date(booking.start_at), end: new Date(booking.end_at) };
  if (previous.start.getTime() === start.getTime() && previous.end.getTime() === end.getTime()) {
    return NextResponse.json({ error: "現在の時間と同じです" }, { status: 400 });
  }

  // 重複申請禁止
  const { data: activeReq } = await db
    .from("booking_change_requests")
    .select("id, status")
    .eq("booking_id", bookingId)
    .in("status", ["pending", "pending_payment"])
    .maybeSingle();
  if (activeReq) {
    return NextResponse.json(
      { error: "現在処理中の変更申請があります。完了またはキャンセル後にお試しください。" },
      { status: 409 }
    );
  }

  // 空き状況チェック
  const avail = await checkTimeSlotAvailable(
    venue.id,
    bookingId,
    { start, end },
    venue.calendar_id
  );
  if (!avail.ok) return NextResponse.json({ error: avail.reason }, { status: 409 });

  const amounts = calcChangeAmounts(booking, venue, previous, { start, end }, now);
  const kind = classifyChange(previous, { start, end });
  const currentEffective = effectiveTotal(booking);

  // change_request 作成（先にDB登録 → UNIQUE制約で他リクエスト排除）
  const isExtend = kind === "extend" || (kind === "shift" && amounts.extraAmount > 0);
  const requestType = isExtend ? "self_extend" : "self_modify";

  const { data: cr, error: crErr } = await db
    .from("booking_change_requests")
    .insert({
      booking_id: bookingId,
      request_type: requestType,
      previous_start_at: booking.start_at,
      previous_end_at: booking.end_at,
      requested_start_at: start.toISOString(),
      requested_end_at: end.toISOString(),
      previous_amount: currentEffective,
      new_amount: amounts.newAmount,
      refund_amount: amounts.refundAmount,
      extra_amount: amounts.extraAmount,
      cancel_fee_basis_at: now.toISOString(),
      status: isExtend ? "pending_payment" : "pending",
      reason,
    })
    .select("id")
    .single();
  if (crErr || !cr) {
    if (crErr?.message?.includes("idx_change_requests_one_active_per_booking")) {
      return NextResponse.json({ error: "現在処理中の変更申請があります" }, { status: 409 });
    }
    return NextResponse.json({ error: `申請の作成に失敗しました: ${crErr?.message ?? "unknown"}` }, { status: 500 });
  }
  const changeRequestId = (cr as { id: string }).id;

  if (isExtend) {
    // 延長: Stripe Checkout で追加請求
    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://bluespacerental.com";
    const oldPeriod = formatBookingPeriod(booking);
    const newPeriod = formatBookingPeriod({ start_at: start.toISOString(), end_at: end.toISOString() });

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        currency: "jpy",
        line_items: [
          {
            price_data: {
              currency: "jpy",
              unit_amount: amounts.extraAmount,
              product_data: {
                name: `予約延長 ${venue.name}`,
                description: `${oldPeriod} → ${newPeriod}`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          change_request_id: changeRequestId,
          booking_id: bookingId,
        },
        customer_email: booking.customer_email,
        success_url: `${baseUrl}/my/${bookingId}?changed=1`,
        cancel_url: `${baseUrl}/my/${bookingId}`,
        expires_at: Math.floor(Date.now() / 1000) + EXTEND_CHECKOUT_EXPIRY_SECONDS,
      },
      { idempotencyKey: `cr-ext-${changeRequestId}` }
    );

    await db
      .from("booking_change_requests")
      .update({ stripe_session_id: session.id })
      .eq("id", changeRequestId);

    await sendAdminAlert(
      `予約延長申請（決済待ち）${venue.name}`,
      [
        `お客様: ${booking.customer_name} <${booking.customer_email}>`,
        `変更前: ${oldPeriod}`,
        `変更後: ${newPeriod}`,
        `追加料金: ¥${amounts.extraAmount.toLocaleString()}`,
        `理由: ${reason || "(なし)"}`,
      ].join("\n")
    );

    return NextResponse.json({
      ok: true,
      type: "extend_pending_payment",
      checkoutUrl: session.url,
      extraAmount: amounts.extraAmount,
      changeRequestId,
    });
  }

  // 短縮/時間ずらし: pending → 管理者承認待ち
  await sendMail({
    to: booking.customer_email,
    subject: `【予約変更申請を受け付けました】${venue.name}`,
    text: [
      `${booking.customer_name} 様`,
      "",
      "予約時間の変更申請を受け付けました。管理者が確認のうえ、承認/却下のご連絡をいたします。",
      "",
      `▼申請内容`,
      `スペース: ${venue.name}`,
      `変更前: ${formatBookingPeriod(booking)}`,
      `変更後: ${formatBookingPeriod({ start_at: start.toISOString(), end_at: end.toISOString() })}`,
      amounts.refundAmount > 0
        ? `差額返金見込み: ¥${amounts.refundAmount.toLocaleString()}（管理者承認後に処理）`
        : `料金: 変更なし（キャンセルポリシー有料区間のため）`,
      `理由: ${reason || "(なし)"}`,
      "",
      "申請が72時間以内に処理されなかった場合は、自動的に取り下げとなります。",
      "",
      "ブルーステージ合同会社",
    ].join("\n"),
  });
  await sendAdminAlert(
    `🔔 予約変更申請（要承認）${venue.name}`,
    [
      `お客様: ${booking.customer_name} <${booking.customer_email}>`,
      `変更前: ${formatBookingPeriod(booking)}`,
      `変更後: ${formatBookingPeriod({ start_at: start.toISOString(), end_at: end.toISOString() })}`,
      amounts.refundAmount > 0 ? `差額返金見込み: ¥${amounts.refundAmount.toLocaleString()}` : `料金: 据え置き`,
      `理由: ${reason || "(なし)"}`,
      "",
      `承認/却下: ${process.env.NEXT_PUBLIC_BASE_URL || "https://bluespacerental.com"}/admin/bookings/${bookingId}`,
    ].join("\n")
  );

  return NextResponse.json({
    ok: true,
    type: "shorten_pending_approval",
    refundAmount: amounts.refundAmount,
    changeRequestId,
  });
}
