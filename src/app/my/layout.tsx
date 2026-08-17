import type { Metadata } from "next";

/**
 * マイページ（/my 配下すべて）のメタデータ。
 * 会員個人の予約情報なので検索結果に出してはいけない → noindex。
 * Next.js の metadata は親 layout から継承されるため、
 * ここに置くだけで /my/profile・/my/[id]・/my/[id]/receipt もまとめて noindex になる。
 *
 * ※robots.txt で Disallow してはいけない。クロールされないと noindex が読まれず、
 *   全ページ共通ヘッダー（AuthNav）からリンクしている /my が Search Console で
 *   「robots.txt によりブロックされましたが、インデックスに登録しました」になる。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function MyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
