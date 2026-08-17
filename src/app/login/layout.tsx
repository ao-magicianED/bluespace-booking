import type { Metadata } from "next";

/**
 * ログインページのメタデータ。
 * page.tsx は "use client" のため metadata を書けず、layout.tsx 側で指定している。
 * 検索結果に出す価値がないので noindex（robots.txt で Disallow すると
 * noindex 自体が読まれなくなるため、Disallow は追加しないこと）。
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return children;
}
