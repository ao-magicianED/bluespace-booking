import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth-server";
import { getDb } from "@/lib/supabase";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST /api/receipt — 領収書の宛名を保存し、初回発行日時を記録する（要ログイン・本人のみ） */
export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  let body: { bookingId?: string; name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const bookingId = body.bookingId ?? "";
  if (!name || name.length > 100 || !/^[0-9a-f-]{36}$/.test(bookingId)) {
    return NextResponse.json({ error: "入力内容が正しくありません" }, { status: 400 });
  }

  const db = getDb();
  const { data: booking } = await db
    .from("bookings")
    .select(
      "id, user_id, customer_email, booking_status, payment_status, receipt_name, receipt_first_issued_at, receipt_name_changed_at"
    )
    .eq("id", bookingId)
    .maybeSingle<
      Pick<
        Booking,
        | "id"
        | "user_id"
        | "customer_email"
        | "booking_status"
        | "payment_status"
        | "receipt_name"
        | "receipt_first_issued_at"
        | "receipt_name_changed_at"
      >
    >();

  if (!booking || (booking.user_id !== user.id && booking.customer_email !== user.email)) {
    return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  }
  if (booking.booking_status !== "confirmed" || booking.payment_status !== "paid") {
    return NextResponse.json({ error: "決済済みの予約のみ発行できます" }, { status: 400 });
  }

  // 宛名の「変更」は1回まで（発行済みで、保存済みの宛名と異なる場合のみ変更扱い）
  const isNameChange = Boolean(
    booking.receipt_first_issued_at && booking.receipt_name && name !== booking.receipt_name
  );
  if (isNameChange && booking.receipt_name_changed_at) {
    return NextResponse.json(
      { error: "宛名の変更は1回までです。これ以上変更できません" },
      { status: 400 }
    );
  }

  const { error } = await db
    .from("bookings")
    .update({
      receipt_name: name,
      receipt_first_issued_at: booking.receipt_first_issued_at ?? new Date().toISOString(),
      ...(isNameChange ? { receipt_name_changed_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
  if (error) {
    console.error("[receipt]", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
