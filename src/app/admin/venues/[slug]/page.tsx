import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { getVenueContent } from "@/content/venues";
import AccessInfoEditor from "@/components/AccessInfoEditor";
import FaqEditor from "@/components/FaqEditor";
import PhotoManager from "@/components/PhotoManager";
import type { Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/** 管理画面: 1拠点の入退室案内・FAQ・写真をまとめて編集 */
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
    .select("id, slug, name, access_info, faqs, active")
    .eq("slug", slug)
    .maybeSingle<Pick<Venue, "id" | "slug" | "name" | "access_info" | "faqs" | "active">>();
  if (!venue) notFound();

  const { data: photos } = await db
    .from("venue_photos")
    .select("id, category_id, category_label, src, sort")
    .eq("venue_id", venue.id)
    .order("cat_sort", { ascending: true })
    .order("sort", { ascending: true });

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
