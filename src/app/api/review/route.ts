import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { checkRateLimit } from "@/lib/rate-limit";
import { isReviewEligible, normalizeReviewInput } from "@/lib/reviews";
import { sendAdminAlert } from "@/lib/mail";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/review — レビュー投稿（レビュー依頼メールのトークンURL経由）。
 * 認証はreview_token（予約ごとの秘密UUID）。1予約1レビュー（DBのunique制約が本命ガード）。
 * 投稿は承認待ち(pending)で保存し、管理者が /admin/reviews で公開する。
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`review:${ip}`, 5)) {
    return NextResponse.json({ error: "しばらく時間をおいてお試しください" }, { status: 429 });
  }

  let body: {
    token?: string;
    rating?: unknown;
    comment?: unknown;
    purpose?: unknown;
    reviewerName?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const token = body.token ?? "";
  if (!/^[0-9a-f-]{36}$/.test(token)) {
    return NextResponse.json({ error: "URLが不正です" }, { status: 400 });
  }

  const input = normalizeReviewInput(body);
  if (!input.ok) {
    return NextResponse.json({ error: input.error }, { status: 400 });
  }

  const db = getDb();
  const { data: booking } = await db
    .from("bookings")
    .select("*, venues(name)")
    .eq("review_token", token)
    .maybeSingle<Booking & { venues: { name: string } | null }>();
  if (!booking) {
    return NextResponse.json({ error: "対象のご予約が見つかりません" }, { status: 404 });
  }

  const eligible = isReviewEligible(booking, new Date());
  if (!eligible.ok) {
    const msg =
      eligible.reason === "not_ended"
        ? "ご利用終了後にレビューを投稿いただけます"
        : eligible.reason === "window_expired"
          ? "レビューの受付期間（ご利用後30日間）を過ぎています"
          : "このご予約はレビューを投稿できません";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const { error } = await db.from("booking_reviews").insert({
    booking_id: booking.id,
    venue_id: booking.venue_id,
    rating: input.rating,
    comment: input.comment,
    purpose: input.purpose,
    reviewer_name: input.reviewerName,
    status: "pending",
  });
  if (error) {
    // unique違反 = 投稿済み
    if (error.code === "23505") {
      return NextResponse.json({ error: "このご予約のレビューは投稿済みです" }, { status: 409 });
    }
    console.error("[review] insert error:", error);
    return NextResponse.json({ error: "投稿に失敗しました" }, { status: 500 });
  }

  await sendAdminAlert(
    "⭐ 新しいレビューが届きました（承認待ち）",
    [
      `拠点: ${booking.venues?.name ?? ""}`,
      `評価: ${"★".repeat(input.rating)}${"☆".repeat(5 - input.rating)}（${input.rating}/5）`,
      `用途: ${input.purpose || "（未記入）"}`,
      `コメント: ${input.comment || "（なし）"}`,
      "",
      "管理画面 → レビュー管理 から承認すると拠点ページに公開されます。",
    ].join("\n")
  );

  return NextResponse.json({ ok: true });
}
