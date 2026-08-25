import { describe, expect, it } from "vitest";
import {
  bandsCoverFullDay,
  buildBandLines,
  calcBandAmount,
  calcQuote,
  minBandPrice,
  type PriceBand,
  type PricingVenue,
  type ResolvedPricing,
} from "./pricing";
import { resolvePricingFromRows } from "./price-bands";
import { QuoteError } from "./quote";

// 基準時刻: JST 2026-06-11 10:00
const NOW = new Date("2026-06-11T01:00:00Z");

const venue: PricingVenue = {
  hourly_price: 1000,
  holiday_hourly_price: 2000,
  last_minute_percent: 10,
  early_bird_percent: 10,
  early_bird_days: 30,
};

// 4帯（御徒町・平日standard相当の実例値）
const WEEKDAY_STD: PriceBand[] = [
  { startHour: 0, endHour: 6, hourlyPrice: 1140 },
  { startHour: 6, endHour: 12, hourlyPrice: 1600 },
  { startHour: 12, endHour: 18, hourlyPrice: 2210 },
  { startHour: 18, endHour: 24, hourlyPrice: 2370 },
];

const pricingOf = (
  bands: PriceBand[],
  tierUsed: "standard" | "repeat" = "standard",
  priceVersion = "bands:testversion"
): ResolvedPricing => ({ bands, source: "bands", tierUsed, priceVersion });

describe("帯の純粋計算", () => {
  it("bandsCoverFullDay: 完全被覆のみtrue", () => {
    expect(bandsCoverFullDay(WEEKDAY_STD)).toBe(true);
    expect(bandsCoverFullDay(WEEKDAY_STD.slice(1))).toBe(false); // 0-6が欠落
    expect(bandsCoverFullDay(WEEKDAY_STD.slice(0, 3))).toBe(false); // 18-24が欠落
    expect(bandsCoverFullDay([])).toBe(false);
    expect(bandsCoverFullDay([{ startHour: 0, endHour: 24, hourlyPrice: 1000 }])).toBe(true);
  });

  it("minBandPrice: 最低帯価格", () => {
    expect(minBandPrice(WEEKDAY_STD)).toBe(1140);
  });

  it("buildBandLines: 帯またぎを実際の時刻範囲ラベルで分割する", () => {
    const lines = buildBandLines(WEEKDAY_STD, 10, 14);
    expect(lines).toEqual([
      { label: "10:00〜12:00", startHour: 10, endHour: 12, pricePerHour: 1600, hours: 2, amount: 3200 },
      { label: "12:00〜14:00", startHour: 12, endHour: 14, pricePerHour: 2210, hours: 2, amount: 4420 },
    ]);
  });

  it("buildBandLines: 30分刻み（10:30開始1.5h）", () => {
    const lines = buildBandLines(WEEKDAY_STD, 10.5, 12);
    expect(lines).toEqual([
      { label: "10:30〜12:00", startHour: 10.5, endHour: 12, pricePerHour: 1600, hours: 1.5, amount: 2400 },
    ]);
  });

  it("buildBandLines: 帯境界をまたぐ30分刻み（11:30〜12:30）", () => {
    const lines = buildBandLines(WEEKDAY_STD, 11.5, 12.5);
    expect(lines).toHaveLength(2);
    expect(lines[0].amount).toBe(800); // 1600×0.5
    expect(lines[1].amount).toBe(1105); // 2210×0.5
  });

  it("calcBandAmount: 合計は整数円", () => {
    expect(calcBandAmount(WEEKDAY_STD, 10, 14)).toBe(7620);
    expect(calcBandAmount(WEEKDAY_STD, 10.5, 12)).toBe(2400);
  });
});

describe("calcQuote v3", () => {
  it("帯またぎ: bandLinesとbaseSubtotal、加重平均pricePerHour", () => {
    const q = calcQuote(venue, "2026-06-16", 10, 4, false, NOW, [], null, pricingOf(WEEKDAY_STD));
    expect(q.rule).toBe("v3");
    expect(q.tier).toBe("standard");
    expect(q.priceVersion).toBe("bands:testversion");
    expect(q.bandLines).toHaveLength(2);
    expect(q.baseSubtotal).toBe(7620);
    expect(q.pricePerHour).toBe(1905); // 7620/4（表示互換の加重平均）
    expect(q.total).toBe(7620);
  });

  it("直前割はstandardのみ適用（repeatには掛からない）", () => {
    // 当日（NOW=2026-06-11）予約・last_minute_percent=10
    const std = calcQuote(venue, "2026-06-11", 14, 2, false, NOW, [], null, pricingOf(WEEKDAY_STD, "standard"));
    expect(std.discount?.kind).toBe("last_minute");
    expect(std.discount?.amount).toBe(442); // floor(4420×10%)

    const rep = calcQuote(venue, "2026-06-11", 14, 2, false, NOW, [], null, pricingOf(WEEKDAY_STD, "repeat"));
    expect(rep.discount).toBeNull();
  });

  it("クーポンは両ティアに適用可（割引後＋オプション合計に適用）", () => {
    const q = calcQuote(
      venue, "2026-06-16", 10, 2, false, NOW,
      [{ id: "p1", name: "P", price: 500, price_unit: "per_booking" }],
      { code: "SAVE10", percent_off: 10, amount_off: null },
      pricingOf(WEEKDAY_STD, "repeat")
    );
    // base 1600×2=3200 + opt500 = 3700 → 10% = 370
    expect(q.coupon).toEqual({ code: "SAVE10", amount: 370 });
    expect(q.total).toBe(3330);
  });

  it("per_hourオプションは0.5刻みでも整数円（Math.round）", () => {
    const q = calcQuote(
      venue, "2026-06-16", 10, 1.5, false, NOW,
      [{ id: "h1", name: "H", price: 333, price_unit: "per_hour" }],
      null,
      pricingOf(WEEKDAY_STD)
    );
    expect(q.options[0].amount).toBe(Math.round(333 * 1.5)); // 500（499.5の丸め）
    expect(Number.isInteger(q.total)).toBe(true);
  });

  it("pricing未指定なら従来どおりv2（後方互換）", () => {
    const q = calcQuote(venue, "2026-06-16", 10, 2, false, NOW);
    expect(q.rule).toBe("v2");
    expect(q.tier).toBeUndefined();
    expect(q.bandLines).toBeUndefined();
    expect(q.pricePerHour).toBe(1000);
    expect(q.total).toBe(2000);
  });
});

