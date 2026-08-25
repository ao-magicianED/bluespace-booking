import { utcToJstDateStr } from "./slots";

/**
 * 価格計算エンジン（v2: フラット単価 / v3: 時間帯別料金）。
 * すべての価格はこのファイルだけで計算する（表示用も決済用も同じ関数）。
 * 結果はbookings.price_breakdownにスナップショット保存され、
 * 後からルールを変えても過去予約の請求根拠を再現できる。
 *
 * v3（時間帯別料金）は calcQuote に ResolvedPricing を渡したときだけ有効になる。
 * 渡さなければ従来どおり rule:"v2" のフラット計算（後方互換）。
 * このファイルは純粋関数のみ（DB・crypto等に依存しない）。帯のDB解決は price-bands.ts。
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

export type PriceTier = "standard" | "repeat";

/** 時間帯別料金の1帯（整数時境界・startHour <= t < endHour に hourlyPrice を適用） */
export type PriceBand = { startHour: number; endHour: number; hourlyPrice: number };

/** 解決済みの適用料金（price-bands.ts の resolvePricing が作る） */
export type ResolvedPricing = {
  /** 指定dayTypeで実際に適用する帯（0-24完全被覆済み。flatなら単一帯） */
  bands: PriceBand[];
  source: "bands" | "flat";
  /** repeat希望でもrepeat帯が欠落していればstandard（fail-expensive） */
  tierUsed: PriceTier;
  /** 帯セットから導出したバージョン識別子（bands:<hash> / flat:<単価>） */
  priceVersion: string;
};

/** v3の内訳行（予約時間を帯で分割した実際の時刻範囲） */
export type PriceBandLine = {
  label: string;
  startHour: number;
  endHour: number;
  pricePerHour: number;
  hours: number;
  amount: number;
};

export type PriceBreakdown = {
  rule: "v2" | "v3";
  /** v3のみ: どちらの価格ティアで計算したか */
  tier?: PriceTier;
  /** v3のみ: 計算に使った帯セットの識別子 */
  priceVersion?: string;
  /** v3のみ: 帯ごとの内訳（表示用） */
  bandLines?: PriceBandLine[];
  date: string;
  dayType: DayType;
  /**
   * 時間単価。v2では実際の単価、v3では baseSubtotal / hours の四捨五入（表示互換専用）。
   * v3のpricePerHourは加重平均であり、時間変更・返金など業務計算に絶対に再利用しないこと。
   */
  pricePerHour: number;
  hours: number;
  baseSubtotal: number;
  discount: { kind: "last_minute" | "early_bird"; percent: number; amount: number } | null;
  /** unitPrice/priceUnitは時間変更時の差額再計算用スナップショット（2026-08以前の旧データには無い） */
  options: {
    id: string;
    name: string;
    amount: number;
    unitPrice?: number;
    priceUnit?: "per_booking" | "per_hour";
  }[];
  optionsSubtotal: number;
  coupon: { code: string; amount: number } | null;
  total: number;
  /**
   * 時間変更の確定時に、再構成した明細合計と実請求額がずれた場合の調整行
   * （キャンセルポリシーによる料金据え置き・返金上限クランプ等。v3の変更後のみ）
   */
  changeAdjustment?: { amount: number; note: string };
};

/** JSTでの「今日から利用日まで何日先か」（同日=0） */
export function leadDays(dateStr: string, now: Date): number {
  const todayJst = utcToJstDateStr(now);
  const a = new Date(`${todayJst}T00:00:00+09:00`).getTime();
  const b = new Date(`${dateStr}T00:00:00+09:00`).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

// ─── 帯の純粋計算（v3） ─────────────────────────────────────────

/** 帯セットが 0-24 を隙間なく覆っているか（重複はEXCLUDE制約とRPCが防止済み前提） */
export function bandsCoverFullDay(bands: PriceBand[]): boolean {
  if (bands.length === 0) return false;
  const sorted = [...bands].sort((a, b) => a.startHour - b.startHour);
  if (sorted[0].startHour !== 0) return false;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startHour !== sorted[i - 1].endHour) return false;
  }
  return sorted[sorted.length - 1].endHour === 24;
}

/** 帯セットの最低時間単価（日ヘッダの「¥1,040〜」表示用） */
export function minBandPrice(bands: PriceBand[]): number {
  return bands.reduce((m, b) => Math.min(m, b.hourlyPrice), Infinity);
}

