import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * R2ガード: 価格ティアは「サーバーが解決したresolveTier()」のみを根拠にする。
 * quote / checkout / availability のルートが、リクエストの body / query / header から
 * ティアを読むコードを書き戻したらこのテストが落ちる（entry-tier.test.ts の
 * resolveTier単体テストと合わせて、クライアント入力でティアが変わらないことを担保）。
 */

const TIER_ROUTES = [
  "src/app/api/quote/route.ts",
  "src/app/api/checkout/route.ts",
  "src/app/api/availability/route.ts",
];

/** リクエスト入力からティアを読んでいそうなパターン（禁止） */
const FORBIDDEN_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "bodyからのティア読み取り", re: /body\s*\.\s*(tier|priceTier|price_tier)\b/ },
  { label: "queryからのティア読み取り", re: /searchParams\.get\(\s*["'](tier|priceTier|price_tier)["']/ },
  { label: "headerからのティア読み取り", re: /headers\.get\(\s*["'][^"']*tier[^"']*["']/i },
];

describe("R2ガード（ティアのサーバー検証のみ）", () => {
  for (const rel of TIER_ROUTES) {
    const content = readFileSync(path.join(process.cwd(), rel), "utf8");

    it(`${rel} はresolveTier()でティアを解決している`, () => {
      expect(content.includes("resolveTier(")).toBe(true);
    });

    it(`${rel} はリクエスト入力からティアを読んでいない`, () => {
      for (const { label, re } of FORBIDDEN_PATTERNS) {
        expect(re.test(content), `${rel}: ${label} を検出（R2違反）`).toBe(false);
      }
    });
  }

  it("buildQuoteはtier引数の既定値がstandard（未指定でrepeatにならない）", () => {
    const content = readFileSync(path.join(process.cwd(), "src/lib/quote.ts"), "utf8");
    expect(/tier:\s*PriceTier\s*=\s*"standard"/.test(content)).toBe(true);
  });
});
