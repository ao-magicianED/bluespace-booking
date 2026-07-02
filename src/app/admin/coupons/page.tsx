import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import AdminCouponGrantForm from "@/components/AdminCouponGrantForm";

export const dynamic = "force-dynamic";

type GrantRow = {
  email: string;
  kind: string;
  coupon_code: string;
  created_at: string;
};

export default async function AdminCouponsPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const db = getDb();
  const { data: grants } = await db
    .from("coupon_grants")
    .select("email, kind, coupon_code, created_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <>
      <p>
        <Link href="/admin">← 管理ダッシュボードへ戻る</Link>
      </p>
      <h1>クーポン発行</h1>

      <AdminCouponGrantForm />

      <div style={{ marginTop: "2rem" }}>
        <h3>発行履歴（直近100件・自動配布分も含む）</h3>
        <table className="legal-table" style={{ fontSize: "0.9rem" }}>
          <thead>
            <tr>
              <th>発行日時</th>
              <th>メール</th>
              <th>区分</th>
              <th>コード</th>
            </tr>
          </thead>
          <tbody>
            {((grants ?? []) as GrantRow[]).map((g) => (
              <tr key={`${g.email}-${g.kind}`}>
                <td>{new Date(g.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                <td>{g.email}</td>
                <td>{g.kind}</td>
                <td>{g.coupon_code}</td>
              </tr>
            ))}
            {(grants ?? []).length === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "var(--gray-text)" }}>
                  発行履歴はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
