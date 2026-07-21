import { describe, expect, it } from "vitest";
import { ladderPrice, VENUE_PRICING_POLICY } from "./price-actions";

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