describe("resolvePricingFromRows（解決チェーン）", () => {
  const rows = (bands: { tier: string; s: number; e: number; p: number }[]) =>
    bands.map((b) => ({ tier: b.tier, start_hour: b.s, end_hour: b.e, hourly_price: b.p }));

  const FULL_BOTH = rows([
    { tier: "standard", s: 0, e: 12, p: 2000 },
    { tier: "standard", s: 12, e: 24, p: 3000 },
    { tier: "repeat", s: 0, e: 12, p: 1500 },
    { tier: "repeat", s: 12, e: 24, p: 2000 },
  ]);

  it("帯が1件も無い → フラット単一帯（レガシー拠点）", () => {
    const r = resolvePricingFromRows([], "standard", 1000);
    expect(r.source).toBe("flat");
    expect(r.tierUsed).toBe("standard");
    expect(r.bands).toEqual([{ startHour: 0, endHour: 24, hourlyPrice: 1000 }]);
    expect(r.priceVersion).toBe("flat:1000");
  });

  it("standard指定 → standard帯", () => {
    const r = resolvePricingFromRows(FULL_BOTH, "standard", 1000);
    expect(r.source).toBe("bands");
    expect(r.tierUsed).toBe("standard");
    expect(r.bands.map((b) => b.hourlyPrice)).toEqual([2000, 3000]);
  });

  it("repeat指定＋repeat帯完全被覆 → repeat帯", () => {
    const r = resolvePricingFromRows(FULL_BOTH, "repeat", 1000);
    expect(r.tierUsed).toBe("repeat");
    expect(r.bands.map((b) => b.hourlyPrice)).toEqual([1500, 2000]);
  });

  it("repeat指定でもrepeat帯が欠落 → standard帯へフォールバック（フラットに落ちない）", () => {
    const noRepeat = rows([
      { tier: "standard", s: 0, e: 12, p: 2000 },
      { tier: "standard", s: 12, e: 24, p: 3000 },
    ]);
    const r = resolvePricingFromRows(noRepeat, "repeat", 1000);
    expect(r.tierUsed).toBe("standard");
    expect(r.source).toBe("bands");
    expect(r.bands.map((b) => b.hourlyPrice)).toEqual([2000, 3000]);
  });

  it("repeat帯が不完全（穴）→ standard帯へフォールバック", () => {
    const partialRepeat = rows([
      { tier: "standard", s: 0, e: 12, p: 2000 },
      { tier: "standard", s: 12, e: 24, p: 3000 },
      { tier: "repeat", s: 12, e: 24, p: 2000 },
    ]);
    const r = resolvePricingFromRows(partialRepeat, "repeat", 1000);
    expect(r.tierUsed).toBe("standard");
  });

  it("standard帯に穴 → QuoteError(503)で停止（旧フラットに落とさない）", () => {
    const broken = rows([
      { tier: "standard", s: 0, e: 12, p: 2000 },
      // 12-24が欠落
      { tier: "repeat", s: 0, e: 12, p: 1500 },
      { tier: "repeat", s: 12, e: 24, p: 2000 },
    ]);
    expect(() => resolvePricingFromRows(broken, "standard", 1000)).toThrowError(QuoteError);
    try {
      resolvePricingFromRows(broken, "standard", 1000);
    } catch (e) {
      expect((e as QuoteError).status).toBe(503);
    }
    // repeat指定でもstandardの検証が先に走って停止する
    expect(() => resolvePricingFromRows(broken, "repeat", 1000)).toThrowError(QuoteError);
  });

  it("priceVersionは帯セットごとに変わる（価格変更で自動的に別versionになる）", () => {
    const a = resolvePricingFromRows(FULL_BOTH, "standard", 1000);
    const changed = rows([
      { tier: "standard", s: 0, e: 12, p: 2100 },
      { tier: "standard", s: 12, e: 24, p: 3000 },
      { tier: "repeat", s: 0, e: 12, p: 1500 },
      { tier: "repeat", s: 12, e: 24, p: 2000 },
    ]);
    const b = resolvePricingFromRows(changed, "standard", 1000);
    expect(a.priceVersion).toMatch(/^bands:[0-9a-f]{12}$/);
    expect(b.priceVersion).toMatch(/^bands:[0-9a-f]{12}$/);
    expect(a.priceVersion).not.toBe(b.priceVersion);
    // 同じ帯セットなら同じversion
    expect(resolvePricingFromRows(FULL_BOTH, "standard", 1000).priceVersion).toBe(a.priceVersion);
    // repeat帯はstandardと別version
    expect(resolvePricingFromRows(FULL_BOTH, "repeat", 1000).priceVersion).not.toBe(a.priceVersion);
  });
});
