import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { JST_OFFSET_MS } from "@/lib/slots";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Booking & { venues: { name: string } | null };

function hoursOf(b: Row): number {
  return (new Date(b.end_at).getTime() - new Date(b.start_at).getTime()) / 3600000;
}
function jstMonth(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

/** 管理画面: 予約者・スペースの分析（確定予約ベース、返金控除後） */
export default async function AdminAnalyticsPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const { data } = await getDb()
    .from("bookings")
    .select("*, venues(name)")
    .eq("booking_status", "confirmed")
    .order("start_at", { ascending: true })
    .limit(5000);
  const rows = (data ?? []) as Row[];

  const net = (b: Row) => b.total_amount - (b.refunded_amount ?? 0);
  const totalSales = rows.reduce((s, b) => s + net(b), 0);

  // ── 顧客分析（メール小文字一致で同一顧客とみなす） ──
  const byCustomer = new Map<string, { name: string; count: number; sales: number; last: string }>();
  for (const b of rows) {
    const key = b.customer_email.trim().toLowerCase();
    const cur = byCustomer.get(key) ?? { name: b.customer_name, count: 0, sales: 0, last: "" };
    cur.count++;
    cur.sales += net(b);
    if (b.start_at > cur.last) {
      cur.last = b.start_at;
      cur.name = b.customer_name;
    }
    byCustomer.set(key, cur);
  }
  const customers = [...byCustomer.entries()];
  const uniqueCustomers = customers.length;
  const repeaters = customers.filter(([, c]) => c.count >= 2).length;
  const avgVisits = uniqueCustomers ? rows.length / uniqueCustomers : 0;
  const avgPerBooking = rows.length ? totalSales / rows.length : 0;
  const avgLtv = uniqueCustomers ? totalSales / uniqueCustomers : 0;
  const partyRows = rows.filter((b) => b.party_size != null);
  const avgParty = partyRows.length
    ? partyRows.reduce((s, b) => s + (b.party_size ?? 0), 0) / partyRows.length
    : 0;
  const avgHours = rows.length ? rows.reduce((s, b) => s + hoursOf(b), 0) / rows.length : 0;
  const topCustomers = customers.sort((a, b) => b[1].sales - a[1].sales).slice(0, 10);

  // ── 拠点別分析 ──
  const byVenue = new Map<string, { count: number; sales: number; hours: number; party: number; partyN: number }>();
  for (const b of rows) {
    const key = b.venues?.name ?? "(不明)";
    const cur = byVenue.get(key) ?? { count: 0, sales: 0, hours: 0, party: 0, partyN: 0 };
    cur.count++;
    cur.sales += net(b);
    cur.hours += hoursOf(b);
    if (b.party_size != null) {
      cur.party += b.party_size;
      cur.partyN++;
    }
    byVenue.set(key, cur);
  }
  const venueRows = [...byVenue.entries()].sort((a, b) => b[1].sales - a[1].sales);

  // ── 月別推移（直近6ヶ月） ──
  const byMonth = new Map<string, { count: number; sales: number }>();
  for (const b of rows) {
    const m = jstMonth(b.start_at);
    const cur = byMonth.get(m) ?? { count: 0, sales: 0 };
    cur.count++;
    cur.sales += net(b);
    byMonth.set(m, cur);
  }
  const monthRows = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);

  return (
    <>
      <div className="admin-header">
        <h1>分析</h1>
        <Link href="/admin" className="policy">
          ← 管理ダッシュボードへ戻る
        </Link>
      </div>
      <p className="policy">確定予約{rows.length}件・返金控除後の実収ベースで集計しています。</p>

      <h2 className="analytics-h">👤 予約者の分析</h2>
      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">ユニーク顧客数</span>
          <span className="stat-value">{uniqueCustomers}人</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">平均利用回数</span>
          <span className="stat-value">{avgVisits.toFixed(2)}回</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">リピーター（2回以上）</span>
          <span className="stat-value">
            {repeaters}人（{uniqueCustomers ? Math.round((repeaters / uniqueCustomers) * 100) : 0}%）
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">平均単価（1予約）</span>
          <span className="stat-value">{yen(avgPerBooking)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">平均累計額（1顧客）</span>
          <span className="stat-value">{yen(avgLtv)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">平均人数 / 平均時間</span>
          <span className="stat-value">
            {avgParty ? `${avgParty.toFixed(1)}名` : "—"} / {avgHours.toFixed(1)}h
          </span>
        </div>
      </div>

      <h2 className="analytics-h">🏢 スペース別</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>拠点</th>
              <th>件数</th>
              <th>実収額</th>
              <th>平均単価</th>
              <th>平均時間</th>
              <th>平均人数</th>
            </tr>
          </thead>
          <tbody>
            {venueRows.map(([name, v]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{v.count}件</td>
                <td className="ledger-amount">{yen(v.sales)}</td>
                <td className="ledger-amount">{yen(v.sales / v.count)}</td>
                <td>{(v.hours / v.count).toFixed(1)}h</td>
                <td>{v.partyN ? `${(v.party / v.partyN).toFixed(1)}名` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">📅 月別推移（直近6ヶ月）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>月</th>
              <th>件数</th>
              <th>実収額</th>
              <th>平均単価</th>
            </tr>
          </thead>
          <tbody>
            {monthRows.map(([m, v]) => (
              <tr key={m}>
                <td>{m}</td>
                <td>{v.count}件</td>
                <td className="ledger-amount">{yen(v.sales)}</td>
                <td className="ledger-amount">{yen(v.sales / v.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">🏆 トップ顧客（累計額順・上位10）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>お客様</th>
              <th>メール</th>
              <th>利用回数</th>
              <th>累計額</th>
            </tr>
          </thead>
          <tbody>
            {topCustomers.map(([email, c]) => (
              <tr key={email}>
                <td>{c.name}</td>
                <td>{email}</td>
                <td>{c.count}回</td>
                <td className="ledger-amount">{yen(c.sales)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
