import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // ここに書いてよいのは「クロールさせたくない」ものだけ。
        // 「検索結果に出したくない」だけのページ（/my・/login・/signup・/thanks・/admin）は
        // Disallow ではなく各ページの noindex（layout.tsx の metadata.robots）で除外する。
        // Disallow するとクロール自体が止まって noindex が読まれないため、
        // 他ページからリンクされているURLは Search Console で
        // 「robots.txt によりブロックされましたが、インデックスに登録しました」になってしまう。
        // 実際 /login・/my は全ページ共通ヘッダー（AuthNav）からリンクしているのでこれに該当した。
        //
        // /api/ だけは Disallow を残す。HTMLから辿れるリンクは管理画面内の1件のみで、
        // その管理画面自体が要認証（Googlebotは入れない）ため上記の問題は起きず、
        // cronなどの副作用のあるエンドポイントをクロールさせない効果のほうが大きい。
        disallow: ["/api/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
