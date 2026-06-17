import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** POST /api/admin/venue-access — 拠点の入退室案内を更新（管理者のみ） */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { venueId?: string; accessInfo?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const venueId = body.venueId ?? "";
  const accessInfo = (body.accessInfo ?? "").trim();
  if (!/^[0-9a-f-]{36}$/.test(venueId)) {
    return NextResponse.json({ error: "拠点IDが不正です" }, { status: 400 });
  }
  if (accessInfo.length > 10000) {
    return NextResponse.json({ error: "本文が長すぎます（10,000文字まで）" }, { status: 400 });
  }

  const { error } = await getDb()
    .from("venues")
    .update({ access_info: accessInfo })
    .eq("id", venueId);
  if (error) {
    console.error("[admin/venue-access]", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
