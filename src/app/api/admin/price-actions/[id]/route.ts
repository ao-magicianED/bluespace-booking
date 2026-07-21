import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { recordPriceActionResult, type PriceActionStatus } from "@/lib/price-actions";

export const dynamic = "force-dynamic";

const STATUSES: PriceActionStatus[] = ["draft", "applied", "reverted", "expired"];

/**
 * PATCH /api/admin/price-actions/[id] — スタッフが実際に設定した結果を記録する。
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "IDが不正です" }, { status: 400 });
  }

  let body: { status?: string; appliedPrice?: number | null; appliedBy?: string; resultNote?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const status = body.status as PriceActionStatus;
  if (!STATUSES.includes(status)) {
    return NextResponse.json({ error: "ステータスの指定が不正です" }, { status: 400 });
  }
  const appliedPrice =
    body.appliedPrice == null || Number.isNaN(Number(body.appliedPrice)) ? null : Number(body.appliedPrice);
  const appliedBy = (body.appliedBy ?? "").trim().slice(0, 50) || "スタッフ";
  const resultNote = (body.resultNote ?? "").trim().slice(0, 500) || null;

  try {
    await recordPriceActionResult(id, { status, appliedPrice, appliedBy, resultNote });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
