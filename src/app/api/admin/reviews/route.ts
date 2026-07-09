import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/reviews — レビューの承認・非公開・運営返信（管理者のみ）。
 * action:
 * - publish: 公開（published_at を設定）
 * - reject: 非公開化（公開済みの取り下げにも使う）
 * - reply: 運営返信の保存（空文字で返信削除）
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { reviewId?: string; action?: string; reply?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const reviewId = body.reviewId ?? "";
  if (!/^[0-9a-f-]{36}$/.test(reviewId)) {
    return NextResponse.json({ error: "レビューIDが不正です" }, { status: 400 });
  }

  const db = getDb();

  if (body.action === "publish") {
    const { error } = await db
      .from("booking_reviews")
      .update({ status: "published", published_at: new Date().toISOString() })
      .eq("id", reviewId);
    if (error) return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reject") {
    const { error } = await db
      .from("booking_reviews")
      .update({ status: "rejected" })
      .eq("id", reviewId);
    if (error) return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (body.action === "reply") {
    const reply = String(body.reply ?? "").trim().slice(0, 1000);
    const { error } = await db
      .from("booking_reviews")
      .update({
        host_reply: reply || null,
        host_replied_at: reply ? new Date().toISOString() : null,
      })
      .eq("id", reviewId);
    if (error) return NextResponse.json({ error: "更新に失敗しました" }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "不明な操作です" }, { status: 400 });
}
