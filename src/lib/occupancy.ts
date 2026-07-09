import { addDaysJst, jstToUtc } from "./slots";
import type { TimeRange, Venue } from "./types";

/**
 * 稼働率（どれだけ埋まっているか）計算の純粋ロジック。
 * - 分母（capacity）= 営業時間（venues.open_hour〜close_hour）× 日数
 * - 分子（busy）= 埋まっている時間のうち営業時間内の分
 * busyには「自社予約」と「Googleカレンダーのbusy（自社予約の同期イベントを含む）」が
 * 重複して入りうるため、必ずマージしてから数える（重複カウント防止）。
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** JST日付間の日数差（b - a）。同日なら0 */
export function daysBetweenJst(a: string, b: string): number {
  return Math.round((jstToUtc(b, 0).getTime() - jstToUtc(a, 0).getTime()) / DAY_MS);
}

/** 期間リストの重なり・隣接をマージして時系列順に返す（長さ0以下の期間は捨てる） */
export function mergeRanges(ranges: TimeRange[]): TimeRange[] {
  const sorted = ranges
    .filter((r) => r.end.getTime() > r.start.getTime())
    .slice()
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start.getTime() <= last.end.getTime()) {
      if (r.end.getTime() > last.end.getTime()) last.end = r.end;
    } else {
      merged.push({ start: r.start, end: r.end });
    }
  }
  return merged;
}

/** マージ済み期間と窓 [windowStart, windowEnd) の重なり合計（ミリ秒） */
export function overlapMs(merged: TimeRange[], windowStart: Date, windowEnd: Date): number {
  let total = 0;
  for (const r of merged) {
    const s = Math.max(r.start.getTime(), windowStart.getTime());
    const e = Math.min(r.end.getTime(), windowEnd.getTime());
    if (e > s) total += e - s;
  }
  return total;
}

export type OccupancySummary = {
  /** 埋まっている時間（時間単位） */
  busyHours: number;
  /** 営業時間の総枠（時間単位） */
  capacityHours: number;
  /** 稼働率 0〜1（枠0のときは0） */
  rate: number;
};

export type DayOccupancy = { date: string } & OccupancySummary;

/**
 * JSTのfromDateからnumDays日分、日別の埋まり時間と稼働率を計算する。
 * 営業時間外のbusy（終日ブロック等）は営業時間の窓で切り取って数える。
 */
export function dailyOccupancy(
  venue: Pick<Venue, "open_hour" | "close_hour">,
  busy: TimeRange[],
  fromDate: string,
  numDays: number
): DayOccupancy[] {
  const merged = mergeRanges(busy);
  const capacityHours = Math.max(0, venue.close_hour - venue.open_hour);
  const days: DayOccupancy[] = [];
  for (let i = 0; i < numDays; i++) {
    const date = addDaysJst(fromDate, i);
    // close_hour=24 は "24:00" のDate解析に依存せず、JST 0時からのオフセットで窓を作る
    const midnight = jstToUtc(date, 0).getTime();
    const windowStart = new Date(midnight + venue.open_hour * HOUR_MS);
    const windowEnd = new Date(midnight + venue.close_hour * HOUR_MS);
    const busyHours = overlapMs(merged, windowStart, windowEnd) / HOUR_MS;
    days.push({
      date,
      busyHours,
      capacityHours,
      rate: capacityHours > 0 ? busyHours / capacityHours : 0,
    });
  }
  return days;
}

/** 期間合計の稼働率（fromDateからnumDays日分） */
export function occupancyForDates(
  venue: Pick<Venue, "open_hour" | "close_hour">,
  busy: TimeRange[],
  fromDate: string,
  numDays: number
): OccupancySummary {
  const days = dailyOccupancy(venue, busy, fromDate, numDays);
  const busyHours = days.reduce((s, d) => s + d.busyHours, 0);
  const capacityHours = days.reduce((s, d) => s + d.capacityHours, 0);
  return { busyHours, capacityHours, rate: capacityHours > 0 ? busyHours / capacityHours : 0 };
}

export type AlertLevel = "low" | "normal" | "high";

/** 来週の予約が過去4週平均のこの割合未満なら「低稼働」アラート */
export const LOW_RATIO = 0.5;
/** 来週の予約が過去4週平均のこの割合以上なら「好調」 */
export const HIGH_RATIO = 1.3;

export type OccupancyAlert = {
  level: AlertLevel;
  /** 過去週平均に対する来週の割合（%）。平均0で比率が定義できないときはnull */
  ratioPercent: number | null;
  /** アクション提案つきの短文（拠点名は含まない） */
  message: string;
};

/**
 * 「来週の予約時間」を「過去数週間の週平均」と比べてアラート判定する。
 * - low: 平均の50%未満 → 値下げ・直前割・告知の検討
 * - high: 平均の130%以上 → 静観 or 値上げ検討
 * - normal: その間
 */
export function judgeAlert(nextWeekHours: number, avgWeekHours: number): OccupancyAlert {
  const fmt = (h: number) => h.toFixed(1);
  if (avgWeekHours <= 0) {
    if (nextWeekHours <= 0) {
      return {
        level: "low",
        ratioPercent: null,
        message:
          "過去4週も来週も予約がありません。告知・値下げ・クーポン等の集客施策を検討してください",
      };
    }
    return {
      level: "high",
      ratioPercent: null,
      message: `過去4週は予約ゼロでしたが、来週は${fmt(nextWeekHours)}h入っています。静観でOKです`,
    };
  }
  const ratio = nextWeekHours / avgWeekHours;
  // 表示用%は切り捨て: 四捨五入だと境界付近（例: 49.9%）で「50%なのに低稼働」と
  // 表示と判定が食い違うため、表示バンドを判定バンド（<50% / ≥130%）に一致させる
  const percent = Math.floor(ratio * 100);
  if (ratio < LOW_RATIO) {
    return {
      level: "low",
      ratioPercent: percent,
      message: `来週の予約${fmt(nextWeekHours)}hは過去4週平均${fmt(avgWeekHours)}hの${percent}%と少なめです。1週間限定の値下げ・直前割の強化・告知を検討してください`,
    };
  }
  if (ratio >= HIGH_RATIO) {
    return {
      level: "high",
      ratioPercent: percent,
      message: `来週の予約${fmt(nextWeekHours)}hは過去4週平均${fmt(avgWeekHours)}hの${percent}%と好調です。静観、または値上げの検討余地があります`,
    };
  }
  return {
    level: "normal",
    ratioPercent: percent,
    message: `来週の予約${fmt(nextWeekHours)}hは過去4週平均${fmt(avgWeekHours)}hの${percent}%で平常圏です。静観で問題ありません`,
  };
}
