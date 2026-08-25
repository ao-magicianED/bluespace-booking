import { NextRequest, NextResponse } from "next/server";
import { getAvailability, getVenueBySlug } from "@/lib/availability";
import { resolveTier } from "@/lib/entry-tier";
import { QuoteError } from "@/lib/quote";
import { isValidDateStr, todayJst } from "@/lib/slots";

export const dynamic = "force-dynamic";

/**
 * GET /api/availability?venue=keisei-koiwa&from=2026-06-11
 * 価格ティアはCookie（署名＋DB照合）のみで判定する。query等でのティア指定は受け付けない。
 * repeat価格がエッジキャッシュ経由で公開URLに配られないよう常に no-store。
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("venue") ?? "";
  const from = req.nextUrl.searchParams.get("from") ?? todayJst();

  const noStore = { "Cache-Control": "private, no-store" };

  if (!slug) {
    return NextResponse.json({ error: "venue を指定してください" }, { status: 400, headers: noStore });
  }
  if (!isValidDateStr(from)) {
    return NextResponse.json({ error: "from の形式が不正です" }, { status: 400, headers: noStore });
  }

  try {
    const venue = await getVenueBySlug(slug);
    if (!venue) {
      return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404, headers: noStore });
    }
    const tier = await resolveTier();
    const availability = await getAvailability(venue, from, 7, tier);
    const headers: Record<string, string> = { ...noStore };
    if (availability.pricing?.tier === "repeat") {
      headers["X-Robots-Tag"] = "noindex";
    }
    return NextResponse.json(availability, { headers });
  } catch (e) {
    if (e instanceof QuoteError) {
      return NextResponse.json({ error: e.message }, { status: e.status, headers: noStore });
    }
    console.error("[availability]", e);
    return NextResponse.json(
      { error: "空き状況の取得に失敗しました" },
      { status: 500, headers: noStore }
    );
  }
}
