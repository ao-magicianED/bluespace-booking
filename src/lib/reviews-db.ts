import { getDb } from "./supabase";
import {
  aggregateReviews,
  describeReviewDbError,
  type BookingReview,
  type ReviewAggregate,
} from "./reviews";

/**
 * レビューのDB取得（サーバー専用）。
 * 純粋ロジック・型は reviews.ts（クライアントからもimport可）に置く。
 * クエリ失敗時はログに残したうえで空を返す（レビュー欄が出ないだけで、ページ自体は落とさない）。
 */

/** 拠点の公開レビュー一覧（新しい順） */
export async function getPublishedReviews(venueId: string, limit = 50): Promise<BookingReview[]> {
  const { data, error } = await getDb()
    .from("booking_reviews")
    .select("*")
    .eq("venue_id", venueId)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("[reviews]", describeReviewDbError("公開レビューの取得", error));
    return [];
  }
  return (data ?? []) as BookingReview[];
}

/** 全拠点分の公開レビュー集計（トップページのカード表示用） */
export async function getReviewAggregates(): Promise<Record<string, ReviewAggregate>> {
  const { data, error } = await getDb()
    .from("booking_reviews")
    .select("venue_id, rating")
    .eq("status", "published");
  if (error) {
    console.error("[reviews]", describeReviewDbError("公開レビュー集計の取得", error));
    return {};
  }
  const byVenue: Record<string, number[]> = {};
  for (const r of (data ?? []) as { venue_id: string; rating: number }[]) {
    (byVenue[r.venue_id] ??= []).push(r.rating);
  }
  const result: Record<string, ReviewAggregate> = {};
  for (const [venueId, ratings] of Object.entries(byVenue)) {
    result[venueId] = aggregateReviews(ratings);
  }
  return result;
}
