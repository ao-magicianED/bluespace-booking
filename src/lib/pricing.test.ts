import { describe, expect, it } from "vitest";
import { calcQuote, leadDays, type PricingVenue } from "./pricing";

// 基準時刻: JST 2026-06-11 10:00
const NOW = new Date("2026-06-11T01:00:00Z");

const venue: PricingVenue = {
  hourly_price: 1000,
  holiday_hourly_price: 2000,
  last_minute_percent: 10,
  early_bird_percent: 10,
  early_bird_days: 30,
};

describe("leadDays", () => {
  it("同日=0、翌日=1、30日後=30", () => {
    expect(leadDays("2026-06-11", NOW)).toBe(0);
    expect(leadDays("2026-06-12", NOW)).toBe(1);
    expect(leadDays("2026-07-11", NOW)).toBe(30);
  });
});

describe("calcQuote 基本料金", () => {
  it("平日料金", () => {
    const q = calcQuote(venue, "2026-06-16", 10, 2, false, NOW);
    expect(q.pricePerHour).toBe(1000);
    expect(q.baseSubtotal).toBe(2000);
    expect(q.discount).toBeNull();
    expect(q.total).toBe(2000);
  });

  it("土日祝料金", () => {
    const q = calcQuote(venue, "2026-06-14", 10, 2, true, NOW);
    expect(q.pricePerHour).toBe(2000);
    expect(q.baseSubtotal).toBe(4000);
    expect(q.dayType).toBe("holiday");
  });

  it("holiday_hourly_price未設定なら平日と同額", () => {
    const q = calcQuote({ ...venue, holiday_hourly_price: null }, "2026-06-14", 10, 2, true, NOW);
    expect(q.pricePerHour).toBe(1000);
  });
});

describe("calcQuote 割引", () => {
  it("直前割: 当日予約は10%OFF", () => {
    const q = calcQuote(venue, "2026-06-11", 14, 2, false, NOW);
    expect(q.discount).toEqual({ kind: "last_minute", percent: 10, amount: 200 });
    expect(q.total).toBe(1800);
  });

  it("早割: 30日以上前は10%OFF、29日前は適用なし", () => {
    const q30 = calcQuote(venue, "2026-07-11", 10, 1, false, NOW);
    expect(q30.discount?.kind).toBe("early_bird");
    expect(q30.total).toBe(900);
    const q29 = calcQuote(venue, "2026-07-10", 10, 1, false, NOW);
    expect(q29.discount).toBeNull();
  });

  it("休日料金にも割引が掛かる（休日の当日予約）", () => {
    const q = calcQuote(venue, "2026-06-11", 14, 1, true, NOW);
    expect(q.baseSubtotal).toBe(2000);
    expect(q.discount?.amount).toBe(200);
    expect(q.total).toBe(1800);
  });

  it("割引率0なら適用なし", () => {
    const q = calcQuote({ ...venue, last_minute_percent: 0 }, "2026-06-11", 14, 1, false, NOW);
    expect(q.discount).toBeNull();
  });
});

describe("calcQuote オプション", () => {
  const projector = { id: "p1", name: "プロジェクター", price: 500, price_unit: "per_booking" as const };
  const heater = { id: "h1", name: "ヒーター", price: 100, price_unit: "per_hour" as const };

  it("予約ごと/時間ごとの計算", () => {
    const q = calcQuote(venue, "2026-06-16", 10, 3, false, NOW, [projector, heater]);
    expect(q.options).toEqual([
      { id: "p1", name: "プロジェクター", amount: 500 },
      { id: "h1", name: "ヒーター", amount: 300 },
    ]);
    expect(q.total).toBe(3000 + 800);
  });

  it("割引はオプションには掛からない（基本料金のみ）", () => {
    const q = calcQuote(venue, "2026-06-11", 10, 2, false, NOW, [projector]);
    expect(q.discount?.amount).toBe(200); // 2000の10%（オプション500は対象外）
    expect(q.total).toBe(2000 - 200 + 500);
  });
});

describe("calcQuote クーポン", () => {
  it("percentクーポンは割引後＋オプション合計に適用", () => {
    const q = calcQuote(
      venue, "2026-06-11", 10, 2, false, NOW,
      [{ id: "p1", name: "P", price: 500, price_unit: "per_booking" }],
      { code: "SAVE10", percent_off: 10, amount_off: null }
    );
    // base2000 - 直前割200 + opt500 = 2300 → 10% = 230
    expect(q.coupon).toEqual({ code: "SAVE10", amount: 230 });
    expect(q.total).toBe(2070);
  });

  it("固定額クーポンは合計を超えない", () => {
    const q = calcQuote(venue, "2026-06-16", 10, 1, false, NOW, [],
      { code: "BIG", percent_off: null, amount_off: 5000 });
    expect(q.coupon?.amount).toBe(1000);
    expect(q.total).toBe(0);
  });
});
