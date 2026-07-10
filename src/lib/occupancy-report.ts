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

export type VenueOccupancy = {
  slug: string;
  name: string;
  openHour: number;
  closeHour: number;
  /** GoogleカレンダーのFreeBusy取得に成功したか（falseなら自社予約のみで集計） */
  calendarOk: boolean;
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
        slug: venue.slug,
        name: venue.name,
        openHour: venue.open_hour,
        closeHour: venue.close_hour,
        calendarOk,
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

/** 日次レポートのメール本文を組み立てる（Discordは先頭1990文字に切られるためアラートを先頭に置く） */
export function formatOccupancyReport(data: OccupancyReportData): {
  subject: string;
  text: string;
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
  return { subject, text: lines.join("\n") };
}

/** cron用: 集計→本文生成までをまとめて実行する */
export async function buildOccupancyReport(now: Date = new Date()): Promise<{
  subject: string;
  text: string;
  alerts: Record<string, AlertLevel>;
  calendarErrors: string[];
}> {
  const data = await collectOccupancyData(now);
  const { subject, text } = formatOccupancyReport(data);
  return {
    subject,
    text,
    alerts: Object.fromEntries(data.venues.map((v) => [v.slug, v.alert.level])),
    calendarErrors: data.venues.filter((v) => !v.calendarOk).map((v) => v.slug),
  };
}
