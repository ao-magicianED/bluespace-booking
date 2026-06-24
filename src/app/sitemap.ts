import type { MetadataRoute } from "next";
import { getDb, isDbConfigured } from "@/lib/supabase";

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

  if (isDbConfigured()) {
    try {
      const { data: venues } = await getDb()
        .from("venues")
        .select("slug, updated_at")
        .eq("active", true);
      for (const v of venues ?? []) {
        const mod = v.updated_at ?? latestVenueDate;
        entries.push({
          url: `${SITE}/${v.slug}`,
          lastModified: mod,
          changeFrequency: "daily",
          priority: 0.9,
        });
        if (mod > latestVenueDate) latestVenueDate = mod;
      }
    } catch (e) {
      console.error("[sitemap]", e);
    }
  }

  entries.unshift({
    url: SITE,
    lastModified: latestVenueDate,
    changeFrequency: "weekly",
    priority: 1,
  });

  return entries;
}
