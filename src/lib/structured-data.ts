import type { VenueContent } from "@/content/venues";
import { CORPORATE_URL } from "./site-url";

/**
 * 構造化データ（JSON-LD）の組み立て（純粋関数・単体テスト対象）。
 *
 * 方針（2026-09 SEO/AEO改修）:
 * - Organization は全ページ共通の1つ（@id）を拠点の parentOrganization から参照し、会社と拠点を結ぶ。
 * - 拠点の LocalBusiness には、GBP（Googleビジネスプロフィール）の店舗URLを sameAs / hasMap で付け、
 *   サイトとGBPが同じ店舗だと検索エンジン・AIに伝える（名称・住所はGBPと一致させる）。
 * - aggregateRating は付けない。自社サイトで集めたレビューは、LocalBusiness/Organization では
 *   Googleの星表示の対象外（自己宣伝レビュー）のため。レビューは画面上の表示だけにする。
 * - FAQPage は同じQ&Aを複数ページに付けない（共通FAQはトップだけ、拠点ページは拠点固有FAQだけ）。
 */

export type JsonLd = Record<string, unknown>;

export function organizationId(site: string): string {
  return `${site}/#organization`;
}

export function buildOrganizationJsonLd(site: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": organizationId(site),
    name: "ブルーステージ合同会社",
    legalName: "ブルーステージ合同会社",
    url: CORPORATE_URL,
    brand: { "@type": "Brand", name: "ブルースペース" },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer service",
      url: `${site}/contact`,
      availableLanguage: "ja",
    },
  };
}

export function buildWebSiteJsonLd(site: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${site}/#website`,
    name: "ブルースペース",
    alternateName: ["ブルースペース公式予約"],
    url: site,
    inLanguage: "ja",
    publisher: { "@id": organizationId(site) },
  };
}

export function gbpMapUrl(cid: string): string {
  return `https://maps.google.com/?cid=${cid}`;
}

function absolute(site: string, src: string): string {
  return /^https?:\/\//.test(src) ? src : `${site}${src}`;
}

export function buildVenueJsonLd(opts: {
  site: string;
  content: VenueContent;
  /** 例: ¥1,130〜¥3,990/時間（料金帯表と一致させる） */
  priceRange: string;
  /** ヒーロー以外に載せる写真（ギャラリーの先頭数枚。相対パス可） */
  extraImages?: string[];
}): JsonLd {
  const { site, content: c, priceRange, extraImages = [] } = opts;
  const url = `${site}/${c.slug}`;
  const images = [c.photos.hero, ...extraImages].map((src) => absolute(site, src));
  return {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    "@id": `${url}#business`,
    name: c.name,
    description: c.catchCopy,
    url,
    image: [...new Set(images)],
    address: {
      "@type": "PostalAddress",
      postalCode: c.postalCode,
      addressRegion: "東京都",
      addressLocality: c.addressLocality,
      streetAddress: c.address.replace(/^東京都.+?区/, ""),
      addressCountry: "JP",
    },
    ...(c.geo
      ? { geo: { "@type": "GeoCoordinates", latitude: c.geo.lat, longitude: c.geo.lng } }
      : {}),
    ...(c.gbpCid ? { hasMap: gbpMapUrl(c.gbpCid), sameAs: [gbpMapUrl(c.gbpCid)] } : {}),
    maximumAttendeeCapacity: c.maxCapacity,
    additionalProperty: [
      { "@type": "PropertyValue", name: "広さ", value: c.areaSqm, unitCode: "MTK", unitText: "㎡" },
    ],
    amenityFeature: c.amenities.map((a) => ({
      "@type": "LocationFeatureSpecification",
      name: a.label,
      value: true,
    })),
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      opens: "00:00",
      closes: "23:59",
    },
    priceRange,
    currenciesAccepted: "JPY",
    paymentAccepted: "クレジットカード, 請求書払い（法人）",
    parentOrganization: { "@id": organizationId(site) },
  };
}

export function buildBreadcrumbJsonLd(site: string, items: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${site}${it.path}`,
    })),
  };
}

/** FAQが空なら null（空の FAQPage は出さない） */
export function buildFaqPageJsonLd(faqs: { q: string; a: string }[]): JsonLd | null {
  if (faqs.length === 0) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/**
 * <script type="application/ld+json"> に埋め込む文字列。
 * 管理者入力（FAQ等）に </script> が混ざってもページが壊れない/XSSにならないよう < をエスケープする。
 */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
