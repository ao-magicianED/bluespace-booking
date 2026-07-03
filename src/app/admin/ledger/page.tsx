import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import { computeRepeatNumbers, formatMemberNo, realizedRevenue } from "@/lib/ledger";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "決済待ち",
  confirmed: "確定",
  cancelled: "キャンセル",
  expired: "期限切れ",
};

const FILTERS = [
  { key: "confirmed", label: "確定" },
  { key: "cancelled", label: "キャンセル" },
  { key: "all", label: "すべて" },
] as const;

type Row = Booking & { venues: { name: string } | null };

/** 管理画面: 予約台帳（リピート回数・会員番号・金額つき一覧＋CSVダウンロード） */
export default async function AdminLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { f = "confirmed" } = await searchParams;

  const db = getDb();
  // リピート計算は全件ベース、表示はフィルタで絞る
  const [{ data: allBookings }, { data: members }] = await Promise.all([
    db
      .from("bookings")
      .select("*, venues(name)")
      .order("start_at", { ascending: false })
      .limit(5000),
    db.from("member_profiles").select("user_id, member_no"),
  ]);
  const all = (allBookings ?? []) as Row[];
  const memberByUser = new Map((members ?? []).map((m) => [m.user_id, m.member_no as number]));
  const repeat = computeRepeatNumbers(all);

  const rows = (f === "all" ? all : all.filter((b) => b.booking_status === f)).slice(0, 300);

  const totalSales = all.reduce((s, b) => s + realizedRevenue(b), 0);

  return (
    <>
      <div className="admin-header">
        <h1>予約台帳</h1>
        <span>
          <a href="/api/admin/ledger-csv" className="policy">
            ⬇ CSVダウンロード（全件・Excel対応）
          </a>
          {"　"}
          <Link href="/admin" className="policy">
            ← 管理ダッシュボードへ戻る
          </Link>
        </span>
      </div>

      <p className="policy">
        確定予約の累計実収額（返金控除後）: <strong>¥{totalSales.toLocaleString()}</strong>　/
        リピート回数は同一メールアドレスの確定予約を利用日順に数えたものです。
      </p>

      <div className="admin-filters">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/admin/ledger?f=${x.key}`}
            className={`admin-filter ${f === x.key ? "active" : ""}`}
          >
            {x.label}
          </Link>
        ))}
      </div>

      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>利用日時</th>
              <th>拠点</th>
              <th>お客様</th>
              <th>会員No</th>
              <th>回数（確定 / 全体）</th>
              <th>人数</th>
              <th>支払</th>
              <th>状態</th>
              <th>金額</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => {
              const rep = repeat.get(b.id);
              const net = realizedRevenue(b);
              return (
                <tr key={b.id}>
                  <td>
                    <Link href={`/admin/bookings/${b.id}`}>{formatBookingPeriod(b)}</Link>
                  </td>
                  <td>{b.venues?.name?.replace("ブルースペース", "") ?? ""}</td>
                  <td>
                    {b.customer_name}
                    {b.company_name ? `（${b.company_name}）` : ""}
                  </td>
                  <td>{b.user_id ? formatMemberNo(memberByUser.get(b.user_id)) : "—"}</td>
                  <td>
                    {rep ? (
                      <>
                        <strong className={rep.seq > 1 ? "repeat-badge" : ""}>
                          {rep.seq > 0 ? `${rep.seq}/${rep.total}回` : `—/${rep.total}回`}
                        </strong>
                        {(rep.totalAll > rep.total || rep.cancelled > 0) && (
                          <>
                            <br />
                            <span className="policy">
                              全{rep.totalAll}件
                              {rep.cancelled > 0 ? `（キャンセル${rep.cancelled}）` : ""}
                            </span>
                          </>
                        )}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{b.party_size != null ? `${b.party_size}名` : "—"}</td>
                  <td>{b.payment_method === "invoice" ? "請求書" : "カード"}</td>
                  <td>
                    <span className={`status-badge st-${b.booking_status}`}>
                      {STATUS_LABEL[b.booking_status] ?? b.booking_status}
                    </span>
                  </td>
                  <td className="ledger-amount">
                    ¥{net.toLocaleString()}
                    {(b.refunded_amount ?? 0) > 0 && (
                      <span className="policy">（返金¥{b.refunded_amount.toLocaleString()}）</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9}>該当する予約はありません。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length === 300 && (
        <p className="policy">※表示は300件まで。全件はCSVダウンロードをご利用ください。</p>
      )}
    </>
  );
}
