import { utcToJstDateStr } from "./slots";

/**
 * 価格計算エンジン（フェーズ2-①: v2）
 * すべての価格はこのファイルだけで計算する（表示用も決済用も同じ関数）。
 * 結果はbookings.price_breakdownにスナップショット保存され、
 * 後からルールを変えても過去予約の請求根拠を再現できる。
 */

export type PricingVenue = {
  hourly_price: number;
  holiday_hourly_price: number | null;
  last_minute_percent: number;
  early_bird_percent: number;
  early_bird_days: number;
};

export type SelectedOption = {
  id: string;
  name: string;
  price: number;
  price_unit: "per_booking" | "per_hour";
};

export type CouponInfo = {
  code: string;
  percent_off: number | null;
  amount_off: number | null;
};

export type DayType = "weekday" | "holiday";

export type PriceBreakdown = {
  rule: "v2";
  date: string;
  dayType: DayType;
  pricePerHour: number;
  hours: number;
  baseSubtotal: number;
  discount: { kind: "last_minute" | "early_bird"; percent: number; amount: number } | null;
  options: { id: string; name: string; amount: number }[];
  optionsSubtotal: number;
  coupon: { code: string; amount: number } | null;
  total: number;
};

/** JSTでの「今日から利用日まで何日先か」（同日=0） */
export function leadDays(dateStr: string, now: Date): number {
  const todayJst = utcToJstDateStr(now);
  const a = new Date(`${todayJst}T00:00:00+09:00`).getTime();
  const b = new Date(`${dateStr}T00:00:00+09:00`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * 見積もり計算。
 * - 基本料金: 平日 hourly_price / 土日祝 holiday_hourly_price（未設定なら平日と同額）
 * - 割引: 直前割（当日予約）or 早割（early_bird_days日以上前）。併用なし（両立しない条件）。
 *   割引は基本料金にのみ掛かり、オプションには掛からない。
 * - クーポン: 割引後の基本料金＋オプションの合計に適用（percent or 固定額）。
 */
export function calcQuote(
  venue: PricingVenue,
  dateStr: string,
  startHour: number,
  hours: number,
  isHoliday: boolean,
  now: Date,
  options: SelectedOption[] = [],
  coupon: CouponInfo | null = null
): PriceBreakdown {
  const dayType: DayType = isHoliday ? "holiday" : "weekday";
  const pricePerHour =
    isHoliday && venue.holiday_hourly_price != null
      ? venue.holiday_hourly_price
      : venue.hourly_price;
  const baseSubtotal = pricePerHour * hours;

  // 割引（直前割 or 早割）
  const lead = leadDays(dateStr, now);
  let discount: PriceBreakdown["discount"] = null;
  if (lead === 0 && venue.last_minute_percent > 0) {
    discount = {
      kind: "last_minute",
      percent: venue.last_minute_percent,
      amount: Math.floor((baseSubtotal * venue.last_minute_percent) / 100),
    };
  } else if (lead >= venue.early_bird_days && venue.early_bird_percent > 0) {
    discount = {
      kind: "early_bird",
      percent: venue.early_bird_percent,
      amount: Math.floor((baseSubtotal * venue.early_bird_percent) / 100),
    };
  }

  // オプション
  const optionItems = options.map((o) => ({
    id: o.id,
    name: o.name,
    amount: o.price_unit === "per_hour" ? o.price * hours : o.price,
  }));
  const optionsSubtotal = optionItems.reduce((s, o) => s + o.amount, 0);

  const beforeCoupon = baseSubtotal - (discount?.amount ?? 0) + optionsSubtotal;

  // クーポン
  let couponApplied: PriceBreakdown["coupon"] = null;
  if (coupon) {
    let amount = 0;
    if (coupon.percent_off != null) {
      amount = Math.floor((beforeCoupon * coupon.percent_off) / 100);
    } else if (coupon.amount_off != null) {
      amount = Math.min(coupon.amount_off, beforeCoupon);
    }
    couponApplied = { code: coupon.code, amount };
  }

  const total = Math.max(0, beforeCoupon - (couponApplied?.amount ?? 0));

  return {
    rule: "v2",
    date: dateStr,
    dayType,
    pricePerHour,
    hours,
    baseSubtotal,
    discount,
    options: optionItems,
    optionsSubtotal,
    coupon: couponApplied,
    total,
  };
}
