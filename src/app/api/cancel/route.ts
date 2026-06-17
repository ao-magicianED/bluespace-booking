import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { getDb } from "@/lib/supabase";
import { calcRefund } from "@/lib/cancellation";
import { executeCancellation } from "@/lib/cancel-booking";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/cancel
 * 会員本人によるキャンセル → 段階制ポリシーで返金額算出 → 共通キャンセル処理
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  let body: { bookingId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const bookingId = body.bookingId ?? "";
  if (!/^[0-9a-f-]{36}$/.test(bookingId)) {
    return NextResponse.json({ error: "予約IDが不正です" }, { status: 400 });
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
  if (booking.booking_status !== "confirmed" || booking.payment_status !== "paid") {
    return NextResponse.json({ error: "確定済みの予約のみキャンセルできます" }, { status: 400 });
  }

  const { data: venue } = await db.from("venues").select("*").eq("id", booking.venue_id).single<Venue>();
  const refund = calcRefund(
    booking.total_amount,
    new Date(booking.start_at),
    new Date(),
    venue?.cancellation_policy ?? null
  );

  const result = await executeCancellation({
    booking,
    venue: venue ?? null,
    refundAmount: refund.refundAmount,
    feeAmount: refund.feeAmount,
    tierLabel: `${refund.tierLabel}・${refund.feePercent}%`,
    reason: "user_self_cancel",
    cancelledBy: "お客様ご本人",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({
    ok: true,
    refundAmount: refund.refundAmount,
    feeAmount: refund.feeAmount,
    tierLabel: refund.tierLabel,
  });
}
