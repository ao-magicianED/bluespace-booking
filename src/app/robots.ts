import type { MetadataRoute } from "next";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // 予約フロー・会員ページ・APIは検索結果に不要
        disallow: ["/api/", "/my", "/my/", "/thanks", "/login", "/signup", "/admin", "/admin/"],
      },
    ],
    sitemap: `${SITE}/sitemap.xml`,
  };
}
