import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** 管理画面: 拠点一覧（入退室案内・FAQ・写真の編集入口） */
export default async function AdminVenuesPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const db = getDb();
  const [{ data: venues }, { data: photoCounts }] = await Promise.all([
    db.from("venues").select("id, slug, name, access_info, faqs, active").order("name"),
    db.from("venue_photos").select("venue_id"),
  ]);
  const countByVenue = new Map<string, number>();
  for (const p of photoCounts ?? []) {
    countByVenue.set(p.venue_id, (countByVenue.get(p.venue_id) ?? 0) + 1);
  }

  return (
    <>
      <div className="admin-header">
        <h1>拠点情報の編集</h1>
        <Link href="/admin" className="policy">
          ← 管理ダッシュボードへ戻る
        </Link>
      </div>
      <p className="policy">
        拠点を選ぶと、入退室案内・よくある質問（FAQ）・写真ギャラリーを編集できます。
      </p>
      <div className="booking-list">
        {(venues ?? []).map((v) => (
          <Link key={v.id} href={`/admin/venues/${v.slug}`} className="booking-card">
            <div>
              <strong>{v.name}</strong>
              {!v.active && "　（非公開）"}
            </div>
            <div className="policy">
              🔑 入退室案内 {v.access_info ? `${v.access_info.length.toLocaleString()}文字` : "未設定"}
              　❓ FAQ {v.faqs ? "カスタム" : "デフォルト"}　📷 写真 {countByVenue.get(v.id) ?? 0}枚
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
