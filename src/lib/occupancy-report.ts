import { getDb } from "./supabase";
import { getBusyRanges } from "./google-calendar";
import { addDaysJst, jstDayOfWeek, jstToUtc, todayJst } from "./slots";
import {
  dailyOccupancy,
  daysBetweenJst,
  judgeAlert,
  mergeRanges,
  occupancyForDates,
  type AlertLevel,
  type DayOccupancy,
  type OccupancyAlert,
  type OccupancySummary,
} from "./occupancy";
import { siteUrl } from "./site-url";
import type { TimeRange, Venue } from "./types";

/**
 * 稼働状況の日次レポート:
 * - 「来週（今日からの7日間）の予約」を「過去4週の週平均」と比べてアラート判定
 * - 埋まり時間 = 自社確定予約 + Googleカレンダーbusy（外部サイト予約・手動ブロック）を
 *   マージして重複なく合算（自社予約はカレンダーにも同期されているため必ずマージする）
 * - 年間・月別の稼働率は自社確定予約のみ（外部予約は売上にならないため区別する）
 */

/** アラート比較に使う過去の週数 */
export const PAST_WEEKS = 4;

/** DBスナップショットとして毎回再計算する日数（cronが数日止まっても次回実行時に欠損を埋められるように） */
export const SNAPSHOT_BACKFILL_DAYS = 3;

export type VenueOccupancy = {
  id: string;
  slug: string;
  name: string;
  openHour: number;
  closeHour: number;
  /** GoogleカレンダーのFreeBusy取得に成功したか（falseなら自社予約のみで集計） */
  calendarOk: boolean;
  /**
   * 直近数日分の日別実績（DBスナップショット保存用）。cronが1日止まっても次回実行時に
   * 埋まるよう、前日だけでなくSNAPSHOT_BACKFILL_DAYS日分を毎回計算し直す。
   */
  recentDays: { date: string; own: OccupancySummary; combined: OccupancySummary }[];
  /** 直近1週（昨日までの7日間）: 外部予約・ブロック込み */
  lastWeek: OccupancySummary;
  /** 過去4週の週別埋まり時間（古い順: [4週前, 3週前, 2週前, 直近週]） */
  pastWeeksHours: number[];
  avgWeekHours: number;
  /** 来週（今日からの7日間）: 外部予約・ブロック込み */
  nextWeek: OccupancySummary;
  nextDays: DayOccupancy[];
  /** 今年1/1〜昨日（自社確定予約のみ） */
  yearOwn: OccupancySummary;
  /** 今月1日〜昨日（自社確定予約のみ） */
  monthOwn: OccupancySummary;
  /** 今年の月別稼働率（自社確定予約のみ、進行中の月は昨日まで） */
  monthlyOwn: { month: string; summary: OccupancySummary }[];
  alert: OccupancyAlert;
};

export type OccupancyReportData = {
  /** JSTの基準日 'YYYY-MM-DD'（この日を含む7日間が「来週」） */
  today: string;
  venues: VenueOccupancy[];
  /** 予約取得が上限で打ち切られた疑いがある（数値が過少になっている可能性） */
  bookingsTruncated: boolean;
};

