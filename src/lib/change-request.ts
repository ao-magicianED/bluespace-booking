import { getDb } from "./supabase";
import { getBusyRanges } from "./google-calendar";
import { calcRefund } from "./cancellation";
import { effectiveTotal } from "./adjustment";
import { PENDING_GRACE_MINUTES, utcToJstDateStr } from "./slots";
import { getHolidaySet, isHolidayDate } from "./holidays";
import type { DayType } from "./pricing";
import type { Booking, Venue } from "./types";

/** お客様セルフ変更のカットオフ（利用開始の何時間前まで） */
export const SELF_CHANGE_CUTOFF_HOURS = 2;

/** 申請の有効期限（pending）— 何時間放置で expired にするか */
export const CHANGE_REQUEST_EXPIRY_HOURS = 72;

/** 延長決済の Stripe Checkout 期限（秒） */
export const EXTEND_CHECKOUT_EXPIRY_SECONDS = 24 * 60 * 60;

export type ChangeKind = "extend" | "shorten" | "shift";

/** 変更内容の分類: 終了時刻だけ後ろにずれる=延長 / 開始時刻が動く=ずらし / 終了が前=短縮 */
export function classifyChange(
  previous: { start: Date; end: Date },
  next: { start: Date; end: Date }
): ChangeKind {
  const sameStart = previous.start.getTime() === next.start.getTime();
  const prevDuration = previous.end.getTime() - previous.start.getTime();
  const nextDuration = next.end.getTime() - next.start.getTime();
  if (sameStart && nextDuration > prevDuration) return "extend";
  if (sameStart && nextDuration < prevDuration) return "shorten";
  return "shift";
}

/**
 * 新しい時間帯が予約可能か（自社DB＋Googleカレンダー、自分自身は除外）。
 * @returns ok=trueなら空き、falseなら理由つき
 */
export async function checkTimeSlotAvailable(
  venueId: string,
  excludeBookingId: string,
  next: { start: Date; end: Date },
  calendarId: string | null
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = getDb();
  const now = new Date();

  // 自社DBの予約（自分自身は除外）
  const { data: bookings, error } = await db
    .from("bookings")
    .select("id, start_at, end_at, booking_status, expires_at")
    .eq("venue_id", venueId)
    .in("booking_status", ["pending", "confirmed"])
    .lt("start_at", next.end.toISOString())
    .gt("end_at", next.start.toISOString());
  if (error) return { ok: false, reason: `予約取得エラー: ${error.message}` };

  const graceMs = PENDING_GRACE_MINUTES * 60 * 1000;
  const conflict = (bookings ?? []).find((b) => {
    if (b.id === excludeBookingId) return false;
    if (b.booking_status === "confirmed") return true;
    if (!b.expires_at) return true;
    return new Date(b.expires_at).getTime() + graceMs >= now.getTime();
  });
  if (conflict) {
    return { ok: false, reason: "その時間帯はすでに他の予約があります" };
  }

  // 他サイト予約や手動ブロック（Googleカレンダー）も確認
  if (calendarId) {
    try {
      const busy = await getBusyRanges(calendarId, next.start, next.end);
      if (busy.length > 0) {
        return { ok: false, reason: "その時間帯はカレンダーで埋まっています" };
      }
    } catch (e) {
      return { ok: false, reason: `カレンダー確認失敗: ${String(e)}` };
    }
  }

  return { ok: true };
}

/**
 * 時間範囲を venue の営業時間内・最小/最大時間に収まるよう検証。
 */
