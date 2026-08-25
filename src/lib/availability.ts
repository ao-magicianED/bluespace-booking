import { getDb } from "./supabase";
import { getBusyRanges } from "./google-calendar";
import { addDaysJst, buildDays, jstToUtc, jstDayOfWeek, PENDING_GRACE_MINUTES } from "./slots";
import { resolveDayPricing } from "./price-bands";
import { QuoteError } from "./quote";
import { minBandPrice, type PriceTier } from "./pricing";
import type { AvailabilityResponse, TimeRange, Venue } from "./types";

export async function getVenueBySlug(slug: string): Promise<Venue | null> {
  const db = getDb();
  const { data, error } = await db
    .from("venues")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`拠点取得エラー: ${error.message}`);
  return (data as Venue) ?? null;
}

/**
 * 指定拠点・指定日からN日分の空き状況を計算する。
 * - 自社DBの予約（confirmed＋期限内pending）
 * - Googleカレンダーのbusy（他サイト予約・手動ブロック）
 * を合成。FreeBusy失敗時は calendarError=true で全枠closed（fail closed）。
 *
 * tier は resolveTier()（署名Cookie＋DB照合）で解決した値のみを渡すこと。
 * 帯あり拠点は days[].pricePerHour が「その日の最低帯価格」になり、pricing に帯表がつく。
 * 帯なし拠点は従来と同一のレスポンス。
 */
export async function getAvailability(
  venue: Venue,
  fromDate: string,
  numDays = 7,
  tier: PriceTier = "standard"
): Promise<AvailabilityResponse> {
  const db = getDb();
  const now = new Date();

  // 適用料金の解決（帯の穴・DB読取失敗はここでQuoteError(503)＝表示ごと停止。
  // 誤った安値を表示したまま予約導線を出さないため）
  const dayPricing = await resolveDayPricing(venue, tier);
  const hasBands =
    dayPricing.weekday.source === "bands" || dayPricing.holiday.source === "bands";
  const rangeStart = jstToUtc(fromDate, 0);
  const rangeEnd = jstToUtc(addDaysJst(fromDate, numDays), 0);

  // 自社予約を取得（期限切れpendingは除外。掃除はDB関数とCronが担当）
  const { data: bookings, error } = await db
    .from("bookings")
    .select("start_at, end_at, booking_status, expires_at")
    .eq("venue_id", venue.id)
    .in("booking_status", ["pending", "confirmed"])
    .lt("start_at", rangeEnd.toISOString())
    .gt("end_at", rangeStart.toISOString());
  if (error) throw new Error(`予約取得エラー: ${error.message}`);

  // pendingは「失効＋猶予10分」を過ぎるまで埋まり扱い（Webhook遅延との競合防止）
  const graceMs = PENDING_GRACE_MINUTES * 60 * 1000;
  const dbBusy: TimeRange[] = (bookings ?? [])
    .filter(
      (b) =>
        b.booking_status === "confirmed" ||
        !b.expires_at ||
        new Date(b.expires_at).getTime() + graceMs >= now.getTime()
    )
    .map((b) => ({ start: new Date(b.start_at), end: new Date(b.end_at) }));

  // Googleカレンダーのbusy（失敗したらfail closed）
  let calendarBusy: TimeRange[] = [];
  let calendarError = false;
  try {
    calendarBusy = await getBusyRanges(venue.calendar_id, rangeStart, rangeEnd);
  } catch (e) {
    console.error("[availability] FreeBusy取得失敗（fail closed）:", e);
    calendarError = true;
  }

  // 祝日（jp_holidays）を取得して日ごとの料金種別を決める。
  // 読取失敗のまま平日価格を表示すると、見積（strict判定で503停止）と食い違う
  // 安値表示になるため、空き状況の表示ごと停止する（fail-expensive）
  const dateList: string[] = [];
  for (let i = 0; i < numDays; i++) dateList.push(addDaysJst(fromDate, i));
  const { data: holidayRows, error: holidayError } = await db
    .from("jp_holidays")
    .select("date, name")
    .in("date", dateList);
  if (holidayError) {
    console.error("[availability] 祝日取得エラー（表示を停止）:", holidayError.message);
    throw new QuoteError("空き状況の取得に失敗しました。時間をおいてお試しください", 503);
  }
  const holidayNames = new Map((holidayRows ?? []).map((r) => [r.date as string, r.name as string]));

  const days = buildDays(
    venue,
    fromDate,
    numDays,
    [...dbBusy, ...calendarBusy],
    now,
    calendarError,
    (date) => {
      const dow = jstDayOfWeek(date);
      const isHoliday = dow === 0 || dow === 6 || holidayNames.has(date);
      const resolved = isHoliday ? dayPricing.holiday : dayPricing.weekday;
      return {
        dayType: isHoliday ? ("holiday" as const) : ("weekday" as const),
        // 帯あり: その日の最低帯価格（表示は「¥X〜」）/ 帯なし: 従来のフラット単価
        pricePerHour:
          resolved.source === "bands"
            ? minBandPrice(resolved.bands)
            : isHoliday && venue.holiday_hourly_price != null
              ? venue.holiday_hourly_price
              : venue.hourly_price,
        ...(holidayNames.has(date) ? { holidayName: holidayNames.get(date) } : {}),
      };
    }
  );

  return {
    venue: {
      slug: venue.slug,
      name: venue.name,
      hourlyPrice: venue.hourly_price,
      holidayHourlyPrice: venue.holiday_hourly_price,
      lastMinutePercent: venue.last_minute_percent,
      earlyBirdPercent: venue.early_bird_percent,
      earlyBirdDays: venue.early_bird_days,
      minHours: venue.min_hours,
      maxHours: venue.max_hours,
    },
    days,
    calendarError,
    ...(hasBands
      ? {
          pricing: {
            tier:
              dayPricing.weekday.tierUsed === "repeat" ||
              dayPricing.holiday.tierUsed === "repeat"
                ? ("repeat" as const)
                : ("standard" as const),
            weekday: dayPricing.weekday.bands,
            holiday: dayPricing.holiday.bands,
          },
        }
      : {}),
  };
}