function bandAt(bands: PriceBand[], hour: number): PriceBand {
  const band = bands.find((b) => b.startHour <= hour && hour < b.endHour);
  if (!band) {
    // resolvePricingが完全被覆を保証しているため通常到達しない（防御的停止。安値で売らない）
    throw new Error(`price band gap at hour ${hour}`);
  }
  return band;
}

const fmtHour = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, "0")}`;
};

/**
 * 予約時間 [startHour, endHour) を帯で分割し、実際の時刻範囲ラベルつきの内訳行を作る。
 * 30分スロットごとに帯単価×0.5を積み、同一帯の連続スロットを1行にまとめる。
 * 帯単価は10円単位（RPCで保証）のためスロット額は5円単位・行合計は整数円になるが、
 * 手動SQL等で崩れた場合に備えて行額はMath.roundで整数円を保証する。
 */
export function buildBandLines(
  bands: PriceBand[],
  startHour: number,
  endHour: number
): PriceBandLine[] {
  const lines: PriceBandLine[] = [];
  for (let h = startHour; h < endHour - 1e-9; h += 0.5) {
    const slot = Math.round(h * 2) / 2;
    const band = bandAt(bands, slot);
    const last = lines[lines.length - 1];
    if (last && last.pricePerHour === band.hourlyPrice && last.endHour === slot) {
      last.endHour = slot + 0.5;
    } else {
      lines.push({
        label: "",
        startHour: slot,
        endHour: slot + 0.5,
        pricePerHour: band.hourlyPrice,
        hours: 0,
        amount: 0,
      });
    }
  }
  for (const line of lines) {
    line.hours = Math.round((line.endHour - line.startHour) * 2) / 2;
    line.amount = Math.round(line.pricePerHour * line.hours);
    line.label = `${fmtHour(line.startHour)}〜${fmtHour(line.endHour)}`;
  }
  return lines;
}

/** 予約時間 [startHour, endHour) の帯価格合計（整数円） */
export function calcBandAmount(bands: PriceBand[], startHour: number, endHour: number): number {
  return buildBandLines(bands, startHour, endHour).reduce((s, l) => s + l.amount, 0);
}

// ─── 見積もり計算 ───────────────────────────────────────────────

/**
 * 見積もり計算。
 * - 基本料金:
 *   - v2（pricing未指定）: 平日 hourly_price / 土日祝 holiday_hourly_price（未設定なら平日と同額）
 *   - v3（pricing指定）: 時間帯別の帯単価を30分スロットごとに合算（bandLinesに内訳）
 * - 割引: 直前割（当日予約）or 早割。併用なし。基本料金にのみ掛かる。
 *   v3では standard ティアのみ適用（repeatには適用しない）。
 * - クーポン: 割引後の基本料金＋オプションの合計に適用（percent or 固定額）。両ティア適用可。
 */
export function calcQuote(
  venue: PricingVenue,
  dateStr: string,
  startHour: number,
  hours: number,
  isHoliday: boolean,
  now: Date,
  options: SelectedOption[] = [],
  coupon: CouponInfo | null = null,
  pricing: ResolvedPricing | null = null
): PriceBreakdown {
  const dayType: DayType = isHoliday ? "holiday" : "weekday";

  let pricePerHour: number;
  let baseSubtotal: number;
  let bandLines: PriceBandLine[] | undefined;
  if (pricing) {
    bandLines = buildBandLines(pricing.bands, startHour, startHour + hours);
    baseSubtotal = bandLines.reduce((s, l) => s + l.amount, 0);
    // 互換用の加重平均（表示専用。業務計算に再利用しない）
    pricePerHour = hours > 0 ? Math.round(baseSubtotal / hours) : 0;
  } else {
    pricePerHour =
      isHoliday && venue.holiday_hourly_price != null
        ? venue.holiday_hourly_price
        : venue.hourly_price;
    baseSubtotal = pricePerHour * hours;
  }

  // 割引（直前割 or 早割）。v3のrepeatティアには適用しない（standard向け施策のため）
  const discountEligible = !pricing || pricing.tierUsed === "standard";
  const lead = leadDays(dateStr, now);
  let discount: PriceBreakdown["discount"] = null;
  if (discountEligible) {
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
  }

  // オプション（per_hour×0.5刻みで端数が出うるためMath.roundで整数円を保証）
  const optionItems = options.map((o) => ({
    id: o.id,
    name: o.name,
    amount: o.price_unit === "per_hour" ? Math.round(o.price * hours) : o.price,
    unitPrice: o.price,
    priceUnit: o.price_unit,
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
    rule: pricing ? "v3" : "v2",
    ...(pricing
      ? { tier: pricing.tierUsed, priceVersion: pricing.priceVersion, bandLines }
      : {}),
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