export function validateTimeRange(
  venue: Venue,
  start: Date,
  end: Date
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return { ok: false, reason: "時刻が不正です" };
  }
  if (start >= end) return { ok: false, reason: "終了時刻は開始時刻より後にしてください" };

  // JST基準で営業時間内かをチェック
  const jstStart = new Date(start.getTime() + 9 * 60 * 60 * 1000);
  const jstEnd = new Date(end.getTime() + 9 * 60 * 60 * 1000);
  const startHour = jstStart.getUTCHours() + jstStart.getUTCMinutes() / 60;
  // 終了は終端の hour として扱う（例: 22:00終了 = 22）
  const endHourRaw = jstEnd.getUTCHours() + jstEnd.getUTCMinutes() / 60;
  // 同日終端 0:00 は close_hour 24扱いにしたいので、日付が変わったときの補正は省略（同日内利用前提）
  const endHour = endHourRaw === 0 ? 24 : endHourRaw;

  if (startHour < venue.open_hour) {
    return { ok: false, reason: `開始時刻は${venue.open_hour}時以降にしてください` };
  }
  if (endHour > venue.close_hour) {
    return { ok: false, reason: `終了時刻は${venue.close_hour}時までにしてください` };
  }

  const durationMs = end.getTime() - start.getTime();
  const hours = durationMs / (60 * 60 * 1000);
  if (hours < venue.min_hours) {
    return { ok: false, reason: `最低${venue.min_hours}時間からのご利用です` };
  }
  if (hours > venue.max_hours) {
    return { ok: false, reason: `最大${venue.max_hours}時間までのご利用です` };
  }
  // 30分刻みチェック
  if (Math.round(hours * 2) !== hours * 2) {
    return { ok: false, reason: "30分単位でご指定ください" };
  }

  return { ok: true };
}

export type ChangeDayTypes = { previous: DayType; next: DayType };

/**
 * 変更前後それぞれの日付の dayType（平日/土日祝）を解決する。
 * - 変更前はスナップショット（price_breakdown.dayType）を最優先する。祝日テーブルが後から
 *   変わっても「実際に請求した単価区分」と食い違わないようにするため。
 * - 祝日テーブルはgetHolidaySetのfail-open方針（DB障害時は土日のみ判定）を踏襲する。
 */
export async function resolveChangeDayTypes(
  booking: Booking,
  nextStart: Date
): Promise<ChangeDayTypes> {
  const prevDateStr = utcToJstDateStr(new Date(booking.start_at));
  const nextDateStr = utcToJstDateStr(nextStart);
  const breakdown = (booking.price_breakdown ?? {}) as { dayType?: DayType };
  const snapshotDayType =
    breakdown.dayType === "weekday" || breakdown.dayType === "holiday" ? breakdown.dayType : null;

  // 同一日内の変更（延長・短縮・同日ずらし）は単価区分が変わる余地がない
  if (prevDateStr === nextDateStr) {
    const dayType =
      snapshotDayType ??
      (isHolidayDate(prevDateStr, await getHolidaySet([prevDateStr])) ? "holiday" : "weekday");
    return { previous: dayType, next: dayType };
  }

  const holidaySet = await getHolidaySet(
    snapshotDayType ? [nextDateStr] : [prevDateStr, nextDateStr]
  );
  return {
    previous:
      snapshotDayType ?? (isHolidayDate(prevDateStr, holidaySet) ? "holiday" : "weekday"),
    next: isHolidayDate(nextDateStr, holidaySet) ? "holiday" : "weekday",
  };
}

/**
 * 時間変更の料金差額を計算する。
 * - 単価は予約時のスナップショット（price_breakdown.pricePerHour）を踏襲し、
 *   割引/クーポンは引き継ぐ前提で時間分のみ増減する。
 * - 別日への変更で dayType（平日/土日祝）が変わる場合は、変更後の時間帯に
 *   venue の現行単価（祝日は holiday_hourly_price）を適用して差額を取る。
 * - 時間課金オプション（per_hour）はスナップショットの unitPrice を使って時間差分を
 *   増減に含める。unitPrice が無い旧スナップショットは従来通り基本単価のみ（後方互換）。
 * - キャンセル料相当区間（cancel_fee_basis_atで判定）に入っている短縮/減額は、料金を据え置く。
 */
