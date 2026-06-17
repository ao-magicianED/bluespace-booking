import { NextRequest, NextResponse } from "next/server";
import { getVenueBySlug } from "@/lib/availability";
import { buildQuote, QuoteError } from "@/lib/quote";
import { validateBookingRequest } from "@/lib/slots";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/quote
 * 予約前の見積もり（休日料金・割引・オプション・クーポンの内訳）を返す。
 * 決済時の /api/checkout と同じ計算関数を使うため、表示額と請求額は必ず一致する。
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`quote:${ip}`, 60)) {
    return NextResponse.json({ error: "リクエストが多すぎます" }, { status: 429 });
  }

  try {
    const body = await req.json();
    const venue = await getVenueBySlug(body.venueSlug ?? "");
    if (!venue) {
      return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });
    }
    const now = new Date();
    const validationError = validateBookingRequest(venue, body.date, body.startHour, body.hours, now);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    const breakdown = await buildQuote(
      venue,
      body.date,
      body.startHour,
      body.hours,
      Array.isArray(body.optionIds) ? body.optionIds : [],
      typeof body.couponCode === "string" ? body.couponCode : "",
      now
    );
    return NextResponse.json({ breakdown });
  } catch (e) {
    if (e instanceof QuoteError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[quote]", e);
    return NextResponse.json({ error: "見積もりの計算に失敗しました" }, { status: 500 });
  }
}