/** 全アクティブ拠点の稼働状況を集計する（cronの日次レポートと管理画面の両方から使う） */
export async function collectOccupancyData(now: Date = new Date()): Promise<OccupancyReportData> {
  const db = getDb();
  const today = todayJst(now);
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const pastStart = addDaysJst(today, -7 * PAST_WEEKS);
  const nextEnd = addDaysJst(today, 7);
  // 年初と過去4週の早いほうから来週末までの予約をまとめて1クエリで取る
  const lowerDate = yearStart < pastStart ? yearStart : pastStart;

  const { data: venueRows, error: venueErr } = await db
    .from("venues")
    .select("*")
    .eq("active", true)
    .order("name");
  if (venueErr) throw new Error(`拠点取得エラー: ${venueErr.message}`);
  const venues = (venueRows ?? []) as Venue[];

  // PostgREST（Supabase）はサーバー側Max Rows（既定1000行）で1回のレスポンスを
  // 黙って切り詰めるため、大きなlimit指定は当てにならない。.range()でページングして全件取る。
  const PAGE = 1000;
  const MAX_PAGES = 50; // 安全弁: 想定外の件数でcronがタイムアウトしないように打ち切る
  const venueIds = venues.map((v) => v.id);
  const bookingRows: { venue_id: string; start_at: string; end_at: string }[] = [];
  let bookingsTruncated = false;
  for (let page = 0; venueIds.length > 0; page++) {
    if (page >= MAX_PAGES) {
      // 打ち切った場合は数値が過少になるため、黙って集計せずレポートに警告を出す
      bookingsTruncated = true;
      console.error(`[occupancy] 予約件数が${PAGE * MAX_PAGES}件を超過。集計が不完全な可能性`);
      break;
    }
    const from = page * PAGE;
    const { data, error } = await db
      .from("bookings")
      .select("venue_id, start_at, end_at")
      .eq("booking_status", "confirmed")
      .in("venue_id", venueIds)
      .lt("start_at", jstToUtc(nextEnd, 0).toISOString())
      .gt("end_at", jstToUtc(lowerDate, 0).toISOString())
      .order("start_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`予約取得エラー: ${error.message}`);
    bookingRows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const ownByVenue = new Map<string, TimeRange[]>();
  for (const b of bookingRows) {
    const list = ownByVenue.get(b.venue_id) ?? [];
    list.push({ start: new Date(b.start_at), end: new Date(b.end_at) });
    ownByVenue.set(b.venue_id, list);
  }

  const results = await Promise.all(
    venues.map(async (venue): Promise<VenueOccupancy> => {
      const own = ownByVenue.get(venue.id) ?? [];

      // 週次比較にはGoogleカレンダー（外部サイト予約・手動ブロック）も含める。
      // 取得失敗時はレポートを止めず、自社予約のみで集計して注記する。
      let calendarBusy: TimeRange[] = [];
      let calendarOk = true;
      try {
        calendarBusy = await getBusyRanges(
          venue.calendar_id,
          jstToUtc(pastStart, 0),
          jstToUtc(nextEnd, 0)
        );
      } catch (e) {
        console.error(`[occupancy] FreeBusy取得失敗（${venue.slug}）: 自社予約のみで集計`, e);
        calendarOk = false;
      }
      const combined = mergeRanges([...own, ...calendarBusy]);

      const pastWeeksHours: number[] = [];
      for (let k = PAST_WEEKS; k >= 1; k--) {
        pastWeeksHours.push(
          occupancyForDates(venue, combined, addDaysJst(today, -7 * k), 7).busyHours
        );
      }
      const avgWeekHours = pastWeeksHours.reduce((s, h) => s + h, 0) / PAST_WEEKS;
      const lastWeek = occupancyForDates(venue, combined, addDaysJst(today, -7), 7);
      const nextWeek = occupancyForDates(venue, combined, today, 7);
      const nextDays = dailyOccupancy(venue, combined, today, 7);

      const recentDays: VenueOccupancy["recentDays"] = [];
      for (let k = 1; k <= SNAPSHOT_BACKFILL_DAYS; k++) {
        const date = addDaysJst(today, -k);
        recentDays.push({
          date,
          own: occupancyForDates(venue, own, date, 1),
          combined: occupancyForDates(venue, combined, date, 1),
        });
      }

      const yearOwn = occupancyForDates(venue, own, yearStart, daysBetweenJst(yearStart, today));
      const monthStart = `${today.slice(0, 7)}-01`;
      const monthOwn = occupancyForDates(venue, own, monthStart, daysBetweenJst(monthStart, today));

      const year = Number(today.slice(0, 4));
      const currentMonth = Number(today.slice(5, 7));
      const monthlyOwn: { month: string; summary: OccupancySummary }[] = [];
      for (let m = 1; m <= currentMonth; m++) {
        const start = `${year}-${String(m).padStart(2, "0")}-01`;
        const nextMonthStart =
          m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
        // 進行中の月は昨日までの実績で計算する
        const endExclusive = nextMonthStart < today ? nextMonthStart : today;
        monthlyOwn.push({
          month: `${m}月`,
          summary: occupancyForDates(venue, own, start, daysBetweenJst(start, endExclusive)),
        });
      }

      return {
        id: venue.id,
        slug: venue.slug,
        name: venue.name,
        openHour: venue.open_hour,
        closeHour: venue.close_hour,
        calendarOk,
        recentDays,
        lastWeek,
        pastWeeksHours,
        avgWeekHours,
        nextWeek,
        nextDays,
        yearOwn,
        monthOwn,
        monthlyOwn,
        alert: judgeAlert(nextWeek.busyHours, avgWeekHours),
      };
    })
  );

  return { today, venues: results, bookingsTruncated };
}

const DOW = ["日", "月", "火", "水", "木", "金", "土"];
const LEVEL_EMOJI: Record<AlertLevel, string> = { low: "🔴", normal: "⚪", high: "🟢" };
/** 対応が必要なもの→良い知らせ→平常の順で並べる */
const LEVEL_ORDER: AlertLevel[] = ["low", "high", "normal"];

function fmtH(h: number): string {
  return `${h.toFixed(1)}h`;
}

function fmtPct(s: OccupancySummary): string {
  return s.capacityHours > 0 ? `${(s.rate * 100).toFixed(1)}%` : "—";
}

function dateLabel(date: string): string {
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}(${DOW[jstDayOfWeek(date)]})`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const LEVEL_COLOR: Record<AlertLevel, { bg: string; border: string; text: string }> = {
  low: { bg: "#fef2f2", border: "#ef4444", text: "#b91c1c" },
  high: { bg: "#f0fdf4", border: "#22c55e", text: "#15803d" },
  normal: { bg: "#f9fafb", border: "#d1d5db", text: "#4b5563" },
};

/**
 * テーブル行の高さだけで縦棒を表現するミニバー（position:absoluteを使わない）。
 * GmailアプリやOutlook等、position:absoluteの挙動が不安定なメールクライアントでも崩れないようにするため。
 */
function miniBar(pct: number, barH: number, color: string): string {
  const filled = Math.max(0, Math.min(barH, Math.round((pct / 100) * barH)));
  const empty = barH - filled;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;width:22px;border-bottom:1px solid #e5e7eb;">
    ${empty > 0 ? `<tr><td style="height:${empty}px;line-height:1px;font-size:0;">&nbsp;</td></tr>` : ""}
    ${filled > 0 ? `<tr><td style="height:${filled}px;background:${color};border-radius:2px 2px 0 0;line-height:1px;font-size:0;">&nbsp;</td></tr>` : ""}
  </table>`;
}

/** 日次レポートのHTMLメール本文を組み立てる（テーブルベース＋インラインCSSでGmail等の崩れを防ぐ） */
function formatOccupancyReportHtml(data: OccupancyReportData): string {
  const alertRows = LEVEL_ORDER.flatMap((level) =>
    data.venues
      .filter((v) => v.alert.level === level)
      .map((v) => {
        const c = LEVEL_COLOR[level];
        const calNote = v.calendarOk ? "" : "（⚠️カレンダー未取得・自社予約のみで判定）";
        return `<tr><td style="padding:8px 12px;border-left:4px solid ${c.border};background:${c.bg};border-radius:4px;font-size:14px;line-height:1.6;color:#111827;">
          <span style="font-weight:700;color:${c.text};">${LEVEL_EMOJI[level]} ${escapeHtml(v.name)}${calNote}</span><br>
          ${escapeHtml(v.alert.message)}
        </td></tr><tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>`;
      })
  ).join("");

  const venueSections = data.venues
    .map((v) => {
      // 日別バーは営業時間に対する稼働率で表示（週の最大値を分母にすると日別の埋まり具合が実際より低く見えてしまうため）
      const barCells = v.nextDays
        .map((d) => {
          const pct = Math.min(100, Math.round(d.rate * 100));
          return `<td style="text-align:center;padding:4px 2px;font-size:11px;color:#6b7280;">
            ${miniBar(pct, 40, "#3b82f6")}
            <div style="margin-top:4px;">${dateLabel(d.date)}</div>
            <div style="font-weight:600;color:#111827;">${d.busyHours > 0 ? fmtH(d.busyHours) : "0"}</div>
          </td>`;
        })
        .join("");

      // 週別バーは過去4週どうしの相対比較なので、来週の値は分母に含めない
      const maxTrendWeekHours = Math.max(1, ...v.pastWeeksHours);
      const trendBars = v.pastWeeksHours
        .map((h) => {
          const pct = Math.min(100, Math.round((h / maxTrendWeekHours) * 100));
          return `<td style="text-align:center;padding:0 4px;">
            ${miniBar(pct, 28, "#9ca3af")}
            <div style="font-size:11px;color:#6b7280;margin-top:2px;">${fmtH(h)}</div>
          </td>`;
        })
        .join("");

      return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;">
        <tr><td style="padding:14px 16px 4px;">
          <div style="font-size:15px;font-weight:700;color:#111827;">
            ● ${escapeHtml(v.name)}<span style="font-weight:400;color:#6b7280;font-size:12px;"> （営業 ${v.openHour}:00〜${v.closeHour}:00）${v.calendarOk ? "" : " ⚠️カレンダー取得失敗・自社予約のみで集計"}</span>
          </div>
        </td></tr>
        <tr><td style="padding:6px 16px 0;font-size:13px;color:#374151;">
          直近1週の埋まり: <b>${fmtH(v.lastWeek.busyHours)}</b> / ${fmtH(v.lastWeek.capacityHours)}（${fmtPct(v.lastWeek)}）
        </td></tr>
        <tr><td style="padding:10px 16px 0;font-size:12px;color:#6b7280;">週別推移（過去4週、平均 ${fmtH(v.avgWeekHours)}/週）</td></tr>
        <tr><td style="padding:4px 16px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${trendBars}</tr></table>
        </td></tr>
        <tr><td style="padding:10px 16px 0;font-size:13px;color:#374151;">
          来週の予約: <b>${fmtH(v.nextWeek.busyHours)}</b>（埋まり率 ${fmtPct(v.nextWeek)}）
        </td></tr>
        <tr><td style="padding:4px 16px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${barCells}</tr></table>
        </td></tr>
        <tr><td style="padding:10px 16px 14px;font-size:12px;color:#6b7280;border-top:1px solid #f3f4f6;margin-top:10px;">
          ${data.today.slice(0, 4)}年の稼働率（自社確定・昨日まで）: <b>${fmtPct(v.yearOwn)}</b>　今月: <b>${fmtPct(v.monthOwn)}</b>
        </td></tr>
      </table>`;
    })
    .join("");

  return `
<div style="font-family:'Hiragino Kaku Gothic ProN','Hiragino Sans',Meiryo,sans-serif;background:#f3f4f6;padding:24px 0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">
      <tr><td style="background:#1f2937;padding:20px 24px;">
        <div style="color:#ffffff;font-size:18px;font-weight:700;">📊 稼働レポート</div>
        <div style="color:#d1d5db;font-size:13px;margin-top:2px;">${data.today} 時点（「来週」= 今日からの7日間）</div>
      </td></tr>
      <tr><td style="padding:20px 24px 4px;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:8px;">■ アラート（来週の予約 vs 過去4週平均）</div>
        ${
          data.bookingsTruncated
            ? `<div style="background:#fef3c7;color:#92400e;padding:8px 12px;border-radius:4px;font-size:13px;margin-bottom:8px;">⚠️ 予約データが取得上限に達したため、数値が実際より少なく出ている可能性があります</div>`
            : ""
        }
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${alertRows}</table>
      </td></tr>
      <tr><td style="padding:12px 24px 0;">
        <div style="font-size:14px;font-weight:700;color:#111827;margin-bottom:12px;">■ 拠点別の詳細</div>
        ${venueSections}
      </td></tr>
      <tr><td style="padding:0 24px 20px;">
        <div style="font-size:11px;color:#9ca3af;line-height:1.6;border-top:1px solid #f3f4f6;padding-top:12px;">
          埋まり時間 = 自社確定予約 + Googleカレンダーのbusy（外部サイト予約・手動ブロック）の重複なし合算<br>
          年間・月別の稼働率は自社の確定予約のみ（外部サイト予約は含まない）
        </div>
        <div style="text-align:center;margin-top:16px;">
          <a href="${siteUrl()}/admin/occupancy" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;padding:10px 20px;border-radius:6px;">稼働率ダッシュボードを見る</a>
        </div>
      </td></tr>
    </table>
  </td></tr></table>
</div>`;
}

/** 日次レポートのメール本文を組み立てる（Discordは先頭1990文字に切られるためアラートを先頭に置く） */
export function formatOccupancyReport(data: OccupancyReportData): {
  subject: string;
  text: string;
  html: string;
} {
  const counts: Record<AlertLevel, number> = { low: 0, normal: 0, high: 0 };
  for (const v of data.venues) counts[v.alert.level]++;
  const subject = `📊 稼働レポート ${data.today}（🔴${counts.low} 🟢${counts.high} ⚪${counts.normal}）`;

  const lines: string[] = [];
  lines.push(`${data.today} 時点の稼働状況レポートです（「来週」= 今日からの7日間）。`);
  lines.push("");
  lines.push("■ アラート（来週の予約 vs 過去4週平均）");
  if (data.bookingsTruncated) {
    lines.push("⚠️ 予約データが取得上限に達したため、数値が実際より少なく出ている可能性があります");
  }
  for (const level of LEVEL_ORDER) {
    for (const v of data.venues.filter((x) => x.alert.level === level)) {
      // Discordは先頭1990文字で切られるため、カレンダー欠損の注記はアラート行自体に載せる
      const calNote = v.calendarOk ? "" : "（⚠️カレンダー未取得・自社予約のみで判定）";
      lines.push(`${LEVEL_EMOJI[level]} ${v.name}${calNote}: ${v.alert.message}`);
    }
  }
  lines.push("");
  lines.push("■ 拠点別の詳細（埋まり時間には外部サイト予約・手動ブロックを含む）");
  for (const v of data.venues) {
    lines.push("");
    lines.push(
      `● ${v.name}（営業 ${v.openHour}:00〜${v.closeHour}:00）` +
        (v.calendarOk ? "" : " ⚠️カレンダー取得失敗・自社予約のみで集計")
    );
    lines.push(
      `  直近1週の埋まり: ${fmtH(v.lastWeek.busyHours)} / ${fmtH(v.lastWeek.capacityHours)}（${fmtPct(v.lastWeek)}）`
    );
    lines.push(
      `  週別推移（古→新）: ${v.pastWeeksHours.map(fmtH).join(" → ")}（平均 ${fmtH(v.avgWeekHours)}/週）`
    );
    lines.push(`  来週の予約: ${fmtH(v.nextWeek.busyHours)}（埋まり率 ${fmtPct(v.nextWeek)}）`);
    lines.push(
      `    ${v.nextDays.map((d) => `${dateLabel(d.date)}${d.busyHours > 0 ? fmtH(d.busyHours) : "0"}`).join(" ")}`
    );
    lines.push(
      `  ${data.today.slice(0, 4)}年の稼働率（自社確定・昨日まで）: ${fmtPct(v.yearOwn)}　今月: ${fmtPct(v.monthOwn)}`
    );
  }
  lines.push("");
  lines.push("■ 見方");
  lines.push(
    "- 埋まり時間 = 自社確定予約 + Googleカレンダーのbusy（外部サイト予約・手動ブロック）の重複なし合算"
  );
  lines.push("- 年間・月別の稼働率は自社の確定予約のみ（外部サイト予約は含まない）");
  lines.push("");
  lines.push("▼ 稼働率ダッシュボード");
  lines.push(`${siteUrl()}/admin/occupancy`);
  return { subject, text: lines.join("\n"), html: formatOccupancyReportHtml(data) };
}

export type DailySnapshot = {
  venueId: string;
  date: string;
  ownBusyHours: number;
  /** カレンダー取得に失敗した日はnull（外部予約分を含まない不完全な値を「正常値」として保存しないため） */
  combinedBusyHours: number | null;
  capacityHours: number;
};

/**
 * 拠点別の集計データからDBスナップショット用のフラットな配列を組み立てる。
 * 予約取得が打ち切られた回はown側の数値も信用できないため空にする。
 * カレンダー取得に失敗した拠点はcombinedBusyHoursをnullにする（外部予約分を含まない不完全な値を「正常値」として保存しないため）。
 */
export function buildSnapshots(data: OccupancyReportData): DailySnapshot[] {
  if (data.bookingsTruncated) return [];
  return data.venues.flatMap((v) =>
    v.recentDays.map((d) => ({
      venueId: v.id,
      date: d.date,
      ownBusyHours: d.own.busyHours,
      combinedBusyHours: v.calendarOk ? d.combined.busyHours : null,
      capacityHours: d.own.capacityHours,
    }))
  );
}

/** cron用: 集計→本文生成までをまとめて実行する */
export async function buildOccupancyReport(now: Date = new Date()): Promise<{
  subject: string;
  text: string;
  html: string;
  alerts: Record<string, AlertLevel>;
  calendarErrors: string[];
  /** 直近数日分の拠点別スナップショット（DB蓄積用） */
  snapshots: DailySnapshot[];
}> {
  const data = await collectOccupancyData(now);
  const { subject, text, html } = formatOccupancyReport(data);
  return {
    subject,
    text,
    html,
    alerts: Object.fromEntries(data.venues.map((v) => [v.slug, v.alert.level])),
    calendarErrors: data.venues.filter((v) => !v.calendarOk).map((v) => v.slug),
    snapshots: buildSnapshots(data),
  };
}
