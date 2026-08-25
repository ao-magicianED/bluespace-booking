import { describe, expect, it, vi } from "vitest";
import type { Venue } from "./types";

/**
 * 祝日判定のfail-expensiveテスト。
 * 祝日DBが読めないとき平日価格で売るのは過小請求（fail-cheap）のため、
 * quote / checkout の共通経路（buildQuote）は QuoteError(503) で停止する。
 */

vi.mock("./supabase", () => ({ getDb: () => ({}) }));
vi.mock("./holidays", () => ({
  getHolidaySetStrict: vi.fn(async () => {
    throw new Error("祝日データの取得に失敗しました: db down");
  }),
  isHolidayDate: () => false,
}));
vi.mock("./price-bands", () => ({
  resolvePricing: vi.fn(async () => {
    throw new Error("ここには到達しない（祝日判定で先に停止する）");
  }),
}));

import { buildQuote, QuoteError } from "./quote";

const venue = {
  id: "v1",
  hourly_price: 1000,
  holiday_hourly_price: 2000,
  last_minute_percent: 0,
  early_bird_percent: 0,
  early_bird_days: 30,
} as unknown as Venue;

describe("buildQuote（祝日DB読取失敗）", () => {
  it("祝日テーブルが読めないとき QuoteError(503) で見積・決済を停止する", async () => {
    const promise = buildQuote(venue, "2026-09-01", 10, 2, [], "", new Date());
    await expect(promise).rejects.toBeInstanceOf(QuoteError);
    await buildQuote(venue, "2026-09-01", 10, 2, [], "", new Date()).catch((e) => {
      expect((e as QuoteError).status).toBe(503);
      expect((e as QuoteError).message).toContain("ご予約を受け付けられません");
    });
  });
});
