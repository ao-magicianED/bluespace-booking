import type { Metadata } from "next";

/**
 * 管理画面（/admin 配下すべて）のメタデータ。
 * 検索結果に出してはいけない → noindex。
 * Next.js の metadata は親 layout から継承されるため、
 * ここに置くだけで /admin/login や /admin/venues/[slug] などもまとめて noindex になる。
 *
 * ※robots.txt で Disallow してはいけない。クロールされないと noindex が読まれず、
 *   Search Console で「robots.txt によりブロックされましたが、インデックスに登録しました」になる。
 *   むしろ robots.txt は誰でも読めるので、そこに /admin と書かないほうが所在を晒さずに済む。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return children;
}
