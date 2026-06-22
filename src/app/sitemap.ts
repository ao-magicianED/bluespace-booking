import type { MetadataRoute } from "next";
import { getDb, isDbConfigured } from "@/lib/supabase";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

// 拠点の追加・公開がデプロイなしで反映されるよう1時間ごとに再生成
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: SITE, changeFrequency: "weekly", priority: 1 },
    {
      url: `${SITE}/storage/shirokane-takanawa`,
      changeFrequency: "weekly",
      priority: 0.85,
    },
    { url: `${SITE}/legal/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/legal/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/legal/tokushoho`, changeFrequency: "yearly", priority: 0.2 },
  ];

  if (isDbConfigured()) {
    try {
      const { data: venues } = await getDb()
        .from("venues")
        .select("slug")
        .eq("active", true);
      for (const v of venues ?? []) {
        entries.push({
          url: `${SITE}/${v.slug}`,
          changeFrequency: "daily",
          priority: 0.9,
        });
      }
    } catch (e) {
      console.error("[sitemap]", e);
    }
  }
  return entries;
}
