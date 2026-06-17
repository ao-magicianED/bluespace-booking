import type { Metadata } from "next";
import { getDb, isDbConfigured } from "@/lib/supabase";
import ContactForm from "@/components/ContactForm";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "お問い合わせ・長期/定期利用のご相談",
  description:
    "ブルースペースへのお問い合わせ、長期利用・定期利用のお見積もり依頼はこちらのフォームからどうぞ。",
};

export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; venue?: string }>;
}) {
  const sp = await searchParams;
  let venues: { slug: string; name: string }[] = [];
  if (isDbConfigured()) {
    const { data } = await getDb()
      .from("venues")
      .select("slug, name")
      .eq("active", true)
      .order("name");
    venues = data ?? [];
  }
  return (
    <ContactForm
      venues={venues}
      presetType={sp.type === "longterm" ? "longterm" : "general"}
      presetVenue={sp.venue ?? ""}
    />
  );
}
