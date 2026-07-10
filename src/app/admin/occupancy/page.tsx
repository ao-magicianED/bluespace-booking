import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import {
  collectOccupancyData,
  PAST_WEEKS,
  type OccupancyReportData,
} from "@/lib/occupancy-report";
import { jstDayOfWeek } from "@/lib/slots";
import type { AlertLevel, OccupancySummary } from "@/lib/occupancy";

export const dynamic = "force-dynamic";

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const LEVEL_EMOJI: Record<AlertLevel, string> = { low: "🔴", normal: "⚪", high: "🟢" };
const LEVEL_LABEL: Record<AlertLevel, string> = { low: "低稼働", normal: "平常", high: "好調" };
const LEVEL_ORDER: Record<AlertLevel, number> = { low: 0, high: 1, normal: 2 };

function pct(s: OccupancySummary): string {
  return s.capacityHours > 0 ? `${(s.rate * 100).toFixed(1)}%` : "—";
}
function hrs(h: number): string {
  return `${h.toFixed(1)}h`;
}
function dateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${DOW[jstDayOfWeek(date)]})`;
}

/** 管理画面: 拠点別の稼働率・空き状況とアラート */
function OccupancyHeader() {
  return (
    <div className="admin-header">
      <h1>稼働率・空き状況</h1>
      <Link href="/admin" className="policy">
        ← 管理ダッシュボードへ戻る
      </Link>
    </div>
  );
}

export default async function AdminOccupancyPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  // DB障害時にNext.jsの汎用エラー画面へ落とさず、既存管理ページの慣例どおりインライン表示する
  let data: OccupancyReportData;
  try {
    data = await collectOccupancyData(new Date());
  } catch (e) {
    return (
      <>
        <OccupancyHeader />
        <div className="notice error">
          取得エラー: {e instanceof Error ? e.message : String(e)}
        </div>
      </>
    );
  }

  if (data.venues.length === 0) {
    return (
      <>
        <OccupancyHeader />
        <p className="policy">アクティブな拠点がないため、表示できるデータがありません。</p>
      </>
    );
  }

  const calendarErrors = data.venues.filter((v) => !v.calendarOk);
  const alertRows = [...data.venues].sort(
    (a, b) => LEVEL_ORDER[a.alert.level] - LEVEL_ORDER[b.alert.level]
  );
  const nextDates = data.venues[0]?.nextDays.map((d) => d.date) ?? [];
  const months = data.venues[0]?.monthlyOwn.map((m) => m.month) ?? [];

  return (
    <>
      <OccupancyHeader />
      <p className="policy">
        {data.today} 時点。「来週」は今日からの7日間、「過去{PAST_WEEKS}週平均」は昨日までの
        {PAST_WEEKS}週間の週平均です。埋まり時間には外部サイト予約・手動ブロック（Googleカレンダー）を
        含みます。年間・月別の稼働率は自社の確定予約のみです。毎朝7時に同じ内容のレポートを
        メール・Discordへ自動送信しています。
      </p>

      {calendarErrors.length > 0 && (
        <div className="notice error">
          ⚠️ Googleカレンダーの取得に失敗した拠点は自社予約のみで集計しています:{" "}
          {calendarErrors.map((v) => v.name).join("、")}
        </div>
      )}
      {data.bookingsTruncated && (
        <div className="notice error">
          ⚠️ 予約データが取得上限に達したため、数値が実際より少なく出ている可能性があります。
        </div>
      )}

      <h2 className="analytics-h">🚨 アラート（来週の予約 vs 過去{PAST_WEEKS}週平均）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>拠点</th>
              <th>判定</th>
              <th>来週の予約</th>
              <th>過去{PAST_WEEKS}週平均</th>
              <th>対比</th>
              <th>提案</th>
            </tr>
          </thead>
          <tbody>
            {alertRows.map((v) => (
              <tr key={v.slug}>
                <td>{v.name}</td>
                <td>
                  {LEVEL_EMOJI[v.alert.level]} {LEVEL_LABEL[v.alert.level]}
                </td>
                <td>{hrs(v.nextWeek.busyHours)}</td>
                <td>{hrs(v.avgWeekHours)}/週</td>
                <td>{v.alert.ratioPercent != null ? `${v.alert.ratioPercent}%` : "—"}</td>
                <td>
                  {v.alert.message}
                  {!v.calendarOk && "（⚠️カレンダー未取得・自社予約のみで判定）"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">📅 来週7日間の予約状況（埋まり時間）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>拠点</th>
              {nextDates.map((d) => (
                <th key={d}>{dateLabel(d)}</th>
              ))}
              <th>計</th>
            </tr>
          </thead>
          <tbody>
            {data.venues.map((v) => (
              <tr key={v.slug}>
                <td>{v.name}</td>
                {v.nextDays.map((d) => (
                  <td key={d.date}>{d.busyHours > 0 ? hrs(d.busyHours) : "—"}</td>
                ))}
                <td>
                  {hrs(v.nextWeek.busyHours)}（{pct(v.nextWeek)}）
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">📈 週別の埋まり時間の推移（過去{PAST_WEEKS}週 → 来週）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>拠点</th>
              {data.venues[0]?.pastWeeksHours.map((_, i) => (
                <th key={i}>{PAST_WEEKS - i}週前</th>
              ))}
              <th>来週</th>
            </tr>
          </thead>
          <tbody>
            {data.venues.map((v) => (
              <tr key={v.slug}>
                <td>{v.name}</td>
                {v.pastWeeksHours.map((h, i) => (
                  <td key={i}>{hrs(h)}</td>
                ))}
                <td>{hrs(v.nextWeek.busyHours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">
        🗓️ {data.today.slice(0, 4)}年の月別稼働率（自社確定予約・営業時間比）
      </h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>拠点</th>
              {months.map((m) => (
                <th key={m}>{m}</th>
              ))}
              <th>年間累計</th>
            </tr>
          </thead>
          <tbody>
            {data.venues.map((v) => (
              <tr key={v.slug}>
                <td>{v.name}</td>
                {v.monthlyOwn.map((m) => (
                  <td key={m.month}>{pct(m.summary)}</td>
                ))}
                <td>
                  {pct(v.yearOwn)}（{hrs(v.yearOwn.busyHours)}）
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="policy">
        進行中の月と年間累計は昨日までの実績で計算しています。稼働率 = 埋まり時間 ÷ 営業時間の総枠。
      </p>
    </>
  );
}
