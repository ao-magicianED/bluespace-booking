import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import Link from "next/link";
import AuthNav from "@/components/AuthNav";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import JsonLd from "@/components/JsonLd";
import { VENUE_AREAS, getVenueContent } from "@/content/venues";
import { CORPORATE_URL } from "@/lib/site-url";
import { buildOrganizationJsonLd } from "@/lib/structured-data";
import "./globals.css";
import "./seo-content.css";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
  variable: "--font-jp",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f2d5c",
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "ブルースペース｜東京のレンタルスペース・貸し会議室 公式予約サイト",
    template: "%s | ブルースペース",
  },
  description:
    "ブルーステージ合同会社が運営する東京のレンタルスペース・貸し会議室「ブルースペース」の公式予約サイト。上野・神田・西新宿・京成小岩・白金高輪の7拠点。仲介手数料なしの公式予約、空き状況を見てそのままクレジットカードで予約完了。",
  // canonical はここに置かない。Next.js の metadata は親から継承されるため、
  // ルートに固定値を置くと自前で上書きしていない全ページが「トップページが正規URL」と
  // 申告してしまい、Search Console で「代替ページ（適切なcanonicalタグあり）」になる。
  // トップページの canonical は src/app/page.tsx 側で自己参照として指定する。
  openGraph: {
    siteName: "ブルースペース",
    locale: "ja_JP",
    type: "website",
    url: SITE,
  },
  twitter: {
    card: "summary_large_image",
  },
  other: {
    ...(process.env.GOOGLE_SITE_VERIFICATION
      ? { "google-site-verification": process.env.GOOGLE_SITE_VERIFICATION }
      : {}),
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body>
        <header className="site-header">
          <div className="container header-inner">
            {/* 表示名は「ブルースペース」に統一（WebSite構造化データ・GBP・og:site_nameと一致させる） */}
            <Link href="/" className="brand">
              ブルースペース <span className="brand-sub">公式予約</span>
            </Link>
            <nav className="header-nav">
              <Link href="/">拠点一覧</Link>
              <Link href="/contact">お問い合わせ</Link>
            </nav>
            <AuthNav />
          </div>
        </header>
        <main className="container main">{children}</main>
        <footer className="site-footer">
          <div className="container footer-inner">
            {/* 全ページから各拠点へ直接リンク（拠点ページへの内部リンクを増やし、エリアと拠点の関係を伝える） */}
            <nav className="footer-venues" aria-label="拠点一覧">
              {VENUE_AREAS.map((a) => (
                <div key={a.area} className="footer-venue-area">
                  <span className="footer-venue-area-name">{a.area}</span>
                  {a.slugs.map((slug) => {
                    const c = getVenueContent(slug);
                    if (!c) return null;
                    return (
                      <Link key={slug} href={`/${slug}`}>
                        {c.name.replace(/^ブルースペース/, "")}（{c.station.split(" / ")[0]}）
                      </Link>
                    );
                  })}
                </div>
              ))}
            </nav>
            <nav className="footer-nav">
              <Link href="/contact">お問い合わせ</Link>
              <Link href="/legal/terms">利用規約</Link>
              <Link href="/legal/privacy">プライバシーポリシー</Link>
              <Link href="/legal/tokushoho">特定商取引法に基づく表記</Link>
              <a href={CORPORATE_URL} target="_blank" rel="noopener noreferrer">
                運営会社（ブルーステージ合同会社）
              </a>
            </nav>
            <p>© ブルーステージ合同会社</p>
          </div>
        </footer>
        {/* 運営会社（全ページ共通）。拠点の LocalBusiness は parentOrganization の @id でここを参照する */}
        <JsonLd data={buildOrganizationJsonLd(SITE)} />
        <GoogleAnalytics />
      </body>
    </html>
  );
}
