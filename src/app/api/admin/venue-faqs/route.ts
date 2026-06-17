import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/venue-faqs — 拠点FAQの上書き保存（管理者のみ）。
 * faqs: null を送ると上書きを解除し、デフォルトFAQ表示に戻る。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { venueId?: string; faqs?: { q?: string; a?: string }[] | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const venueId = body.venueId ?? "";
  if (!/^[0-9a-f-]{36}$/.test(venueId)) {
    return NextResponse.json({ error: "拠点IDが不正です" }, { status: 400 });
  }

  let faqs: { q: string; a: string }[] | null = null;
  if (body.faqs !== null && body.faqs !== undefined) {
    if (!Array.isArray(body.faqs) || body.faqs.length > 30) {
      return NextResponse.json({ error: "FAQは30件までです" }, { status: 400 });
    }
    faqs = body.faqs
      .map((f) => ({ q: (f.q ?? "").trim().slice(0, 200), a: (f.a ?? "").trim().slice(0, 1000) }))
      .filter((f) => f.q && f.a);
    if (faqs.length === 0) {
      return NextResponse.json(
        { error: "質問と回答を1件以上入力してください（全削除する場合は「デフォルトに戻す」を使用）" },
        { status: 400 }
      );
    }
  }

  const { error } = await getDb().from("venues").update({ faqs }).eq("id", venueId);
  if (error) {
    console.error("[admin/venue-faqs]", error);
    return NextResponse.json({ error: "保存に失敗しました" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
