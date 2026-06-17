import { NextRequest, NextResponse } from "next/server";
import { getAvailability, getVenueBySlug } from "@/lib/availability";
import { isValidDateStr, todayJst } from "@/lib/slots";

export const dynamic = "force-dynamic";

/** GET /api/availability?venue=keisei-koiwa&from=2026-06-11 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("venue") ?? "";
  const from = req.nextUrl.searchParams.get("from") ?? todayJst();

  if (!slug) {
    return NextResponse.json({ error: "venue を指定してください" }, { status: 400 });
  }
  if (!isValidDateStr(from)) {
    return NextResponse.json({ error: "from の形式が不正です" }, { status: 400 });
  }

  try {
    const venue = await getVenueBySlug(slug);
    if (!venue) {
      return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });
    }
    const availability = await getAvailability(venue, from, 7);
    return NextResponse.json(availability);
  } catch (e) {
    console.error("[availability]", e);
    return NextResponse.json({ error: "空き状況の取得に失敗しました" }, { status: 500 });
  }
}
