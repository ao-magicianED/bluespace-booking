import { describe, expect, it } from "vitest";
import {
  BANK_HOLIDAYS_MMDD,
  INVOICE_MAX_DUE_HOURS,
  INVOICE_MIN_LEAD_HOURS,
  calcInvoiceDueAtWithHolidays,
  isBusinessDay,
  isInvoiceEligible,
} from "./invoice-rules";

// 基準時刻: JST 2026-06-11(木) 10:00 = UTC 2026-06-11T01:00:00Z（slots.test.tsと同じ基準日）
const NOW = new Date("2026-06-11T01:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("isBusinessDay", () => {
  it("土日は営業日ではない", () => {
    expect(isBusinessDay("2026-06-13", new Set())).toBe(false); // 土
    expect(isBusinessDay("2026-06-14", new Set())).toBe(false); // 日
  });

  it("平日で祝日Setに無ければ営業日", () => {
    expect(isBusinessDay("2026-06-12", new Set())).toBe(true); // 金（祝日指定なし）
  });

  it("祝日Setに入っていれば営業日ではない", () => {
    expect(isBusinessDay("2026-06-12", new Set(["2026-06-12"]))).toBe(false);
  });

  it("銀行休業日（12/31, 1/2, 1/3）は国民の祝日でなくても営業日ではない", () => {
    for (const mmdd of BANK_HOLIDAYS_MMDD) {
      const [m, d] = mmdd.split("-");
      expect(isBusinessDay(`2026-${m}-${d}`, new Set())).toBe(false);
    }
  });
});

describe("isInvoiceEligible", () => {
  it("利用開始まで120時間（5日）以上あれば選べる", () => {
    const startAt = new Date(NOW.getTime() + INVOICE_MIN_LEAD_HOURS * HOUR);
    expect(isInvoiceEligible(startAt, NOW)).toBe(true);
  });

  it("120時間にわずかに足りないと選べない（境界）", () => {
    const startAt = new Date(NOW.getTime() + INVOICE_MIN_LEAD_HOURS * HOUR - 60 * 1000);
    expect(isInvoiceEligible(startAt, NOW)).toBe(false);
  });
});

describe("calcInvoiceDueAtWithHolidays", () => {
  it("平日昼の申込 → 翌営業日18:00", () => {
    const now = new Date(NOW.getTime() + HOUR); // JST 木 11:00
    const result = calcInvoiceDueAtWithHolidays(new Date(now.getTime() + 200 * HOUR), now, new Set());
    expect(result.dueAt.toISOString()).toBe("2026-06-12T09:00:00.000Z"); // JST 金 18:00
    expect(result.cappedBy).toBe("next_business_day");
    expect(result.dueOnNonBusinessDay).toBe(false);
  });

  it("23:59申込 → 翌営業日18:00（最低18時間の猶予が保たれる境界）", () => {
    const now = new Date("2026-06-11T14:59:00Z"); // JST 木 23:59
    const result = calcInvoiceDueAtWithHolidays(new Date(now.getTime() + 200 * HOUR), now, new Set());
    expect(result.dueAt.toISOString()).toBe("2026-06-12T09:00:00.000Z"); // JST 金 18:00
    expect(result.dueAt.getTime() - now.getTime()).toBeGreaterThanOrEqual(18 * HOUR);
  });

  it("金曜15:00の申込 → 月曜18:00（95h上限内に収まり、翌営業日と一致する）", () => {
    const now = new Date("2026-06-12T06:00:00Z"); // JST 金 15:00
    const result = calcInvoiceDueAtWithHolidays(new Date(now.getTime() + 200 * HOUR), now, new Set());
    expect(result.dueAt.toISOString()).toBe("2026-06-15T09:00:00.000Z"); // JST 月 18:00
    expect(result.cappedBy).toBe("next_business_day");
  });

  it("土曜10:00の申込 → 月曜18:00", () => {
    const now = new Date("2026-06-13T01:00:00Z"); // JST 土 10:00
    const result = calcInvoiceDueAtWithHolidays(new Date(now.getTime() + 200 * HOUR), now, new Set());
    expect(result.dueAt.toISOString()).toBe("2026-06-15T09:00:00.000Z"); // JST 月 18:00
  });

  it("祝日を挟む3連休（木曜申込＋金曜祝日）→ 95h上限で日曜18:00に切り詰められる", () => {
    const now = new Date(NOW.getTime() + HOUR); // JST 木 11:00
    const holidaySet = new Set(["2026-06-12"]); // 金を祝日扱いにする
    const result = calcInvoiceDueAtWithHolidays(new Date(now.getTime() + 200 * HOUR), now, holidaySet);
    expect(result.dueAt.toISOString()).toBe("2026-06-14T09:00:00.000Z"); // JST 日 18:00
    expect(result.cappedBy).toBe("max_hours");
    expect(result.dueOnNonBusinessDay).toBe(true);
  });

  it("利用開始が近い場合は「利用開始−24h」が最終的な上限になる", () => {
    const now = new Date(NOW.getTime() + HOUR); // JST 木 11:00
    const startAt = new Date(now.getTime() + 30 * HOUR);
    const result = calcInvoiceDueAtWithHolidays(startAt, now, new Set());
    expect(result.dueAt.getTime()).toBe(startAt.getTime() - 24 * HOUR);
    expect(result.cappedBy).toBe("start_minus_24h");
  });

  it("年末年始（銀行休業日12/31,1/2,1/3）を挟むと、95h上限（候補2）が銀行休業日に落ちうる（dueOnNonBusinessDayで警告）", () => {
    // 候補1（翌営業日探索）は12/31・元日・1/2・1/3を確実にスキップして1/4以降になるが、
    // 候補2（申込+95h以内で最も遅い18:00）は営業日に限らないため、95h上限が候補1より早く効くと
    // 銀行休業日に着地しうる。これは設計上の意図した挙動（dueOnNonBusinessDay=trueで警告する）。
    const now = new Date("2026-12-30T01:00:00Z"); // JST 12/30 10:00
    const holidaySet = new Set(["2027-01-01"]); // 元日
    const startAt = new Date(now.getTime() + 200 * HOUR);
    const result = calcInvoiceDueAtWithHolidays(startAt, now, holidaySet);
    expect(result.dueAt.toISOString()).toBe("2027-01-02T09:00:00.000Z"); // JST 1/2 18:00
    expect(result.cappedBy).toBe("max_hours");
    expect(result.dueOnNonBusinessDay).toBe(true);
  });

  it.each([
    [new Date(NOW.getTime() + HOUR), new Set<string>()],
    [new Date("2026-06-11T14:59:00Z"), new Set<string>()],
    [new Date("2026-06-12T06:00:00Z"), new Set<string>()],
    [new Date("2026-06-13T01:00:00Z"), new Set<string>()],
    [new Date(NOW.getTime() + HOUR), new Set(["2026-06-12"])],
    [new Date("2026-12-30T01:00:00Z"), new Set(["2027-01-01"])],
  ])("結果は常に「申込+%s時間以内」かつ未来である", (now, holidaySet) => {
    const startAt = new Date(now.getTime() + 200 * HOUR);
    const result = calcInvoiceDueAtWithHolidays(startAt, now, holidaySet);
    expect(result.dueAt.getTime()).toBeGreaterThan(now.getTime());
    expect(result.dueAt.getTime()).toBeLessThanOrEqual(now.getTime() + INVOICE_MAX_DUE_HOURS * HOUR);
  });
});