export function calcChangeAmounts(
  booking: Booking,
  venue: Venue,
  previous: { start: Date; end: Date },
  next: { start: Date; end: Date },
  cancelFeeBasisAt: Date,
  dayTypes: ChangeDayTypes
): {
  newAmount: number;
  extraAmount: number;
  refundAmount: number;
  kind: ChangeKind;
  pricePerHour: number;
  nextPricePerHour: number;
  dayTypeChanged: boolean;
} {
  const kind = classifyChange(previous, next);
  const breakdown = (booking.price_breakdown ?? {}) as {
    pricePerHour?: number;
    options?: { unitPrice?: number; priceUnit?: string }[];
  };
  const venuePriceFor = (dayType: DayType): number =>
    dayType === "holiday" && venue.holiday_hourly_price != null
      ? venue.holiday_hourly_price
      : venue.hourly_price;
  // 単価フォールバック: 価格スナップショットがなければ venue の現行単価
  const pricePerHour = typeof breakdown.pricePerHour === "number"
    ? breakdown.pricePerHour
    : venuePriceFor(dayTypes.previous);
  // dayTypeが変わらない限りスナップショット単価を維持（venueの値上げ/値下げは既存予約に波及させない）
  const dayTypeChanged = dayTypes.next !== dayTypes.previous;
  const nextPricePerHour = dayTypeChanged ? venuePriceFor(dayTypes.next) : pricePerHour;

  // 時間課金オプションの時間単価合計（スナップショットにunitPriceがある新形式のみ）
  const perHourOptionsRate = (breakdown.options ?? [])
    .filter((o) => o?.priceUnit === "per_hour" && typeof o?.unitPrice === "number")
    .reduce((sum, o) => sum + (o.unitPrice as number), 0);

  const prevHours = (previous.end.getTime() - previous.start.getTime()) / (60 * 60 * 1000);
  const nextHours = (next.end.getTime() - next.start.getTime()) / (60 * 60 * 1000);
  const currentEffective = effectiveTotal(booking);

  // 変更前後の「時間比例部分」（基本料金＋per_hourオプション）の純差額
  const diffAmount = Math.round(
    (nextPricePerHour + perHourOptionsRate) * nextHours -
      (pricePerHour + perHourOptionsRate) * prevHours
  );

  const base = { kind, pricePerHour, nextPricePerHour, dayTypeChanged };

  if (kind === "extend") {
    const extra = Math.max(0, diffAmount);
    return { newAmount: currentEffective + extra, extraAmount: extra, refundAmount: 0, ...base };
  }
  if (kind === "shorten") {
    // キャンセルポリシー区間に入っているかで返金可否を判定
    const refundable = isWithinFullRefundWindow(venue, booking, cancelFeeBasisAt);
    if (!refundable) {
      // 有料区間: 短縮しても料金据え置き
      return { newAmount: currentEffective, extraAmount: 0, refundAmount: 0, ...base };
    }
    const refund = Math.max(0, -diffAmount);
    return {
      newAmount: Math.max(0, currentEffective - refund),
      extraAmount: 0,
      refundAmount: refund,
      ...base,
    };
  }
  // shift: 時間総量も単価区分も同じなら金額据え置き
  if (diffAmount === 0) {
    return { newAmount: currentEffective, extraAmount: 0, refundAmount: 0, ...base };
  }
  // 時間総量の増減 or dayType変更による単価差は、純差額として扱う
  if (diffAmount > 0) {
    return {
      newAmount: currentEffective + diffAmount,
      extraAmount: diffAmount,
      refundAmount: 0,
      ...base,
    };
  }
  const refundable = isWithinFullRefundWindow(venue, booking, cancelFeeBasisAt);
  if (!refundable) {
    return { newAmount: currentEffective, extraAmount: 0, refundAmount: 0, ...base };
  }
  return {
    newAmount: Math.max(0, currentEffective + diffAmount),
    extraAmount: 0,
    refundAmount: -diffAmount,
    ...base,
  };
}

/**
 * 「キャンセル料0%（全額返金）」の区間内かを判定。
 * 区間内（=無料期間）なら短縮で差額返金OK、区間外（有料期間）なら据え置き。
 */
export function isWithinFullRefundWindow(
  venue: Venue,
  booking: Booking,
  asOf: Date
): boolean {
  const refund = calcRefund(
    effectiveTotal(booking),
    new Date(booking.start_at),
    asOf,
    venue.cancellation_policy ?? null
  );
  return refund.feePercent === 0;
}

/**
 * セルフ変更可否（利用開始2時間前まで・確定予約のみ）。
 */
export function canSelfChange(booking: Booking, now: Date): { ok: true } | { ok: false; reason: string } {
  if (booking.booking_status !== "confirmed") {
    return { ok: false, reason: "確定済みの予約のみ変更できます" };
  }
  if (booking.payment_status === "refunded") {
    return { ok: false, reason: "返金済みの予約は変更できません" };
  }
  const startMs = new Date(booking.start_at).getTime();
  const cutoffMs = startMs - SELF_CHANGE_CUTOFF_HOURS * 60 * 60 * 1000;
  if (now.getTime() > cutoffMs) {
    return {
      ok: false,
      reason: `利用開始の${SELF_CHANGE_CUTOFF_HOURS}時間前を過ぎたため、ご自身では変更できません`,
    };
  }
  return { ok: true };
}
