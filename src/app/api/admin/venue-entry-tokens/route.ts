import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/admin/venue-entry-tokens — 現地QR入口トークンの発行・失効（管理者のみ）。
 * - action: "create"     … { venueId, label } 新規発行（active=true）
 * - action: "set_active" … { token, active }  有効/失効の切替（失効＝キルスイッチ）
 * トークンの物理削除はしない（発行履歴を監査として残す）。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: {
    action?: string;
    venueId?: string | null;
    label?: string;
    token?: string;
    active?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const db = getDb();

  if (body.action === "create") {
    const venueId = body.venueId ?? null;
    if (venueId !== null && !/^[0-9a-f-]{36}$/.test(venueId)) {
      return NextResponse.json({ error: "拠点IDが不正です" }, { status: 400 });
    }
    const label = (body.label ?? "").trim().slice(0, 100);
    const { data, error } = await db
      .from("venue_entry_tokens")
      .insert({ venue_id: venueId, label: label || null })
      .select("token")
      .single();
    if (error || !data) {
      console.error("[admin/venue-entry-tokens] create", error);
      return NextResponse.json({ error: "発行に失敗しました" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, token: (data as { token: string }).token });
  }

  if (body.action === "set_active") {
    const token = (body.token ?? "").toLowerCase();
    if (!UUID_RE.test(token) || typeof body.active !== "boolean") {
      return NextResponse.json({ error: "指定が不正です" }, { status: 400 });
    }
    const { data, error } = await db
      .from("venue_entry_tokens")
      .update({ active: body.active })
      .eq("token", token)
      .select("token");
    if (error || !data || data.length === 0) {
      console.error("[admin/venue-entry-tokens] set_active", error);
      return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "actionが不正です" }, { status: 400 });
}
