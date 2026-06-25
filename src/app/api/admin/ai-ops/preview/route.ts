import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { buildOperationPreview, parseOperationInput, type AiOperationSource } from "@/lib/ai-ops";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type PreviewBody = {
  text?: string;
  operation?: unknown;
  source?: AiOperationSource;
};

/** POST /api/admin/ai-ops/preview — natural language/structured admin operation preview */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: PreviewBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  try {
    const db = getDb();
    const { requestText, operation } = await parseOperationInput(db, body);
    const preview = await buildOperationPreview(db, operation);
    const source = body.source ?? "admin_console";
    const { data: log, error } = await db
      .from("ai_operation_logs")
      .insert({
        actor: "admin",
        source,
        request_text: requestText,
        operation_type: preview.operationType,
        status: "previewed",
        preview,
      })
      .select("id, created_at")
      .single();

    if (error) {
      console.error("[admin/ai-ops/preview] log insert", error);
      return NextResponse.json({ error: "プレビュー記録の保存に失敗しました" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, operationId: log.id, createdAt: log.created_at, preview });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "解釈に失敗しました" }, { status: 400 });
  }
}
