import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAvailability, getVenueBySlug } from "@/lib/availability";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth-server";
import { todayJst } from "@/lib/slots";
import { getVenueContent } from "@/content/venues";
import BookingGrid from "@/components/BookingGrid";
import AvailabilityDigest from "@/components/AvailabilityDigest";
import PhotoGallery from "@/components/PhotoGallery";
import FloatingNav from "@/components/FloatingNav";
import ReviewSection from "@/components/ReviewSection";
import { aggregateReviews } from "@/lib/reviews";
import { getPublishedReviews } from "@/lib/reviews-db";
import { describePolicy } from "@/lib/cancellation";
import type { VenueOption } from "@/lib/types";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const content = getVenueContent(slug);
  if (!content) return {};
  const title = `${content.name}｜${content.station.split("（")[0]}のレンタルスペース【公式予約】`;
  const description = `${content.catchCopy}。${content.capacityShort}。公式サイト予約なら仲介手数料なしの最安価格。空き状況を見てそのままオンライン決済で予約完了。`;
  return {
    title,
    description,
    alternates: { canonical: `${SITE}/${slug}` },
    openGraph: {
      title,
      description,
      url: `${SITE}/${slug}`,
      siteName: "ブルースペース公式予約",
      locale: "ja_JP",
      type: "website",
      images: [{ url: `${SITE}${content.photos.hero}`, width: 1200, height: 630 }],
    },
  };
}

