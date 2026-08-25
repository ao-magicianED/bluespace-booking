import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { getVenueContent } from "@/content/venues";
import { VENUE_PRICING_POLICY } from "@/lib/price-actions";
import AccessInfoEditor from "@/components/AccessInfoEditor";
import AdminEntryTokenManager, { type EntryTokenRow } from "@/components/AdminEntryTokenManager";
import AdminPriceBandEditor from "@/components/AdminPriceBandEditor";
import FaqEditor from "@/components/FaqEditor";
import PhotoManager from "@/components/PhotoManager";
import type { PriceBand } from "@/lib/pricing";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 管理画面: 1拠点の料金帯・QRトークン・入退室案内・FAQ・写真をまとめて編集 */
export default async function AdminVenueDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { slug } = await params;

  const db = getDb();
  const { data: venue } = await db
    .from("venues")
    .select("id, slug, name, access_info, faqs, active, hourly_price, holiday_hourly_price")
    .eq("slug", slug)
    .maybeSingle<
      Pick<
        Venue,
        "id" | "slug" | "name" | "access_info" | "faqs" | "active" | "hourly_price" | "holiday_hourly_price"
      >
    >();
  if (!venue) notFound();

  const [{ data: photos }, { data: bandRows }, { data: tokenRows }] = await Promise.all([
    db
      .from("venue_photos")
      .select("id, category_id, category_label, src, sort")
      .eq("venue_id", venue.id)
      .order("cat_sort", { ascending: true })
      .order("sort", { ascending: true }),
    db
      .from("venue_price_bands")
      .select("tier, day_type, start_hour, end_hour, hourly_price")
      .eq("venue_id", venue.id)
      .order("start_hour", { ascending: true }),
    db
      .from("venue_entry_tokens")
      .select("token, active, label, created_at")
      .eq("venue_id", venue.id)
      .order("created_at", { ascending: false }),
  ]);

  const bands = (bandRows ?? []) as {
    tier: string;
    day_type: string;
    start_hour: number;
    end_hour: number;
    hourly_price: number;
  }[];
  const pickBands = (dayType: string, tier: string): PriceBand[] =>
    bands
      .filter((b) => b.day_type === dayType && b.tier === tier)
      .map((b) => ({ startHour: b.start_hour, endHour: b.end_hour, hourlyPrice: b.hourly_price }));

  const dbFaqs = (venue.faqs ?? null) as { q: string; a: string }[] | null;
  const defaultFaqs = getVenueContent(slug)?.faqs ?? [];
  const effectiveFaqs = dbFaqs && dbFaqs.length > 0 ? dbFaqs : defaultFaqs;

  return (
    <>
      <div className="admin-header">
        <h1>
          {venue.name}
          {venue.active ? "" : "（非公開）"}
        </h1>
        <span>
          <Link href={`/${venue.slug}`} className="policy" target="_blank">
            公開ページを見る ↗
          </Link>
          {"　"}
          <Link href="/admin/venues" className="policy">
            ← 拠点一覧へ戻る
          </Link>
        </span>
      </div>

      <AdminPriceBandEditor
        venueId={venue.id}
        weekdayStandard={pickBands("weekday", "standard")}
        weekdayRepeat={pickBands("weekday", "repeat")}
        holidayStandard={pickBands("holiday", "standard")}
        holidayRepeat={pickBands("holiday", "repeat")}
        weekdayFlatPrice={venue.hourly_price}
        holidayFlatPrice={venue.holiday_hourly_price ?? venue.hourly_price}
        floorPrice={VENUE_PRICING_POLICY[venue.slug]?.floorPrice ?? null}
      />

      <AdminEntryTokenManager venueId={venue.id} initialTokens={(tokenRows ?? []) as EntryTokenRow[]} />

      <PhotoManager
        venueId={venue.id}
        photos={(photos ?? []) as {
          id: string;
          category_id: string;
          category_label: string;
          src: string;
          sort: number;
        }[]}
      />

      <FaqEditor venueId={venue.id} initial={effectiveFaqs} isCustom={Boolean(dbFaqs?.length)} />

      <div className="access-editor" style={{ padding: 0, border: "none", background: "none" }}>
        <AccessInfoEditor
          venueId={venue.id}
          venueName="入退室のご案内（確定したお客様のみに表示）"
          initial={venue.access_info ?? ""}
        />
      </div>
    </>
  );
}
