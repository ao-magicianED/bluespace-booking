import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { createPriceAction, validatePriceAction, type Channel } from "@/lib/price-actions";

export const dynamic = "force-dynamic";

const CHANNELS: Channel[] = ["instabase", "spacemarket", "upnow", "own"];

/**
 * POST /api/admin/price-actions — 週次の価格指示を1件作成する。
 * ガードレール（平日のみ・拠点別下限価格）に違反する場合は400で拒否する。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: {
    venueSlug?: string;
    targetDate?: string;
    startHour?: number;
    endHour?: number;
    channel?: string;
    previousPrice?: number | null;
    plannedPrice?: number;
    isHoldout?: boolean;
    reason?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const venueSlug = (body.venueSlug ?? "").trim();
  const targetDate = (body.targetDate ?? "").trim();
  const startHour = Number(body.startHour);
  const endHour = Number(body.endHour);
  const channel = body.channel as Channel;
  const plannedPrice = Number(body.plannedPrice);
  const previousPrice =
    body.previousPrice == null || Number.isNaN(Number(body.previousPrice))
      ? null
      : Number(body.previousPrice);
  const isHoldout = Boolean(body.isHoldout);
  const reason = (body.reason ?? "").trim().slice(0, 500);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: "対象日の形式が正しくありません" }, { status: 400 });
  }
  if (!CHANNELS.includes(channel)) {
    return NextResponse.json({ error: "チャネルの指定が不正です" }, { status: 400 });
  }
  if (!Number.isFinite(startHour) || !Number.isFinite(endHour) || !Number.isFinite(plannedPrice)) {
    return NextResponse.json({ error: "時刻・価格は数値で指定してください" }, { status: 400 });
  }

  const input = { venueSlug, targetDate, startHour, endHour, channel, previousPrice, plannedPrice, isHoldout, reason };
  const validation = await validatePriceAction(input);
  if (validation.blocked) {
    return NextResponse.json({ error: validation.errors.join(" / "), warnings: validation.warnings }, { status: 400 });
  }

  const db = getDb();
  const { data: venue } = await db.from("venues").select("id").eq("slug", venueSlug).maybeSingle<{ id: string }>();
  if (!venue) {
    return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });
  }

  try {
    const action = await createPriceAction({ ...input, venueId: venue.id });
    return NextResponse.json({ ok: true, action, warnings: validation.warnings });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
