import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { getVenueContent } from "@/content/venues";
import { getReviewAggregates } from "@/lib/reviews-db";
import { resolveTier } from "@/lib/entry-tier";
import { resolveDayPricingBatch } from "@/lib/price-bands";
import { minBandPrice } from "@/lib/pricing";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

// トップページの canonical（ルートlayoutから移設。他ページに継承させないため）
export const metadata: Metadata = {
  alternates: { canonical: SITE },
};

const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE}/#organization`,
  name: "ブルーステージ合同会社",
  legalName: "ブルーステージ合同会社",
  url: "https://bluestage-lcc.com",
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer service",
    url: `${SITE}/contact`,
  },
};

const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${SITE}/#website`,
  name: "ブルースペース",
  url: SITE,
  publisher: { "@id": `${SITE}/#organization` },
};

export default async function HomePage() {
  if (!isDbConfigured()) {
    return (
      <div className="notice error">
        <strong>セットアップ未完了:</strong> 環境変数 SUPABASE_URL /
        SUPABASE_SERVICE_ROLE_KEY を設定してください（docs/setup-guide.md 参照）。
      </div>
    );
  }

  const db = getDb();
  const [{ data: venues, error }, reviewAggregates] = await Promise.all([
    db.from("venues").select("*").eq("active", true).order("name"),
    getReviewAggregates(),
  ]);

  if (error) {
    return <div className="notice error">拠点情報の取得に失敗しました。</div>;
  }

  const list = (venues ?? []) as Venue[];

  // 時間帯別料金の拠点は最低帯価格の「¥X〜」表示にする（帯なし拠点は従来表示）
  const tier = await resolveTier();
  const pricingMap = await resolveDayPricingBatch(list, tier);

  // 拠点一覧のItemList。Googleに「東京7拠点のレンタルスペースを束ねるサイト」だと伝える
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${SITE}/#venues`,
    name: "ブルースペース 拠点一覧",
    itemListElement: list.map((v, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: v.name,
      url: `${SITE}/${v.slug}`,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationJsonLd).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd).replace(/</g, "\\u003c") }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(itemListJsonLd).replace(/</g, "\\u003c") }}
      />
      <section className="home-hero">
        <span className="hero-eyebrow">公式予約・仲介手数料なし</span>
        <h1>
          スペースを選んで、<br />
          <span className="accent">そのまま予約。</span>
        </h1>
        <p>
          ブルースペースの公式予約サイトです。仲介手数料はかかりません。
          空き状況を見て、クレジットカードでそのまま予約が完了します。
        </p>
        <ul className="feature-chips">
          <li>🕐 30分単位で予約</li>
          <li>⚡ 開始直前まで受付</li>
          <li>🌙 24時間営業</li>
          <li>🧾 領収書発行OK</li>
        </ul>
      </section>

      <div className="venue-grid">
        {list.map((v) => {
          const c = getVenueContent(v.slug);
          const dp = pricingMap.get(v.id);
          const hasBands = dp && (dp.weekday.source === "bands" || dp.holiday.source === "bands");
          const weekdayMin = hasBands ? minBandPrice(dp.weekday.bands) : v.hourly_price;
          const holidayMin = hasBands
            ? minBandPrice(dp.holiday.bands)
            : (v.holiday_hourly_price ?? v.hourly_price);
          const minPrice = hasBands
            ? Math.min(weekdayMin, holidayMin)
            : v.holiday_hourly_price != null && v.holiday_hourly_price < v.hourly_price
              ? v.holiday_hourly_price
              : v.hourly_price;
          return (
            <Link key={v.id} href={`/${v.slug}`} className="venue-card">
              <div className="venue-card-photo">
                <span className="photo-badge">¥{minPrice.toLocaleString()}〜 / 時間</span>
                <Image
                  src={`/venues/${v.slug}/hero.jpg`}
                  alt={v.name}
                  fill
                  sizes="(max-width: 700px) 100vw, 360px"
                  style={{ objectFit: "cover" }}
                />
              </div>
              <div className="venue-card-body">
                <h2>{v.name}</h2>
                {reviewAggregates[v.id] && (
                  <p className="venue-card-rating">
                    <span className="review-stars">★</span> {reviewAggregates[v.id].average.toFixed(1)}
                    <span className="policy">（{reviewAggregates[v.id].count}件）</span>
                  </p>
                )}
                {c && <p className="addr">🚉 {c.station}</p>}
                {c && <p className="addr">👥 {c.capacityShort}</p>}
                <p className="price">
                  {hasBands
                    ? `平日 ¥${weekdayMin.toLocaleString()}〜 / 土日祝 ¥${holidayMin.toLocaleString()}〜（1時間・税込）`
                    : v.holiday_hourly_price != null && v.holiday_hourly_price !== v.hourly_price
                      ? `平日 ¥${v.hourly_price.toLocaleString()} / 土日祝 ¥${v.holiday_hourly_price.toLocaleString()}（1時間・税込）`
                      : `¥${v.hourly_price.toLocaleString()} / 時間（税込）`}
                </p>
                <p className="desc">{v.description}</p>
                <span className="venue-card-cta">空き状況を見て予約</span>
              </div>
            </Link>
          );
        })}
        {list.length === 0 && <p>現在予約可能なスペースはありません。</p>}
      </div>

      <section className="home-contact-cta">
        <h2>長期利用・定期利用は常時10%OFF</h2>
        <p>
          「月に3回、会議で使いたい」「毎週レッスンで利用したい」など、定期でのご利用は
          常時10%OFFでご提供。お問い合わせフォームからご利用ペースをお知らせください。お見積もりをお送りします。
        </p>
        <Link href="/contact?type=longterm" className="hero-book-btn">
          長期・定期利用の相談をする
        </Link>
      </section>
    </>
  );
}