export default async function VenuePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isDbConfigured()) notFound();

  const venue = await getVenueBySlug(slug);
  if (!venue) notFound();
  const content = getVenueContent(slug);

  const [initial, optionsResult, user, othersResult, photosResult, publishedReviews] = await Promise.all([
    getAvailability(venue, todayJst(), 7),
    getDb()
      .from("venue_options")
      .select("id, name, price, price_unit")
      .eq("venue_id", venue.id)
      .eq("active", true)
      .order("name"),
    getSessionUser(),
    getDb()
      .from("venues")
      .select("slug, name, hourly_price, holiday_hourly_price")
      .eq("active", true)
      .neq("id", venue.id)
      .order("name"),
    getDb()
      .from("venue_photos")
      .select("category_id, category_label, src, alt")
      .eq("venue_id", venue.id)
      .order("cat_sort", { ascending: true })
      .order("sort", { ascending: true }),
    getPublishedReviews(venue.id),
  ]);
  const options = (optionsResult.data ?? []) as VenueOption[];
  const reviewAggregate = aggregateReviews(publishedReviews.map((r) => r.rating));

  // ギャラリー: DB（管理画面で編集可）を優先し、無ければコード内の静的定義へフォールバック
  const photoRows = (photosResult.data ?? []) as {
    category_id: string;
    category_label: string;
    src: string;
    alt: string;
  }[];
  const galleryCategories: { id: string; label: string; images: { src: string; alt: string }[] }[] =
    [];
  for (const r of photoRows) {
    let cat = galleryCategories.find((c) => c.id === r.category_id);
    if (!cat) {
      cat = { id: r.category_id, label: r.category_label, images: [] };
      galleryCategories.push(cat);
    }
    cat.images.push({ src: r.src, alt: r.alt });
  }
  const galleryToShow =
    galleryCategories.length > 0 ? galleryCategories : (content?.photos.categories ?? []);

  // FAQ: DBに拠点別FAQが設定されていればそれを使う（管理画面で編集可）
  const dbFaqs = (venue.faqs ?? null) as { q: string; a: string }[] | null;
  const effectiveFaqs = dbFaqs && dbFaqs.length > 0 ? dbFaqs : (content?.faqs ?? []);
  const otherVenues = (othersResult.data ?? []) as {
    slug: string;
    name: string;
    hourly_price: number;
    holiday_hourly_price: number | null;
  }[];
  const initialForm = user
    ? {
        name: (user.user_metadata?.full_name as string) ?? "",
        email: user.email ?? "",
        phone: (user.user_metadata?.phone as string) ?? "",
        customerType:
          user.user_metadata?.customer_type === "corporate"
            ? ("corporate" as const)
            : ("individual" as const),
        companyName: (user.user_metadata?.company_name as string) ?? "",
      }
    : null;

  const priceLine =
    venue.holiday_hourly_price != null && venue.holiday_hourly_price !== venue.hourly_price
      ? `平日 ¥${venue.hourly_price.toLocaleString()} / 土日祝 ¥${venue.holiday_hourly_price.toLocaleString()}（1時間・税込）`
      : `¥${venue.hourly_price.toLocaleString()} / 時間（税込）`;

  // 構造化データ（LocalBusiness + パンくず）。名称・住所はGoogleビジネスプロフィールと一致させる
  const jsonLd = content
    ? [
        {
          "@context": "https://schema.org",
          "@type": "LocalBusiness",
          "@id": `${SITE}/${slug}#business`,
          name: content.name,
          description: content.catchCopy,
          url: `${SITE}/${slug}`,
          image: `${SITE}${content.photos.hero}`,
          address: {
            "@type": "PostalAddress",
            postalCode: content.postalCode,
            addressRegion: "東京都",
            addressLocality: content.addressLocality,
            streetAddress: content.address.replace(/^東京都.+?区/, ""),
            addressCountry: "JP",
          },
          ...(content.geo
            ? {
                geo: {
                  "@type": "GeoCoordinates",
                  latitude: content.geo.lat,
                  longitude: content.geo.lng,
                },
              }
            : {}),
          openingHoursSpecification: {
            "@type": "OpeningHoursSpecification",
            dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
            opens: "00:00",
            closes: "23:59",
          },
          priceRange: `¥${venue.hourly_price.toLocaleString()}〜¥${(venue.holiday_hourly_price ?? venue.hourly_price).toLocaleString()}/時間`,
          // 実利用者レビューが1件以上あるときだけ星評価を検索結果に出す（AggregateRating）
          ...(reviewAggregate.count > 0
            ? {
                aggregateRating: {
                  "@type": "AggregateRating",
                  ratingValue: reviewAggregate.average,
                  reviewCount: reviewAggregate.count,
                  bestRating: 5,
                  worstRating: 1,
                },
              }
            : {}),
          parentOrganization: {
            "@type": "Organization",
            name: "ブルーステージ合同会社",
            url: "https://bluestage-lcc.com",
          },
        },
        {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "ブルースペース", item: SITE },
            { "@type": "ListItem", position: 2, name: content.name, item: `${SITE}/${slug}` },
          ],
        },
        {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: effectiveFaqs.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        },
      ]
    : [];

  return (
    <>
      {jsonLd.map((obj, i) => (
        <script
          key={i}
          type="application/ld+json"
          // FAQ等の管理者入力に </script> が混ざってもページが壊れない/XSSにならないよう < をエスケープ
          dangerouslySetInnerHTML={{ __html: JSON.stringify(obj).replace(/</g, "\\u003c") }}
        />
      ))}

      <div className={slug === "shirokane-takanawa" ? "booking-hero-row" : ""}>
        <div className="booking-header">
          {content && <span className="venue-badge">{content.badge}</span>}
          <h1>{venue.name}</h1>
          <p className="venue-meta">
            🚉 {content?.station ?? venue.address}　👥 {content?.capacityShort ?? ""}
          </p>
          {reviewAggregate.count > 0 && (
            <p className="venue-rating-line">
              <a href="#reviews">
                <span className="review-stars">
                  {"★".repeat(Math.round(reviewAggregate.average))}
                  {"☆".repeat(5 - Math.round(reviewAggregate.average))}
                </span>{" "}
                {reviewAggregate.average.toFixed(1)}（{reviewAggregate.count}件のレビュー）
              </a>
            </p>
          )}
          <p>
            <strong>{priceLine}</strong>
            ・30分単位（最大{venue.max_hours}時間連続）・24時間営業
          </p>
          {(venue.last_minute_percent > 0 || venue.early_bird_percent > 0) && (
            <p>
              {venue.last_minute_percent > 0 && `🈹 当日予約 ${venue.last_minute_percent}%OFF　`}
              {venue.early_bird_percent > 0 &&
                `🈹 ${venue.early_bird_days}日前までの早期予約 ${venue.early_bird_percent}%OFF`}
            </p>
          )}
          <p>
            <a href="#book" className="hero-book-btn">
              空き状況を見て予約する ↓
            </a>
          </p>
        </div>

        {slug === "shirokane-takanawa" && (
          <a href="/storage/shirokane-takanawa" className="storage-promo">
            <span className="storage-promo-badge">🏢 法人向け 倉庫利用 募集中</span>
            <strong className="storage-promo-title">
              このスペース、<br />
              <span className="storage-promo-accent">月極の倉庫</span>としても貸出中
            </strong>
            <span className="storage-promo-price">
              1㎡あたりの賃料が<strong>大手トランクルーム比 約45%お得</strong>
              <small>（キュラーズ白金高輪5畳 定価との面積単価比較・2026年6月時点）</small>
            </span>
            <ul className="storage-promo-uses">
              <li>📦 EC在庫・梱包材の保管に</li>
              <li>🏪 店舗の「第2バックヤード」に</li>
              <li>🔑 15㎡まるごと1社専用・スマートロック</li>
            </ul>
            <span className="storage-promo-cta">倉庫プランの料金を見る →</span>
          </a>
        )}
      </div>

      <AvailabilityDigest availability={initial} variant="banner" />

      {galleryToShow.length > 0 && <PhotoGallery categories={galleryToShow} />}

      {content && (
        <section className="venue-section">
          <h2>このスペースについて</h2>
          <p>{content.overview}</p>
          <div className="uses-chips">
            {content.uses.map((u) => (
              <span key={u} className="use-chip">
                {u}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="venue-section" id="availability">
        <h2>今週の空き状況（直近7日間）</h2>
        <p className="policy">
          本日から7日間の予約可能時間の目安です（24時間営業 0:00〜24:00）。先の日付は下の予約カレンダーから「次の週へ」でご予約いただけます（最大60日先まで）。
        </p>
        <AvailabilityDigest availability={initial} variant="week" />
      </section>

      <section className="venue-section" id="book">
        <h2>空き状況・ご予約</h2>
        <p className="policy">
          公式サイトのご予約は仲介手数料がかからないため、いつでも最安値です。
        </p>
        <BookingGrid venueSlug={venue.slug} initial={initial} options={options} initialForm={initialForm} isLoggedIn={!!user} />
        <details className="faq-item cancel-policy-box">
          <summary>キャンセルポリシー（ご予約前にご確認ください）</summary>
          <ul>
            {describePolicy(venue.cancellation_policy ?? null).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="policy">
            会員登録済みの方はマイページからワンクリックでキャンセル・自動返金ができます。
          </p>
        </details>
      </section>

      {content && (
        <>
          <section className="venue-section">
            <h2>設備・備品</h2>
            <div className="amenity-grid">
              {content.amenities.map((a) => (
                <div key={a.label} className="amenity-card">
                  <strong>{a.label}</strong>
                  <span>{a.note}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="venue-section" id="access">
            <h2>アクセス</h2>
            <div className="access-grid">
              <div className="access-map-embed">
                <iframe
                  src={
                    content.mapEmbedSrc ||
                    `https://maps.google.com/maps?q=${encodeURIComponent(content.mapQuery)}&hl=ja&z=18&output=embed`
                  }
                  title={`${content.name}の地図`}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  allowFullScreen
                />
              </div>
              <div>
                <table className="legal-table">
                  <tbody>
                    {content.accessRows.map((r) => (
                      <tr key={r.label}>
                        <th>{r.label}</th>
                        <td>
                          {r.main}
                          <br />
                          <span className="policy">{r.sub}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {content.photos.accessMap && (
                  <div className="access-guide-img">
                    <Image
                      src={content.photos.accessMap}
                      alt={`${content.name}までの案内地図`}
                      width={560}
                      height={400}
                      style={{ width: "100%", height: "auto", borderRadius: "10px" }}
                    />
                  </div>
                )}
              </div>
            </div>
            <h3 className="nearby-title">周辺の便利なお店</h3>
            <div className="nearby-grid">
              {content.nearby.map((n) => (
                <a
                  key={n.name}
                  className="nearby-card"
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(n.query)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className="nearby-emoji">{n.emoji}</span>
                  <strong>{n.name}</strong>
                  <span>{n.category}</span>
                </a>
              ))}
            </div>
          </section>

          <ReviewSection
            reviews={publishedReviews}
            aggregate={reviewAggregate}
            staticReviews={content.reviews}
          />

          <section className="venue-section">
            <h2>よくある質問</h2>
            <div className="faq-list">
              {effectiveFaqs.map((f) => (
                <details key={f.q} className="faq-item">
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </section>

          <section className="venue-section venue-cta-bottom">
            <h2>ご予約はこちら</h2>
            <p>
              空き状況を確認して、クレジットカードでそのまま予約できます。
              当日予約は開始直前まで受付・10%OFF。
            </p>
            <p>
              <a href="#book" className="hero-book-btn">
                空き状況を見て予約する ↑
              </a>
            </p>
            <p className="policy">
              <strong>毎週・毎月の定期利用は常時10%OFF。</strong>
              長期・定期利用や法人でのご利用は{" "}
              <Link href={`/contact?type=longterm&venue=${venue.slug}`}>お問い合わせフォーム</Link>{" "}
              からお気軽にご相談ください（例: 月3回の定期利用のお見積もり）。 運営:{" "}
              <Link href="https://bluestage-lcc.com" target="_blank" rel="noopener noreferrer">
                ブルーステージ合同会社
              </Link>
            </p>
          </section>

          {otherVenues.length > 0 && (
            <section className="venue-section other-venues">
              <h2>他の拠点もチェック</h2>
              <div className="other-venues-grid">
                {otherVenues.map((o) => {
                  const oc = getVenueContent(o.slug);
                  return (
                    <Link key={o.slug} href={`/${o.slug}`} className="other-venue-card">
                      <div className="other-venue-photo">
                        <Image
                          src={`/venues/${o.slug}/hero.jpg`}
                          alt={o.name}
                          fill
                          sizes="(max-width: 700px) 50vw, 220px"
                          style={{ objectFit: "cover" }}
                        />
                      </div>
                      <strong>{o.name}</strong>
                      {oc && <span className="addr">🚉 {oc.station}</span>}
                      <span className="price">
                        ¥{o.hourly_price.toLocaleString()}
                        {o.holiday_hourly_price != null &&
                        o.holiday_hourly_price !== o.hourly_price
                          ? `〜¥${o.holiday_hourly_price.toLocaleString()}`
                          : ""}{" "}
                        / 時間
                      </span>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}

      <FloatingNav venueSlug={venue.slug} />
    </>
  );
}
