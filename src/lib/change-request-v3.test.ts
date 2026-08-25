import { describe, expect, it } from "vitest";
import { calcChangeAmounts, type BandChargeContext, type ChangeDayTypes } from "./change-request";
import { calcBandAmount, type PriceBand } from "./pricing";
import type { Booking, Venue } from "./types";

/**
 * v3予約（時間帯別料金）の時間変更テスト。
 * ポリシー: 変更後の時間帯全体を「同じtier・現在の帯表」で再計算し、
 * スナップショットの基本料金（prevBase）との差額を請求/返金する。
 * bandContext は price-bands.resolveBandChargeContext がDBから作る値を純粋に再現する。
 */

const jst = (dateStr: string, hour: number) =>
  new Date(new Date(`${dateStr}T00:00:00+09:00`).getTime() + hour * 60 * 60 * 1000);

const range = (dateStr: string, startHour: number, endHour: number) => ({
  start: jst(dateStr, startHour),
  end: jst(dateStr, endHour),
});

// 平日standard帯: 深夜1140 / 朝1600 / 昼2210 / 夜2370
const BANDS: PriceBand[] = [
  { startHour: 0, endHour: 6, hourlyPrice: 1140 },
  { startHour: 6, endHour: 12, hourlyPrice: 1600 },
  { startHour: 12, endHour: 18, hourlyPrice: 2210 },
  { startHour: 18, endHour: 24, hourlyPrice: 2370 },
];

const venue = {
  hourly_price: 1900,
  holiday_hourly_price: 2300,
  cancellation_policy: null,
} as unknown as Venue;

const SAME_DAY: ChangeDayTypes = { previous: "weekday", next: "weekday" };
const REFUNDABLE_BASIS = jst("2026-08-20", 10);
const NON_REFUNDABLE_BASIS = jst("2026-08-29", 10);

// 2026-09-01(火) 10:00-13:00・帯またぎ（朝2h＋昼1h）= 1600×2 + 2210×1 = 5410
const PREV_BASE = calcBandAmount(BANDS, 10, 13);

function makeV3Booking(overrides: Record<string, unknown> = {}): Booking {
  return {
    id: "b-v3",
    start_at: jst("2026-09-01", 10).toISOString(),
    end_at: jst("2026-09-01", 13).toISOString(),
    total_amount: PREV_BASE,
    adjusted_total: null,
    extra_paid_amount: 0,
    refunded_amount: 0,
    price_breakdown: {
      rule: "v3",
      tier: "standard",
      priceVersion: "bands:testversion",
      dayType: "weekday",
      hours: 3,
      baseSubtotal: PREV_BASE,
      options: [],
    },
    ...overrides,
  } as unknown as Booking;
}

/** 変更後の時間帯を現在の帯表で計算したcontext（resolveBandChargeContext相当） */
const ctx = (nextStart: number, nextEnd: number): BandChargeContext => ({
  prevBase: PREV_BASE,
  nextBase: calcBandAmount(BANDS, nextStart, nextEnd),
});

describe("calcChangeAmounts v3（帯価格）", () => {
  it("帯またぎ延長: 10-13 → 10-14 は昼帯1hぶん（¥2,210）を追加請求", () => {
    const r = calcChangeAmounts(
      makeV3Booking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 14),
      REFUNDABLE_BASIS, SAME_DAY, ctx(10, 14)
    );
    expect(r.kind).toBe("extend");
    expect(r.extraAmount).toBe(2210);
    expect(r.newAmount).toBe(PREV_BASE + 2210);
    expect(r.refundAmount).toBe(0);
  });

  it("帯またぎ延長（朝帯予約→昼帯へ30分延長）は昼単価で課金される", () => {
    // 朝帯のみの予約 10-12（3200）→ 12:30まで延長 → 昼帯30分 = 2210×0.5 = 1105
    const booking = makeV3Booking({
      end_at: jst("2026-09-01", 12).toISOString(),
      total_amount: 3200,
      price_breakdown: {
        rule: "v3", tier: "standard", dayType: "weekday", hours: 2,
        baseSubtotal: 3200, options: [],
      },
    });
    const context: BandChargeContext = { prevBase: 3200, nextBase: calcBandAmount(BANDS, 10, 12.5) };
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 12), range("2026-09-01", 10, 12.5),
      REFUNDABLE_BASIS, SAME_DAY, context
    );
    expect(r.extraAmount).toBe(1105); // 朝単価1600×0.5=800 ではない
  });

  it("帯移動（同時間数）: 10-13 → 14-17 は帯単価差を追加請求", () => {
    const r = calcChangeAmounts(
      makeV3Booking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 14, 17),
      REFUNDABLE_BASIS, SAME_DAY, ctx(14, 17)
    );
    expect(r.kind).toBe("shift");
    // 14-17は昼帯3h=6630、元は5410 → +1220
    expect(r.extraAmount).toBe(6630 - PREV_BASE);
    expect(r.newAmount).toBe(6630);
  });

  it("帯移動で安い帯へ（同時間数）: 全額返金区間なら差額返金", () => {
    // 10-13(5410) → 6-9(朝帯3h=4800) → 610返金
    const r = calcChangeAmounts(
      makeV3Booking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 6, 9),
      REFUNDABLE_BASIS, SAME_DAY, ctx(6, 9)
    );
    expect(r.refundAmount).toBe(PREV_BASE - 4800);
    expect(r.newAmount).toBe(4800);
  });

  it("短縮返金: 10-13 → 10-12 は昼帯1hぶん（¥2,210）を返金", () => {
    const r = calcChangeAmounts(
      makeV3Booking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 12),
      REFUNDABLE_BASIS, SAME_DAY, ctx(10, 12)
    );
    expect(r.kind).toBe("shorten");
    expect(r.refundAmount).toBe(2210);
    expect(r.newAmount).toBe(PREV_BASE - 2210);
  });

  it("短縮でもキャンセル料有料区間なら据え置き", () => {
    const r = calcChangeAmounts(
      makeV3Booking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 12),
      NON_REFUNDABLE_BASIS, SAME_DAY, ctx(10, 12)
    );
    expect(r.refundAmount).toBe(0);
    expect(r.newAmount).toBe(PREV_BASE);
  });

  it("per_hourオプションは帯差額に時間差分だけ加算される", () => {
    const booking = makeV3Booking({
      total_amount: PREV_BASE + 300,
      price_breakdown: {
        rule: "v3", tier: "standard", dayType: "weekday", hours: 3,
        baseSubtotal: PREV_BASE,
        options: [{ id: "h1", name: "ヒーター", amount: 300, unitPrice: 100, priceUnit: "per_hour" }],
      },
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 14),
      REFUNDABLE_BASIS, SAME_DAY, ctx(10, 14)
    );
    expect(r.extraAmount).toBe(2210 + 100);
  });

  it("返す単価は加重平均（表示専用）", () => {
    const r = calcChangeAmounts(
      makeV3Booking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 14, 17),
      REFUNDABLE_BASIS, SAME_DAY, ctx(14, 17)
    );
    expect(r.pricePerHour).toBe(Math.round(PREV_BASE / 3));
    expect(r.nextPricePerHour).toBe(2210);
  });

  it("bandContext=nullなら従来のv2ロジック（後方互換）", () => {
    const booking = makeV3Booking({
      price_breakdown: { rule: "v2", pricePerHour: 1900, dayType: "weekday", hours: 3, options: [] },
      total_amount: 5700,
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 14),
      REFUNDABLE_BASIS, SAME_DAY, null
    );
    expect(r.extraAmount).toBe(1900);
  });
});
