import type { DaySlots, SlotStatus, TimeRange, Venue } from "./types";

/**
 * 時刻まわりの方針:
 * - DB・APIはすべてUTCのDate/ISO文字列で扱う
 * - 画面・スロット計算は日本時間（JST, UTC+9固定。日本にサマータイムはないため固定オフセットで安全）
 */

export const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** スロット1コマの長さ（分） */
export const SLOT_MINUTES = 30;

/** 予約受付の締切: 開始時刻の何分前まで予約できるか（直前予約を最大限受け付ける） */
export const LEAD_TIME_MINUTES = 1;

/** 何日先まで予約できるか */
export const MAX_ADVANCE_DAYS = 60;

/** 仮押さえ（pending）の保持時間（分）。Stripe Checkoutの最短期限30分に合わせる */
export const PENDING_HOLD_MINUTES = 30;

/**
 * 仮押さえ失効後の猶予（分）。決済完了Webhookが遅延して届くケースに備え、
 * 失効直後はまだ枠を解放しない（DB関数側の interval '10 minutes' と一致させること）
 */
export const PENDING_GRACE_MINUTES = 10;

/** JSTの 'YYYY-MM-DD' と時(小数可: 9.5 = 9:30) → UTCのDate */
export function jstToUtc(dateStr: string, hour: number): Date {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return new Date(`${dateStr}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00+09:00`);
}

/** UTCのDate → JSTの 'YYYY-MM-DD' */
export function utcToJstDateStr(d: Date): string {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return j.toISOString().slice(0, 10);
}

/** JST基準の曜日（0=日） */
export function jstDayOfWeek(dateStr: string): number {
  const jstMidnight = new Date(`${dateStr}T00:00:00+09:00`);
  return new Date(jstMidnight.getTime() + JST_OFFSET_MS).getUTCDay();
}

/** JSTで n 日後の 'YYYY-MM-DD' */
export function addDaysJst(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToJstDateStr(d);
}

/** 2つの時間帯が重なるか（[start, end) 同士） */
export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** 日付文字列のバリデーション */
export function isValidDateStr(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00+09:00`);
  return !Number.isNaN(d.getTime()) && utcToJstDateStr(d) === s;
}

/** 時刻（小数時）を "HH:MM" 形式に変換 */
export function hourToTimeStr(hour: number): string {
  const h = Math.floor(hour);
  const m = Math.round((hour - h) * 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * 1スロット（30分）の状態を判定する。
 * busy には「Googleカレンダーの埋まり」と「自社のpending/confirmed予約」を合成して渡す。
 */
export function slotStatus(
  dateStr: string,
  hour: number,
  busy: TimeRange[],
  now: Date
): SlotStatus {
  const start = jstToUtc(dateStr, hour);
  const end = new Date(start.getTime() + SLOT_MINUTES * 60 * 1000);

  // 受付締切（開始LEAD_TIME_MINUTES分前）を過ぎている
  const deadline = new Date(start.getTime() - LEAD_TIME_MINUTES * 60 * 1000);
  if (now > deadline) return "closed";

  // 受付可能期間（60日先）を超えている
  const maxDate = addDaysJst(utcToJstDateStr(now), MAX_ADVANCE_DAYS);
  if (dateStr > maxDate) return "closed";

  if (busy.some((b) => overlaps({ start, end }, b))) return "booked";
  return "available";
}

/**
 * 拠点の「指定日からN日分」のスロットグリッドを作る（30分刻み）。
 * calendarError=true のときは全枠closed（fail closed）。
 */
export function buildDays(
  venue: Pick<Venue, "open_hour" | "close_hour">,
  fromDate: string,
  numDays: number,
  busy: TimeRange[],
  now: Date,
  calendarError = false,
  dayMeta?: (date: string) => { dayType: "weekday" | "holiday"; pricePerHour: number; holidayName?: string }
): DaySlots[] {
  const days: DaySlots[] = [];
  const slotsPerHour = 60 / SLOT_MINUTES; // 2
  for (let i = 0; i < numDays; i++) {
    const date = addDaysJst(fromDate, i);
    const slots: { hour: number; status: SlotStatus }[] = [];
    for (let h = venue.open_hour; h < venue.close_hour; h += 1 / slotsPerHour) {
      // 浮動小数点の丸め
      const roundedH = Math.round(h * 10) / 10;
      slots.push({
        hour: roundedH,
        status: calendarError ? "closed" : slotStatus(date, roundedH, busy, now),
      });
    }
    const meta = dayMeta?.(date) ?? { dayType: "weekday" as const, pricePerHour: 0 };
    days.push({ date, dayOfWeek: jstDayOfWeek(date), ...meta, slots });
  }
  return days;
}

/**
 * 予約リクエスト（日付・開始時刻・利用時間数）を検証する。
 * startHour: 小数可（9.5 = 9:30）
 * hours: 小数可（0.5刻み）
 * 戻り値: エラーメッセージ（問題なければ null）
 */
export function validateBookingRequest(
  venue: Pick<Venue, "open_hour" | "close_hour" | "min_hours" | "max_hours">,
  dateStr: string,
  startHour: number,
  hours: number,
  now: Date
): string | null {
  if (!isValidDateStr(dateStr)) return "日付の形式が正しくありません";
  // startHour は 0.5刻み、hours も 0.5刻みであること
  if (!isValidSlotTime(startHour) || !isValidSlotTime(hours)) {
    return "時刻の形式が正しくありません";
  }
  if (hours < venue.min_hours) return `最低利用時間は${formatDuration(venue.min_hours)}です`;
  if (hours > venue.max_hours) return `最大連続利用時間は${formatDuration(venue.max_hours)}です`;
  if (startHour < venue.open_hour || startHour + hours > venue.close_hour) {
    return "営業時間外の時間帯が含まれています";
  }
  const start = jstToUtc(dateStr, startHour);
  const deadline = new Date(start.getTime() - LEAD_TIME_MINUTES * 60 * 1000);
  if (now > deadline) return "この時間帯は受付を締め切りました";
  const maxDate = addDaysJst(utcToJstDateStr(now), MAX_ADVANCE_DAYS);
  if (dateStr > maxDate) return `予約は${MAX_ADVANCE_DAYS}日先まで受け付けています`;
  return null;
}

/** 0.5刻みの有効な時刻値かチェック */
function isValidSlotTime(v: number): boolean {
  return typeof v === "number" && isFinite(v) && v >= 0 && (v * 2) % 1 === 0;
}

/** 時間数を表示用文字列に変換 */
export function formatDuration(hours: number): string {
  if (hours % 1 === 0) return `${hours}時間`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}分`;
  return `${h}時間${m}分`;
}

/** JSTの「今日」の日付文字列 */
export function todayJst(now: Date = new Date()): string {
  return utcToJstDateStr(now);
}
