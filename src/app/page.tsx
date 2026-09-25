import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { COMMON_FAQS, VENUE_AREAS, getVenueContent } from "@/content/venues";
import { USE_CASE_GUIDE } from "@/content/use-case-guide";
import { getReviewAggregates } from "@/lib/reviews-db";
import { resolveTier } from "@/lib/entry-tier";
import { resolveDayPricingBatch } from "@/lib/price-bands";
import { minBandPrice } from "@/lib/pricing";
import { buildFaqPageJsonLd, buildWebSiteJsonLd } from "@/lib/structured-data";
import JsonLd from "@/components/JsonLd";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

// トップページの canonical（ルートlayoutから移設。他ページに継承させないため）
export const metadata: Metadata = {
  alternates: { canonical: SITE },
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

  /** カード・比較表で共通の料金表示（帯あり拠点は最低帯価格の「〜」表示） */
  const priceOf = (v: Venue) => {
    const dp = pricingMap.get(v.id);
    const hasBands = !!dp && (dp.weekday.source === "bands" || dp.holiday.source === "bands");
    const weekdayMin = hasBands ? minBandPrice(dp.weekday.bands) : v.hourly_price;
    const holidayMin = hasBands
      ? minBandPrice(dp.holiday.bands)
      : (v.holiday_hourly_price ?? v.hourly_price);
    const minPrice = hasBands
      ? Math.min(weekdayMin, holidayMin)
      : v.holiday_hourly_price != null && v.holiday_hourly_price < v.hourly_price
        ? v.holiday_hourly_price
        : v.hourly_price;
    const line = hasBands
      ? `平日 ¥${weekdayMin.toLocaleString()}〜 / 土日祝 ¥${holidayMin.toLocaleString()}〜（1時間・税込）`
      : v.holiday_hourly_price != null && v.holiday_hourly_price !== v.hourly_price
        ? `平日 ¥${v.hourly_price.toLocaleString()} / 土日祝 ¥${v.holiday_hourly_price.toLocaleString()}（1時間・税込）`
        : `¥${v.hourly_price.toLocaleString()} / 時間（税込）`;
    return { hasBands, minPrice, line };
  };

  // 比較表・用途ガイドは、DBで公開中（active）の拠点だけを対象にする
  const bySlug = new Map(list.map((v) => [v.slug, v]));
  const areas = VENUE_AREAS.map((a) => ({
    area: a.area,
    venues: a.slugs.map((s) => bySlug.get(s)).filter((v): v is Venue => !!v),
  })).filter((a) => a.venues.length > 0);
  const useCases = USE_CASE_GUIDE.map((u) => ({
    ...u,
    venues: u.slugs.map((s) => bySlug.get(s)).filter((v): v is Venue => !!v),
  })).filter((u) => u.venues.length > 0);
  const areaNames = areas.map((a) => a.area).join("・");

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
      {/* Organization は全ページ共通（layout.tsx）。WebSite（サイト名）と共通FAQはトップだけに付ける */}
      <JsonLd data={buildWebSiteJsonLd(SITE)} />
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={buildFaqPageJsonLd(COMMON_FAQS)} />
      <section className="home-hero">
        <span className="hero-eyebrow">公式予約・仲介手数料なし</span>
        <h1>
          {/* 「・」は行頭禁則のため、語の途中で改行されないよう語句単位で折り返す */}
          <span className="nowrap-phrase">東京の</span>
          <span className="nowrap-phrase">レンタルスペース・</span>
          <span className="nowrap-phrase">貸し会議室</span>
          <br />
          <span className="accent">ブルースペース</span>
        </h1>
        <p>
          {areaNames}の{list.length}拠点。スペースを選んで、空き状況を見てそのまま予約できます。
          仲介手数料はかからず、クレジットカードで予約が完了します。
        </p>
        <ul className="feature-chips">
          <li>🕐 30分単位で予約</li>
          <li>⚡ 開始直前まで受付</li>
          <li>🌙 24時間営業</li>
          <li>🧾 領収書発行OK</li>
        </ul>
      </section>

      <div className="venue-grid">
        {list.map((v, i) => {
          const c = getVenueContent(v.slug);
          const p = priceOf(v);
          return (
            <Link key={v.id} href={`/${v.slug}`} className="venue-card">
              <div className="venue-card-photo">
                <span className="photo-badge">¥{p.minPrice.toLocaleString()}〜 / 時間</span>
                <Image
                  src={`/venues/${v.slug}/hero.jpg`}
                  alt={v.name}
                  fill
                  sizes="(max-width: 700px) 100vw, 360px"
                  style={{ objectFit: "cover" }}
                  // ファーストビューに入る先頭2枚は遅延読み込みしない（LCP対策）
                  priority={i < 2}
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
                <p className="price">{p.line}</p>
                <p className="desc">{v.description}</p>
                <span className="venue-card-cta">空き状況を見て予約</span>
              </div>
            </Link>
          );
        })}
        {list.length === 0 && <p>現在予約可能なスペースはありません。</p>}
      </div>

      <section className="venue-section" id="about">
        <h2>ブルースペースについて</h2>
        <p>
          ブルースペースは、ブルーステージ合同会社が東京都内で運営するレンタルスペース・貸し会議室です。
          {areaNames}に{list.length}拠点があり、全拠点24時間営業・無人運営。会議・研修・セミナーから
          ダンス練習、撮影、パーティー、サロン利用まで、30分単位で必要な時間だけご利用いただけます。
        </p>
        <p>
          このサイトは公式予約サイトです。空き状況を見てそのままクレジットカードで予約が完了し、
          法人のお客様は利用日時の3日前までのご予約で請求書払い（銀行振込）も選べます。
          会員登録いただくと、インボイス登録番号入りの領収書をマイページから発行できます。
        </p>
      </section>

      {areas.length > 0 && (
        <section className="venue-section" id="compare">
          <h2>{list.length}拠点の比較</h2>
          <p className="policy">
            料金は1時間あたり・税込の目安です（時間帯・曜日で変わる拠点は最も低い料金帯からの表示。詳しくは各拠点ページの料金表をご覧ください）。
          </p>
          <div className="table-scroll">
            <table className="legal-table compare-table">
              <thead>
                <tr>
                  <th scope="col">拠点</th>
                  <th scope="col">最寄り駅</th>
                  <th scope="col">定員・広さ</th>
                  <th scope="col">料金の目安</th>
                  <th scope="col">主な設備</th>
                  <th scope="col">向いている用途</th>
                </tr>
              </thead>
              {areas.map((a) => (
                <tbody key={a.area}>
                  <tr className="compare-area-row">
                    <th scope="rowgroup" colSpan={6}>
                      {a.area}エリア
                    </th>
                  </tr>
                  {a.venues.map((v) => {
                    const c = getVenueContent(v.slug);
                    return (
                      <tr key={v.id}>
                        <th scope="row">
                          <Link href={`/${v.slug}`}>{v.name}</Link>
                        </th>
                        <td>{c?.station ?? v.address}</td>
                        <td>{c?.capacityShort ?? ""}</td>
                        <td>{priceOf(v).line}</td>
                        <td>{c?.compare.features ?? ""}</td>
                        <td>{c?.compare.bestFor ?? ""}</td>
                      </tr>
                    );
                  })}
                </tbody>
              ))}
            </table>
          </div>
        </section>
      )}

      {useCases.length > 0 && (
        <section className="venue-section" id="use-cases">
          <h2>用途から探す</h2>
          <dl className="use-case-list">
            {useCases.map((u) => (
              <div key={u.use} className="use-case-item">
                <dt>{u.use}</dt>
                <dd>
                  <span className="use-case-venues">
                    {u.venues.map((v, i) => (
                      <span key={v.id}>
                        {i > 0 && "・"}
                        <Link href={`/${v.slug}`}>{v.name.replace(/^ブルースペース/, "")}</Link>
                      </span>
                    ))}
                  </span>
                  <span className="policy">{u.point}</span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="venue-section" id="faq">
        <h2>よくある質問（全拠点共通）</h2>
        <div className="faq-list">
          {COMMON_FAQS.map((f) => (
            <details key={f.q} className="faq-item">
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="home-contact-cta">
        <h2>長期利用・定期利用は常時10%OFF</h2>
        <p>
          「月に3回、会議で使いたい」「毎週レッスンで利用したい」など、定期でのご利用は
          常時10%OFFでご提供。お問い合わせフォームからご利用ペースをお知らせください。お見積もりをお送りします。
          イベントの控室・資材置き場としての複数日のご利用や、法人の請求書払いもご相談ください。
        </p>
        <Link href="/contact?type=longterm" className="hero-book-btn">
          長期・定期利用の相談をする
        </Link>
      </section>
    </>
  );
}
