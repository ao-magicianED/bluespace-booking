import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { runConfirmationSideEffects } from "@/lib/confirm";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/** POST /api/admin/resync — カレンダー同期/確認メールの再試行（冪等） */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

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
  if (!booking || booking.booking_status !== "confirmed") {
    return NextResponse.json({ error: "確定済みの予約が見つかりません" }, { status: 404 });
  }
  const { data: venue } = await db.from("venues").select("*").eq("id", booking.venue_id).single<Venue>();
  if (!venue) return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });

  await runConfirmationSideEffects(booking, venue, false);

  const { data: after } = await db
    .from("bookings")
    .select("calendar_sync_status, confirmation_email_sent_at")
    .eq("id", bookingId)
    .single();
  return NextResponse.json({ ok: true, ...after });
}
