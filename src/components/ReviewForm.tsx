"use client";

import { useState } from "react";
import {
  REVIEW_COMMENT_MAX,
  REVIEW_NAME_MAX,
  REVIEW_PURPOSE_MAX,
} from "@/lib/reviews";

const RATING_LABELS: Record<number, string> = {
  1: "残念だった",
  2: "いまいち",
  3: "ふつう",
  4: "良かった",
  5: "とても良かった",
};

/** よく使われる用途の候補（タップで入力できるチップ） */
const PURPOSE_SUGGESTIONS = [
  "会議・打ち合わせ",
  "セミナー・勉強会",
  "パーティー・懇親会",
  "レッスン・教室",
  "撮影・収録",
  "ボードゲーム会",
  "その他",
];

export default function ReviewForm({
  token,
  initialPurpose,
}: {
  token: string;
  initialPurpose: string;
}) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [purpose, setPurpose] = useState(initialPurpose);
  const [reviewerName, setReviewerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (rating === 0) {
      setError("星評価を選択してください");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, rating, comment, purpose, reviewerName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "投稿に失敗しました");
        return;
      }
      setDone(true);
    } catch {
      setError("通信に失敗しました。時間をおいてお試しください");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="notice success">
        <strong>レビューを投稿いただきありがとうございました！</strong>
        <p>内容を確認のうえ、拠点ページに掲載させていただきます。</p>
      </div>
    );
  }

  const shownRating = hoverRating || rating;

  return (
    <div className="review-form">
      <div className="review-form-field">
        <label>総合評価 *</label>
        <div className="star-input" role="radiogroup" aria-label="総合評価">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={rating === n}
              aria-label={`星${n}つ ${RATING_LABELS[n]}`}
              className={`star-btn ${shownRating >= n ? "on" : ""}`}
              onClick={() => setRating(n)}
              onMouseEnter={() => setHoverRating(n)}
              onMouseLeave={() => setHoverRating(0)}
            >
              ★
            </button>
          ))}
          <span className="star-label">{shownRating > 0 ? RATING_LABELS[shownRating] : ""}</span>
        </div>
      </div>

      <div className="review-form-field">
        <label htmlFor="review-purpose">ご利用用途</label>
        <div className="uses-chips">
          {PURPOSE_SUGGESTIONS.map((p) => (
            <button
              key={p}
              type="button"
              className={`use-chip selectable ${purpose === p ? "selected" : ""}`}
              onClick={() => setPurpose(p)}
            >
              {p}
            </button>
          ))}
        </div>
        <input
          id="review-purpose"
          type="text"
          value={purpose}
          maxLength={REVIEW_PURPOSE_MAX}
          onChange={(e) => setPurpose(e.target.value)}
          placeholder="例: 会議・打ち合わせ"
        />
      </div>

      <div className="review-form-field">
        <label htmlFor="review-comment">コメント</label>
        <textarea
          id="review-comment"
          value={comment}
          maxLength={REVIEW_COMMENT_MAX}
          rows={5}
          onChange={(e) => setComment(e.target.value)}
          placeholder="良かった点・気になった点など、これから利用する方の参考になる感想をお聞かせください"
        />
        <span className="policy">
          {comment.length}/{REVIEW_COMMENT_MAX}文字
        </span>
      </div>

      <div className="review-form-field">
        <label htmlFor="review-name">表示名（任意）</label>
        <input
          id="review-name"
          type="text"
          value={reviewerName}
          maxLength={REVIEW_NAME_MAX}
          onChange={(e) => setReviewerName(e.target.value)}
          placeholder="例: T.K. / 田中（未入力の場合は「ご利用者」と表示されます）"
        />
      </div>

      {error && <div className="notice error">{error}</div>}

      <button type="button" className="hero-book-btn" disabled={submitting} onClick={submit}>
        {submitting ? "送信中..." : "レビューを投稿する"}
      </button>
      <p className="policy">
        投稿いただいたレビューは、運営の確認後に拠点ページへ掲載されます。個人情報や誹謗中傷を含む内容は掲載されない場合があります。
      </p>
    </div>
  );
}
