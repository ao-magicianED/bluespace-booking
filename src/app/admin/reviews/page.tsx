import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import AdminReviewActions from "@/components/AdminReviewActions";
import type { BookingReview } from "@/lib/reviews";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "⏳ 承認待ち",
  published: "✅ 公開中",
  rejected: "🚫 非公開",
};

type ReviewRow = BookingReview & {
  venues: { name: string } | null;
  bookings: { customer_name: string; customer_email: string; start_at: string } | null;
};

export default async function AdminReviewsPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const db = getDb();
  const { data } = await db
    .from("booking_reviews")
    .select("*, venues(name), bookings(customer_name, customer_email, start_at)")
    .order("submitted_at", { ascending: false })
    .limit(200);
  const reviews = (data ?? []) as ReviewRow[];
  const pendingCount = reviews.filter((r) => r.status === "pending").length;

  return (
    <>
      <p>
        <Link href="/admin">← 管理ダッシュボードへ戻る</Link>
      </p>
      <h1>レビュー管理</h1>
      <p className="policy">
        承認したレビューだけが拠点ページに公開されます。
        {pendingCount > 0 ? ` 現在 ${pendingCount} 件が承認待ちです。` : " 承認待ちはありません。"}
      </p>

      {reviews.length === 0 && <p>レビューはまだありません。</p>}

      <div className="admin-review-list">
        {reviews.map((r) => (
          <div key={r.id} className="admin-review-card">
            <div className="admin-review-head">
              <strong>{r.venues?.name ?? "（拠点不明）"}</strong>
              <span className="review-stars" aria-label={`星${r.rating}つ`}>
                {"★".repeat(r.rating)}
                {"☆".repeat(5 - r.rating)}
              </span>
              <span>{STATUS_LABEL[r.status] ?? r.status}</span>
            </div>
            <p className="policy">
              投稿: {new Date(r.submitted_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
              　利用日: {r.bookings ? new Date(r.bookings.start_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "-"}
              　予約者: {r.bookings?.customer_name ?? "-"}（{r.bookings?.customer_email ?? "-"}）
              　表示名: {r.reviewer_name || "（未入力→「ご利用者」表示）"}
              {r.purpose && `　用途: ${r.purpose}`}
            </p>
            {r.comment ? <blockquote>{r.comment}</blockquote> : <p className="policy">（コメントなし・星評価のみ）</p>}
            {r.host_reply && (
              <p className="admin-review-hostreply">
                <strong>運営返信:</strong> {r.host_reply}
              </p>
            )}
            <AdminReviewActions reviewId={r.id} status={r.status} hostReply={r.host_reply} />
          </div>
        ))}
      </div>
    </>
  );
}
