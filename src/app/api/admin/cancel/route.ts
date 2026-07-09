import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { calcRefund } from "@/lib/cancellation";
import { executeCancellation } from "@/lib/cancel-booking";
import { effectiveTotal } from "@/lib/adjustment";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/cancel
 * 管理者によるキャンセル。mode:
 *   "policy" = 段階制ポリシーどおりの返金
 *   "full"   = 全額返金（運営都合キャンセル等）
 *   "custom" = カスタムキャンセル料（customFeeAmountで手数料額を指定）
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { bookingId?: string; mode?: string; customFeeAmount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const bookingId = body.bookingId ?? "";
  const mode = body.mode === "full" ? "full" : body.mode === "custom" ? "custom" : "policy";
  if (!/^[0-9a-f-]{36}$/.test(bookingId)) {
    return NextResponse.json({ error: "予約IDが不正です" }, { status: 400 });
  }

  const db = getDb();
  const { data: booking } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (!booking) return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  if (booking.booking_status !== "confirmed" || booking.payment_status === "refunded") {
    return NextResponse.json({ error: "確定済み（未全額返金）の予約のみキャンセルできます" }, { status: 400 });
  }

  const { data: venue } = await db.from("venues").select("*").eq("id", booking.venue_id).single<Venue>();
  const effective = effectiveTotal(booking);

  let refundAmount: number;
  let feeAmount: number;
  let tierLabel: string;
  if (mode === "full") {
    refundAmount = effective;
    feeAmount = 0;
    tierLabel = "管理者判断・全額返金";
  } else if (mode === "custom") {
    const customFee = body.customFeeAmount;
    if (typeof customFee !== "number" || !Number.isInteger(customFee) || customFee < 0 || customFee > effective) {
      return NextResponse.json(
        { error: `キャンセル料は0〜¥${effective.toLocaleString()}の整数で指定してください` },
        { status: 400 }
      );
    }
    feeAmount = customFee;
    refundAmount = effective - feeAmount;
    tierLabel = "管理者判断・カスタム";
  } else {
    const r = calcRefund(
      effective,
      new Date(booking.start_at),
      new Date(),
      venue?.cancellation_policy ?? null
    );
    refundAmount = r.refundAmount;
    feeAmount = r.feeAmount;
    tierLabel = `${r.tierLabel}・${r.feePercent}%`;
  }

  const result = await executeCancellation({
    booking,
    venue: venue ?? null,
    refundAmount,
    feeAmount,
    tierLabel,
    reason:
      mode === "full"
        ? "admin_cancel_full_refund"
        : mode === "custom"
          ? "admin_cancel_custom_fee"
          : "admin_cancel_policy",
    cancelledBy: "管理者",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  // 監査ログ（カスタムキャンセル料の場合のみ）。キャンセル成功後に記録することで、
  // 競合等でキャンセル自体が失敗したとき（409）に虚偽の「返金完了」記録が残らないようにする
  if (mode === "custom") {
    await db.from("booking_adjustments").insert({
      booking_id: bookingId,
      adjustment_type: "cancel_fee_override",
      previous_amount: effective,
      new_amount: 0,
      amount_delta: -effective,
      reason: `キャンセル料 ¥${feeAmount.toLocaleString()} / 返金 ¥${refundAmount.toLocaleString()}`,
      status: "completed",
    });
  }

  return NextResponse.json({ ok: true, refundAmount });
}
