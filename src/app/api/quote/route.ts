import { NextRequest, NextResponse } from "next/server";
import { getVenueBySlug } from "@/lib/availability";
import { buildQuote, QuoteError } from "@/lib/quote";
import { jstToUtc, validateBookingRequest } from "@/lib/slots";
import { checkRateLimit } from "@/lib/rate-limit";
import { calcInvoiceDueAt, isInvoiceEligible } from "@/lib/invoice";

export const dynamic = "force-dynamic";

/**
 * POST /api/quote
 * 予約前の見積もり（休日料金・割引・オプション・クーポンの内訳）を返す。
 * 決済時の /api/checkout と同じ計算関数を使うため、表示額と請求額は必ず一致する。
 * invoicePreview: 請求書払いを選んだ場合の支払期限を「申込前」に見せるためのプレビュー
 * （法人担当者が経理承認・振込手配に間に合うか判断できるように。§6.1参照）。
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`quote:${ip}`, 120)) {
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

    const startAt = jstToUtc(body.date, body.startHour);
    const eligible = isInvoiceEligible(startAt, now);
    const invoicePreview = eligible
      ? await (async () => {
          const due = await calcInvoiceDueAt(startAt, now);
          return {
            eligible: true,
            dueAt: due.dueAt.toISOString(),
            dueOnNonBusinessDay: due.dueOnNonBusinessDay,
            cappedBy: due.cappedBy as string,
          };
        })()
      : { eligible: false, dueAt: null, dueOnNonBusinessDay: false, cappedBy: null as string | null };

    return NextResponse.json({ breakdown, invoicePreview });
  } catch (e) {
    if (e instanceof QuoteError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    console.error("[quote]", e);
    return NextResponse.json({ error: "見積もりの計算に失敗しました" }, { status: 500 });
  }
}
