/**
 * 実利用者レビュー（純粋ロジック・型・定数）。
 * このファイルはクライアントコンポーネントからもimportされるため、DBアクセスを置かないこと
 * （DB取得は reviews-db.ts へ）。
 * 流れ: 利用完了 → cronがレビュー依頼メール送信（review_token付きURL）
 *      → /review/[token] から投稿 → 管理者が /admin/reviews で承認 → 拠点ページに公開。
 * 集計（平均・件数）は AggregateRating 構造化データにも使う。
 */

export type ReviewStatus = "pending" | "published" | "rejected";

export type BookingReview = {
  id: string;
  booking_id: string;
  venue_id: string;
  rating: number;
  comment: string;
  purpose: string;
  reviewer_name: string;
  status: ReviewStatus;
  host_reply: string | null;
  host_replied_at: string | null;
  submitted_at: string;
  published_at: string | null;
  created_at: string;
};

/** レビュー投稿の受付期間（利用終了からこの日数以内なら投稿可） */
export const REVIEW_WINDOW_DAYS = 30;

/** コメント・表示名の最大長（APIとフォームで共用） */
export const REVIEW_COMMENT_MAX = 1000;
export const REVIEW_NAME_MAX = 30;
export const REVIEW_PURPOSE_MAX = 50;

/** 星評価の集計結果 */
export type ReviewAggregate = {
  count: number;
  /** 平均（小数1桁に丸め）。count=0 のとき 0 */
  average: number;
};

/** 公開レビューから平均と件数を計算する（純粋関数） */
export function aggregateReviews(ratings: number[]): ReviewAggregate {
  if (ratings.length === 0) return { count: 0, average: 0 };
  const sum = ratings.reduce((s, r) => s + r, 0);
  return {
    count: ratings.length,
    average: Math.round((sum / ratings.length) * 10) / 10,
  };
}

/**
 * この予約がレビュー投稿を受け付けられる状態か（純粋関数）。
 * - 確定済み（confirmed）で利用が終了している
 * - 利用終了から REVIEW_WINDOW_DAYS 日以内
 */
export function isReviewEligible(
  booking: { booking_status: string; end_at: string },
  now: Date
): { ok: boolean; reason?: "not_confirmed" | "not_ended" | "window_expired" } {
  if (booking.booking_status !== "confirmed") return { ok: false, reason: "not_confirmed" };
  const end = new Date(booking.end_at).getTime();
  if (end > now.getTime()) return { ok: false, reason: "not_ended" };
  const windowMs = REVIEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  if (now.getTime() - end > windowMs) return { ok: false, reason: "window_expired" };
  return { ok: true };
}

/** UUID形式の厳密チェック（DB側のcastエラー誘発を防ぐ） */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 制御文字（改行・タブ以外のC0/DEL）とBidi制御文字（RLO/LRO等）を除去する（表示崩し対策）。
 * \uXXXX エスケープで組み立てる（ソース中に生の制御文字を埋め込まない）。
 */
const CONTROL_CHARS_RE = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F" +
    "\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]",
  "g"
);

function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHARS_RE, "");
}

/** 投稿内容の検証・正規化（純粋関数。API側で使用） */
export function normalizeReviewInput(input: {
  rating?: unknown;
  comment?: unknown;
  purpose?: unknown;
  reviewerName?: unknown;
}):
  | { ok: true; rating: number; comment: string; purpose: string; reviewerName: string }
  | { ok: false; error: string } {
  const rating = Number(input.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "評価は1〜5の星で選択してください" };
  }
  const clean = (v: unknown, max: number) =>
    stripControlChars(String(v ?? "")).trim().slice(0, max);
  const comment = clean(input.comment, REVIEW_COMMENT_MAX);
  const purpose = clean(input.purpose, REVIEW_PURPOSE_MAX);
  const reviewerName = clean(input.reviewerName, REVIEW_NAME_MAX);
  return { ok: true, rating, comment, purpose, reviewerName };
}
