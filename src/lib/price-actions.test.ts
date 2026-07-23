import { describe, expect, it } from "vitest";
import {
  ladderPrice,
  validatePriceActionWithHolidays,
  VENUE_PRICING_POLICY,
  type PriceActionInput,
} from "./price-actions";

function input(overrides: Partial<PriceActionInput> = {}): PriceActionInput {
  return {
    venueSlug: "kanda",
    targetDate: "2026-07-22", // 水曜（平日）
    startHour: 9,
    endHour: 13,
    channel: "instabase",
    previousPrice: 1300,
    plannedPrice: 1100,
    isHoldout: false,
    reason: "テスト",
    ...overrides,
  };
}

describe("validatePriceActionWithHolidays", () => {
  it("平日の正当な値下げ指示は通る", () => {
    const r = validatePriceActionWithHolidays(input(), new Set());
    expect(r.blocked).toBe(false);
    expect(r.errors).toEqual([]);
  });

  it("土曜はブロックされる", () => {
    const r = validatePriceActionWithHolidays(input({ targetDate: "2026-07-25" }), new Set());
    expect(r.blocked).toBe(true);
    expect(r.errors.join()).toContain("土日祝");
  });

  it("平日の祝日（祝日Setにヒット）はブロックされる", () => {
    // 2026-08-11 山の日は火曜
    const r = validatePriceActionWithHolidays(
      input({ targetDate: "2026-08-11" }),
      new Set(["2026-08-11"])
    );
    expect(r.blocked).toBe(true);
    expect(r.errors.join()).toContain("土日祝");
  });

  it("下限割れの値下げ指示はブロックされる", () => {
    const r = validatePriceActionWithHolidays(input({ plannedPrice: 700 }), new Set());
    expect(r.blocked).toBe(true);
    expect(r.errors.join()).toContain("下限");
  });

  it("保護枠（is_holdout）でも下限割れはブロックされる（対照群データの汚染防止）", () => {
    const r = validatePriceActionWithHolidays(
      input({ isHoldout: true, plannedPrice: 0 }),
      new Set()
    );
    expect(r.blocked).toBe(true);
    expect(r.errors.join()).toContain("保護枠");
  });

  it("0.5刻みでない時刻はブロックされる", () => {
    const r = validatePriceActionWithHolidays(input({ startHour: 9.25 }), new Set());
    expect(r.blocked).toBe(true);
    expect(r.errors.join()).toContain("30分刻み");
  });

  it("終了時刻が開始時刻以前ならブロックされる", () => {
    const r = validatePriceActionWithHolidays(input({ startHour: 13, endHour: 13 }), new Set());
    expect(r.blocked).toBe(true);
  });

  it("実在しない日付はブロックされる", () => {
    const r = validatePriceActionWithHolidays(input({ targetDate: "2026-02-30" }), new Set());
    expect(r.blocked).toBe(true);
  });

  it("上野系の値下げ指示には孤立枠の警告がつく（保存はブロックしない）", () => {
    const r = validatePriceActionWithHolidays(
      input({ venueSlug: "ueno-okachimachi", plannedPrice: 1000 }),
      new Set()
    );
    expect(r.blocked).toBe(false);
    expect(r.warnings.join()).toContain("孤立");
  });
});

describe("ladderPrice", () => {
  it("1週目は15%引き（10円単位に丸め）", () => {
    expect(ladderPrice(1200, 0, 700)).toBe(1020);
  });

  it("2週目は25%引き", () => {
    expect(ladderPrice(1200, 1, 700)).toBe(900);
  });

  it("3週目以降は拠点の下限価格まで", () => {
    expect(ladderPrice(1200, 2, 700)).toBe(700);
    expect(ladderPrice(1200, 10, 700)).toBe(700);
  });

  it("値引き後でも下限価格を下回らない", () => {
    expect(ladderPrice(800, 0, 700)).toBe(700);
  });

  it("step<0 は基準価格そのまま（値下げなし）", () => {
    expect(ladderPrice(1200, -1, 700)).toBe(1200);
  });
});

describe("VENUE_PRICING_POLICY", () => {
  it("上野3拠点は孤立1時間枠ルール対象", () => {
    expect(VENUE_PRICING_POLICY["ueno-okachimachi"].requiresIsolatedSlot).toBe(true);
    expect(VENUE_PRICING_POLICY["ueno-4a"].requiresIsolatedSlot).toBe(true);
    expect(VENUE_PRICING_POLICY["ueno-4b"].requiresIsolatedSlot).toBe(true);
  });

  it("白金高輪の下限は700円", () => {
    expect(VENUE_PRICING_POLICY["shirokane-takanawa"].floorPrice).toBe(700);
  });
});
