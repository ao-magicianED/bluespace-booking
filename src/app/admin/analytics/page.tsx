import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { JST_OFFSET_MS, utcToJstDateStr } from "@/lib/slots";
import MonthlyChart, { type MonthlyData } from "@/components/MonthlyChart";
import { realizedRevenue } from "@/lib/ledger";
import {
  computeCustomerInsights,
  DAY_TYPES,
  LEAD_TIME_BUCKETS,
  parseEmailList,
  PURPOSE_BUCKETS,
  SEGMENTS,
  START_HOUR_BUCKETS,
  type SegmentStats,
} from "@/lib/customer-insights";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

type Row = Booking & { venues: { name: string } | null };

function pct(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : "—";
}

/** 分布表の1グループ（見出し行＋ラベルごとに「件数（区分内の割合）」を初回/リピートで並べる） */
function distRows<K extends string>(
  title: string,
  labels: readonly K[],
  pick: (s: SegmentStats) => Partial<Record<K, number>>,
  segs: SegmentStats[]
) {
  return [
    <tr key={`${title}-head`}>
      <th colSpan={segs.length + 1}>{title}</th>
    </tr>,
    ...labels.map((label) => (
      <tr key={`${title}-${label}`}>
        <td>{label}</td>
        {segs.map((s, i) => {
          const n = pick(s)[label] ?? 0;
          return <td key={i}>{s.bookings ? `${n}件（${pct(n, s.bookings)}）` : "—"}</td>;
        })}
      </tr>
    )),
  ];
}

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

  const net = (b: Row) => realizedRevenue(b);
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

  // ── 月別グラフ用（直近12ヶ月・拠点別含む） ──
  const venueSet = new Set<string>();
  const monthVenue = new Map<string, Map<string, { count: number; sales: number }>>();
  for (const b of rows) {
    const m = jstMonth(b.start_at);
    const vname = b.venues?.name ?? "(不明)";
    venueSet.add(vname);
    const venueMap = monthVenue.get(m) ?? new Map<string, { count: number; sales: number }>();
    const cur = venueMap.get(vname) ?? { count: 0, sales: 0 };
    cur.count++;
    cur.sales += net(b);
    venueMap.set(vname, cur);
    monthVenue.set(m, venueMap);
  }
  const sortedMonths = [...monthVenue.keys()].sort().slice(-12); // 古い→新しい
  const chartData: MonthlyData[] = sortedMonths.map((m) => ({
    month: m,
    byVenue: Object.fromEntries((monthVenue.get(m) ?? new Map()).entries()),
  }));
  const sortedVenues = [...venueSet].sort();

  // ── 新規とリピーターの特徴（社内・テスト予約を除外。個人は表示しない） ──
  // 除外する社内メールは環境変数 INTERNAL_EMAILS（カンマ区切り・大文字小文字無視）
  const internalEmails = parseEmailList(process.env.INTERNAL_EMAILS);
  const startDates = rows.map((b) => utcToJstDateStr(new Date(b.start_at))).sort();
  let holidaySet = new Set<string>();
  let holidayError = false;
  if (startDates.length > 0) {
    const { data: hol, error: holErr } = await getDb()
      .from("jp_holidays")
      .select("date")
      .gte("date", startDates[0])
      .lte("date", startDates[startDates.length - 1]);
    if (holErr) {
      // 読めなくても分析は止めない（土日のみで判定し、画面に注記する）
      console.error("[analytics] 祝日データの取得エラー（土日のみで判定）:", holErr.code, holErr.message);
      holidayError = true;
    } else {
      holidaySet = new Set((hol ?? []).map((r) => r.date as string));
    }
  }
  const insights = computeCustomerInsights(
    rows.map((b) => ({
      customer_email: b.customer_email,
      user_id: b.user_id,
      customer_type: b.customer_type,
      party_size: b.party_size,
      purpose: b.purpose,
      start_at: b.start_at,
      end_at: b.end_at,
      created_at: b.created_at,
      venue_name: b.venues?.name ?? "(不明)",
      revenue: net(b),
    })),
    { excludedEmails: internalEmails, holidaySet }
  );
  const segs = SEGMENTS.map((k) => insights.segments[k]);
  const purposeLabels = PURPOSE_BUCKETS.filter((k) => segs.some((s) => s.purpose[k] > 0));
  const venueTotals = new Map<string, number>();
  for (const s of segs) {
    for (const v of s.venues) venueTotals.set(v.name, (venueTotals.get(v.name) ?? 0) + v.count);
  }
  const venueLabels = [...venueTotals.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);

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

      <h2 className="analytics-h">🔁 新規とリピーターの特徴</h2>
      <p className="policy">
        社内・テスト予約{insights.excluded.total}件（社内メール{insights.excluded.internalEmail}件・目的がテスト
        {insights.excluded.testPurpose}件）を除外。社内メールは環境変数 INTERNAL_EMAILS（カンマ区切り）で設定
        {internalEmails.size ? `（現在${internalEmails.size}件）` : "（未設定）"}。
      </p>
      <p className="policy">
        同じメールの予約を予約日時順に並べ、1件目＝初回・2件目以降＝リピートとして比較。リピーターは別の日に2回以上利用した顧客。
        {holidayError && "※祝日データを取得できなかったため、曜日は土日のみで判定しています。"}
      </p>
      {insights.totalBookings === 0 ? (
        <p className="policy">データがありません。</p>
      ) : (
        <>
          <div className="stat-grid">
            <div className="stat-card">
              <span className="stat-label">顧客数（集計対象）</span>
              <span className="stat-value">{insights.customers.unique}人</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">リピーター（別日に2回以上）</span>
              <span className="stat-value">
                {insights.customers.repeaters}人（{pct(insights.customers.repeaters, insights.customers.unique)}）
              </span>
            </div>
            <div className="stat-card">
              <span className="stat-label">初回→2回目の間隔（中央値）</span>
              <span className="stat-value">
                {insights.customers.medianDaysToSecondVisit == null
                  ? "—"
                  : `${insights.customers.medianDaysToSecondVisit}日`}
              </span>
            </div>
          </div>

          <div className="ledger-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>指標</th>
                  {SEGMENTS.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>予約件数（構成比）</td>
                  {segs.map((s, i) => (
                    <td key={i}>
                      {s.bookings}件（{pct(s.bookings, insights.totalBookings)}）
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>実収額（合計）</td>
                  {segs.map((s, i) => (
                    <td key={i} className="ledger-amount">
                      {yen(s.revenue)}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>平均単価（1予約）</td>
                  {segs.map((s, i) => (
                    <td key={i} className="ledger-amount">
                      {s.bookings ? yen(s.avgRevenue) : "—"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>平均人数</td>
                  {segs.map((s, i) => (
                    <td key={i}>
                      {s.avgPartySize == null ? "—" : `${s.avgPartySize.toFixed(1)}名（n=${s.partySizeN}）`}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>平均利用時間</td>
                  {segs.map((s, i) => (
                    <td key={i}>{s.avgHours == null ? "—" : `${s.avgHours.toFixed(1)}h`}</td>
                  ))}
                </tr>
                <tr>
                  <td>会員の予約</td>
                  {segs.map((s, i) => (
                    <td key={i}>{pct(s.members, s.bookings)}</td>
                  ))}
                </tr>
                <tr>
                  <td>法人の予約</td>
                  {segs.map((s, i) => (
                    <td key={i}>{pct(s.corporate, s.bookings)}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="ledger-wrap" style={{ marginTop: "0.8rem" }}>
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>区分</th>
                  {SEGMENTS.map((k) => (
                    <th key={k}>{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {distRows("予約のタイミング（利用開始の何日前か）", LEAD_TIME_BUCKETS, (s) => s.leadTime, segs)}
                {distRows("曜日", DAY_TYPES, (s) => s.dayType, segs)}
                {distRows("開始時刻（JST）", START_HOUR_BUCKETS, (s) => s.startHour, segs)}
                {distRows("ご利用目的", purposeLabels, (s) => s.purpose, segs)}
                {distRows(
                  "拠点",
                  venueLabels,
                  (s) => Object.fromEntries(s.venues.map((v) => [v.name, v.count])),
                  segs
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

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

      <h2 className="analytics-h">📊 月別グラフ（直近12ヶ月・全体／拠点別）</h2>
      {chartData.length > 0 ? (
        <MonthlyChart months={chartData} venues={sortedVenues} />
      ) : (
        <p className="policy">データがありません。</p>
      )}

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
