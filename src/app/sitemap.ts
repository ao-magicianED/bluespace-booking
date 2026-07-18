import type { MetadataRoute } from "next";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { venueContents } from "@/content/venues";

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let latestVenueDate = "2026-06-24";

  const entries: MetadataRoute.Sitemap = [
    {
      url: `${SITE}/contact`,
      lastModified: "2026-06-01",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${SITE}/storage/shirokane-takanawa`,
      lastModified: "2026-06-20",
      changeFrequency: "weekly",
      priority: 0.85,
    },
    { url: `${SITE}/legal/terms`, lastModified: "2026-05-01", changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/legal/privacy`, lastModified: "2026-05-01", changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE}/legal/tokushoho`, lastModified: "2026-05-01", changeFrequency: "yearly", priority: 0.2 },
  ];

  // 拠点ページのslug一覧。DBが正なので原則DBから取るが、
  // 取得に失敗したときは静的コンテンツ定義（src/content/venues.ts）にフォールバックする。
  // ※以前は存在しない updated_at カラムを select していたため PostgREST がエラーを返し、
  //   supabase-js は例外を投げない（{data:null,error}を返す）ので try/catch にも掛からず、
  //   拠点ページが1件もサイトマップに載らないサイレント障害になっていた。
  let venueSlugs: { slug: string; lastModified: string }[] = [];

  if (isDbConfigured()) {
    try {
      const { data: venues, error } = await getDb()
        .from("venues")
        .select("slug, created_at")
        .eq("active", true);
      if (error) throw error;
      venueSlugs = (venues ?? []).map((v) => ({
        slug: v.slug as string,
        lastModified: (v.created_at as string | null)?.slice(0, 10) ?? latestVenueDate,
      }));
    } catch (e) {
      console.error("[sitemap] venues取得に失敗。静的定義にフォールバックします", e);
    }
  }

  if (venueSlugs.length === 0) {
    venueSlugs = Object.keys(venueContents).map((slug) => ({ slug, lastModified: latestVenueDate }));
  }

  for (const v of venueSlugs) {
    entries.push({
      url: `${SITE}/${v.slug}`,
      lastModified: v.lastModified,
      changeFrequency: "daily",
      priority: 0.9,
    });
    if (v.lastModified > latestVenueDate) latestVenueDate = v.lastModified;
  }

  entries.unshift({
    url: SITE,
    lastModified: latestVenueDate,
    changeFrequency: "weekly",
    priority: 1,
  });

  return entries;
}
