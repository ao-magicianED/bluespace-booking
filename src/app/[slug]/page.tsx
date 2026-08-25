import type { Metadata } from "next";
import { cache } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getAvailability, getVenueBySlug } from "@/lib/availability";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth-server";
import { resolveTier } from "@/lib/entry-tier";
import { resolveDayPricing, resolveDayPricingBatch } from "@/lib/price-bands";
import { minBandPrice } from "@/lib/pricing";
import { todayJst } from "@/lib/slots";
import { getVenueContent } from "@/content/venues";
import BookingGrid from "@/components/BookingGrid";
import AvailabilityDigest from "@/components/AvailabilityDigest";
import PhotoGallery from "@/components/PhotoGallery";
import PriceBandTable from "@/components/PriceBandTable";
import FloatingNav from "@/components/FloatingNav";
import ReviewSection from "@/components/ReviewSection";
import { aggregateReviews } from "@/lib/reviews";
import { getPublishedReviews } from "@/lib/reviews-db";
import { describePolicy } from "@/lib/cancellation";
import type { Venue, VenueOption } from "@/lib/types";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

// generateMetadataとページ本体が同一リクエスト内で同じ拠点を二重取得しないようメモ化する
// （getVenueBySlugはfetchでなくSupabaseクライアントのためNext.js自動メモ化の対象外）
const getVenueBySlugCached = cache(getVenueBySlug);
// metadata用のstandard料金（検索エンジン向けはCookieに関係なくstandardの最低価格）
const getStandardDayPricingCached = cache((venue: Venue) => resolveDayPricing(venue, "standard"));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const content = getVenueContent(slug);
  // コンテンツ定義が無いslugでも canonical だけは自己参照にしておく
  // （返さないと親layoutのmetadataを継承してしまうため）
  if (!content) return { alternates: { canonical: `${SITE}/${slug}` } };
  // {price} はDBの現在価格で置換する（価格改定にtitle/descriptionを自動追随させる）。
  // 時間帯別料金の拠点はstandard帯の最低価格（¥X/時間〜）。取得できないときは「格安」。
  let priceText = "格安";
  if (isDbConfigured()) {
    try {
      const venue = await getVenueBySlugCached(slug);
      if (venue) {
        const pricing = await getStandardDayPricingCached(venue);
        const min =
          pricing.weekday.source === "bands" || pricing.holiday.source === "bands"
            ? Math.min(minBandPrice(pricing.weekday.bands), minBandPrice(pricing.holiday.bands))
            : venue.hourly_price;
        priceText = `¥${min.toLocaleString()}/時間〜`;
      }
    } catch (e) {
      console.error("[metadata] 拠点価格の取得に失敗。価格なし表記で続行します", e);
    }
  }
  const title = content.seo.title.replace("{price}", priceText);
  const description = content.seo.description.replace("{price}", priceText);
  return {
    // seo.titleはブランド名込みの完成形のため、親の「%s | ブルースペース」テンプレートを適用させない
    title: { absolute: title },
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

  const venue = await getVenueBySlugCached(slug);
  if (!venue) notFound();
  const content = getVenueContent(slug);

  // 価格ティア（現地QRのCookie署名＋DB照合。失敗は必ずstandard）
  const tier = await resolveTier();

  const [initial, optionsResult, user, othersResult, photosResult, publishedReviews] = await Promise.all([
    getAvailability(venue, todayJst(), 7, tier),
    getDb()
      .from("venue_options")
      .select("id, name, price, price_unit")
      .eq("venue_id", venue.id)
      .eq("active", true)
      .order("name"),
    getSessionUser(),
    getDb()
      .from("venues")
      .select("id, slug, name, hourly_price, holiday_hourly_price")
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
    id: string;
    slug: string;
    name: string;
    hourly_price: number;
    holiday_hourly_price: number | null;
  }[];
  // 他拠点カードの価格も帯対応（帯あり拠点は最低帯価格の「¥X〜」表示）
  const otherPricing = await resolveDayPricingBatch(otherVenues, tier);
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

  // 帯あり拠点は最低帯価格の「〜」表示（詳細は帯表）。帯なし拠点は従来表示のまま
  const bandPricing = initial.pricing ?? null;
  const weekdayMin = bandPricing ? minBandPrice(bandPricing.weekday) : venue.hourly_price;
  const holidayMin = bandPricing
    ? minBandPrice(bandPricing.holiday)
    : (venue.holiday_hourly_price ?? venue.hourly_price);
  const priceLine = bandPricing
    ? `平日 ¥${weekdayMin.toLocaleString()}〜 / 土日祝 ¥${holidayMin.toLocaleString()}〜（1時間・税込）`
    : venue.holiday_hourly_price != null && venue.holiday_hourly_price !== venue.hourly_price
      ? `平日 ¥${venue.hourly_price.toLocaleString()} / 土日祝 ¥${venue.holiday_hourly_price.toLocaleString()}（1時間・税込）`
      : `¥${venue.hourly_price.toLocaleString()} / 時間（税込）`;
  const allBandPrices = bandPricing
    ? [...bandPricing.weekday, ...bandPricing.holiday].map((b) => b.hourlyPrice)
    : null;

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
          priceRange: allBandPrices
            ? `¥${Math.min(...allBandPrices).toLocaleString()}〜¥${Math.max(...allBandPrices).toLocaleString()}/時間`
            : `¥${venue.hourly_price.toLocaleString()}〜¥${(venue.holiday_hourly_price ?? venue.hourly_price).toLocaleString()}/時間`,
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
          {bandPricing && (
            <details className="band-price-details">
              <summary>時間帯別料金を見る（1時間・税込）</summary>
              <PriceBandTable weekday={bandPricing.weekday} holiday={bandPricing.holiday} />
            </details>
          )}
          {bandPricing?.tier === "repeat" && (
            <p className="policy">現地QR限定 リピーター価格でご案内中</p>
          )}
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

      {content?.seo.sections.map((s) => (
        <section key={s.title} className="venue-section">
          <h2>{s.title}</h2>
          <p>{s.body}</p>
        </section>
      ))}

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
          公式サイトのご予約は仲介手数料がかかりません。
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
              当日予約は開始直前まで受付。
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
                  const op = otherPricing.get(o.id);
                  const oHasBands =
                    op && (op.weekday.source === "bands" || op.holiday.source === "bands");
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
                        {oHasBands
                          ? `¥${Math.min(
                              minBandPrice(op.weekday.bands),
                              minBandPrice(op.holiday.bands)
                            ).toLocaleString()}〜 / 時間`
                          : `¥${o.hourly_price.toLocaleString()}${
                              o.holiday_hourly_price != null &&
                              o.holiday_hourly_price !== o.hourly_price
                                ? `〜¥${o.holiday_hourly_price.toLocaleString()}`
                                : ""
                            } / 時間`}
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
