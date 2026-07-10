import type { BookingReview, ReviewAggregate } from "@/lib/reviews";

/** 星の並び（平均値は四捨五入で塗りつぶし） */
function Stars({ rating }: { rating: number }) {
  const filled = Math.round(rating);
  return (
    <span className="review-stars" aria-label={`星${rating}`}>
      {"★".repeat(filled)}
      {"☆".repeat(5 - filled)}
    </span>
  );
}

/**
 * 実利用者レビューの表示セクション（サーバーコンポーネント）。
 * 競合（インスタベース等）と同様に「平均★＋件数」を先頭に出し、
 * 各レビューは表示名・用途・運営返信つきで表示する。
 */
export default function ReviewSection({
  reviews,
  aggregate,
  staticReviews,
}: {
  reviews: BookingReview[];
  aggregate: ReviewAggregate;
  /** DBレビューが無い期間のフォールバック（venues.tsの静的「ご利用者の声」） */
  staticReviews: { initial: string; quote: string; name: string; role: string }[];
}) {
  if (aggregate.count === 0) {
    // 実レビューが集まるまでは従来の静的な「ご利用者の声」を表示
    if (staticReviews.length === 0) return null;
    return (
      <section className="venue-section" id="reviews">
        <h2>ご利用者の声</h2>
        <div className="review-grid">
          {staticReviews.map((r) => (
            <figure key={r.name} className="review-card">
              <div className="review-avatar">{r.initial}</div>
              <blockquote>{r.quote}</blockquote>
              <figcaption>
                {r.name}（{r.role}）
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="venue-section" id="reviews">
      <h2>レビュー・評価</h2>
      <div className="review-summary">
        <span className="review-summary-score">{aggregate.average.toFixed(1)}</span>
        <Stars rating={aggregate.average} />
        <span className="review-summary-count">{aggregate.count}件のレビュー</span>
        <span className="policy">※実際にご予約・ご利用いただいた方のみが投稿できます</span>
      </div>
      <div className="review-list">
        {reviews.map((r) => (
          <article key={r.id} className="review-item">
            <header>
              <Stars rating={r.rating} />
              <strong>{r.reviewer_name || "ご利用者"}</strong>
              {r.purpose && <span className="use-chip">{r.purpose}</span>}
              <time className="policy">
                {new Date(r.published_at ?? r.submitted_at).toLocaleDateString("ja-JP", {
                  timeZone: "Asia/Tokyo",
                  year: "numeric",
                  month: "long",
                })}
              </time>
            </header>
            {r.comment && <p>{r.comment}</p>}
            {r.host_reply && (
              <div className="review-host-reply">
                <strong>運営からの返信</strong>
                <p>{r.host_reply}</p>
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}
