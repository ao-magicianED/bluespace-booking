import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { isReviewEligible } from "@/lib/reviews";
import { formatBookingPeriod } from "@/lib/confirm";
import ReviewForm from "@/components/ReviewForm";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "レビューを投稿する｜ブルースペース公式予約",
  robots: { index: false },
};

/**
 * レビュー投稿ページ。レビュー依頼メールに記載されたトークンURLからアクセスする。
 * トークンは予約ごとの秘密UUID（bookings.review_token）。
 */
export default async function ReviewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!isDbConfigured()) notFound();
  if (!/^[0-9a-f-]{36}$/.test(token)) notFound();

  const db = getDb();
  const { data: booking } = await db
    .from("bookings")
    .select("*, venues(name, slug)")
    .eq("review_token", token)
    .maybeSingle<Booking & { venues: { name: string; slug: string } | null }>();
  if (!booking) notFound();

  const { data: existing } = await db
    .from("booking_reviews")
    .select("id")
    .eq("booking_id", booking.id)
    .maybeSingle();

  const venueName = booking.venues?.name ?? "";
  const eligible = isReviewEligible(booking, new Date());

  return (
    <div className="review-page">
      <h1>レビューを投稿する</h1>
      <p className="policy">
        ご利用いただいたスペースの感想をお聞かせください。いただいたレビューは拠点ページに掲載され、これからご利用を検討される方の参考になります。
      </p>

      <div className="review-booking-summary">
        <strong>{venueName}</strong>
        <span>{formatBookingPeriod(booking)}</span>
      </div>

      {existing ? (
        <div className="notice success">
          <strong>このご予約のレビューは投稿済みです。</strong>
          <p>ご協力ありがとうございました！</p>
        </div>
      ) : !eligible.ok ? (
        <div className="notice error">
          {eligible.reason === "not_ended"
            ? "レビューはご利用終了後に投稿いただけます。ご利用後にあらためてお願いいたします。"
            : eligible.reason === "window_expired"
              ? "レビューの受付期間（ご利用後30日間）を過ぎているため、投稿できません。"
              : "このご予約はレビューを投稿できません。"}
        </div>
      ) : (
        <ReviewForm token={token} initialPurpose={booking.purpose ?? ""} />
      )}

      {booking.venues?.slug && (
        <p>
          <Link href={`/${booking.venues.slug}`}>{venueName} のページへ戻る</Link>
        </p>
      )}
    </div>
  );
}
