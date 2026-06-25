import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { applyOperationPreview, type AiOperationPreview } from "@/lib/ai-ops";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ApplyBody = { operationId?: string };

/** POST /api/admin/ai-ops/apply — apply a previously previewed admin operation */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: ApplyBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const operationId = body.operationId ?? "";
  if (!/^[0-9a-f-]{36}$/.test(operationId)) {
    return NextResponse.json({ error: "operationIdが不正です" }, { status: 400 });
  }

  const db = getDb();
  const { data: log, error: fetchError } = await db
    .from("ai_operation_logs")
    .select("id, status, preview")
    .eq("id", operationId)
    .maybeSingle();

  if (fetchError) {
    console.error("[admin/ai-ops/apply] fetch", fetchError);
    return NextResponse.json({ error: "操作ログの取得に失敗しました" }, { status: 500 });
  }
  if (!log) return NextResponse.json({ error: "操作ログが見つかりません" }, { status: 404 });
  if (log.status !== "previewed") {
    return NextResponse.json({ error: `この操作は適用できません（現在の状態: ${log.status}）` }, { status: 409 });
  }

  try {
    const result = await applyOperationPreview(db, log.preview as AiOperationPreview);
    const { error: updateError } = await db
      .from("ai_operation_logs")
      .update({ status: "applied", applied_result: result, applied_at: new Date().toISOString(), error_message: null })
      .eq("id", operationId);
    if (updateError) {
      console.error("[admin/ai-ops/apply] log update", updateError);
      return NextResponse.json({ error: "変更は適用されましたが、監査ログ更新に失敗しました" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "適用に失敗しました";
    await db
      .from("ai_operation_logs")
      .update({ status: "failed", error_message: message })
      .eq("id", operationId);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
