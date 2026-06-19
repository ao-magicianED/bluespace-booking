import type { Metadata } from "next";
import { Noto_Sans_JP } from "next/font/google";
import Link from "next/link";
import AuthNav from "@/components/AuthNav";
import "./globals.css";

const notoSansJP = Noto_Sans_JP({
  subsets: ["latin"],
  weight: ["400", "500", "700", "900"],
  display: "swap",
  variable: "--font-jp",
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "ブルースペース｜レンタルスペース公式予約サイト",
    template: "%s | ブルースペース",
  },
  description:
    "ブルーステージ合同会社が運営するレンタルスペース「ブルースペース」の公式予約サイト。仲介手数料なしの最安価格、空き状況を見てそのままクレジットカードで予約完了。",
  openGraph: {
    siteName: "ブルースペース公式予約",
    locale: "ja_JP",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={notoSansJP.variable}>
      <body>
        <header className="site-header">
          <div className="container header-inner">
            <Link href="/" className="brand">
              ブルーステージ レンタルスペース予約
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
            <nav className="footer-nav">
              <Link href="/contact">お問い合わせ</Link>
              <Link href="/legal/terms">利用規約</Link>
              <Link href="/legal/privacy">プライバシーポリシー</Link>
              <Link href="/legal/tokushoho">特定商取引法に基づく表記</Link>
              <a href="https://bluestage-lcc.com" target="_blank" rel="noopener noreferrer">
                運営会社（ブルーステージ合同会社）
              </a>
            </nav>
            <p>© ブルーステージ合同会社</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
