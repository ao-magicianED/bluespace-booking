import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type BandInput = {
  tier?: string;
  startHour?: number;
  endHour?: number;
  hourlyPrice?: number;
};

/** RPCのraise exceptionを管理者向けの日本語に変換 */
function rpcErrorMessage(message: string): string {
  if (message.includes("band_coverage_invalid")) {
    return "時間帯が0〜24時を隙間・重複なく覆っていません（両ティアとも必要です）";
  }
  if (message.includes("tier_order_violation")) {
    return "standard価格がrepeat価格を下回る時間帯があります（standard ≥ repeat が必要）";
  }
  if (message.includes("invalid_band_price")) {
    return "価格は0以上の10円単位で入力してください";
  }
  if (message.includes("invalid_band_range")) {
    return "時間帯の範囲が不正です（0〜24時・開始<終了）";
  }
  if (message.includes("invalid_tier") || message.includes("invalid_bands")) {
    return "帯データの形式が不正です";
  }
  if (message.includes("invalid_day_type")) {
    return "日種（平日/土日祝）の指定が不正です";
  }
  if (message.includes("venue_not_found")) {
    return "拠点が見つかりません";
  }
  return `保存に失敗しました: ${message}`;
}

/**
 * POST /api/admin/venue-price-bands — 時間帯別料金の全置換（管理者のみ）。
 * 検証と置換は replace_venue_price_bands RPC（1トランザクション・advisory lock）が行う。
 * UI側のバリデーションは補助で、最終防衛はRPC内の検証（手動SQL・並行操作にも効く）。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { venueId?: string; dayType?: string; bands?: BandInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const venueId = body.venueId ?? "";
  const dayType = body.dayType ?? "";
  if (!/^[0-9a-f-]{36}$/.test(venueId)) {
    return NextResponse.json({ error: "拠点IDが不正です" }, { status: 400 });
  }
  if (dayType !== "weekday" && dayType !== "holiday") {
    return NextResponse.json({ error: "日種の指定が不正です" }, { status: 400 });
  }
  if (!Array.isArray(body.bands) || body.bands.length === 0 || body.bands.length > 96) {
    return NextResponse.json({ error: "帯データが不正です" }, { status: 400 });
  }

  const bands = body.bands.map((b) => ({
    tier: b.tier === "repeat" ? "repeat" : "standard",
    start_hour: Number(b.startHour),
    end_hour: Number(b.endHour),
    hourly_price: Number(b.hourlyPrice),
  }));
  if (bands.some((b) => !Number.isInteger(b.start_hour) || !Number.isInteger(b.end_hour) || !Number.isInteger(b.hourly_price))) {
    return NextResponse.json({ error: "時刻は整数時、価格は整数円で入力してください" }, { status: 400 });
  }

  const { error } = await getDb().rpc("replace_venue_price_bands", {
    p_venue_id: venueId,
    p_day_type: dayType,
    p_bands: bands,
  });
  if (error) {
    console.error("[admin/venue-price-bands]", error);
    return NextResponse.json({ error: rpcErrorMessage(error.message ?? "") }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
