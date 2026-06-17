import { describe, expect, it } from "vitest";
import { calcRefund, daysUntil, describePolicy, DEFAULT_POLICY } from "./cancellation";

const NOW = new Date("2026-06-11T01:00:00Z"); // JST 2026-06-11 10:00

describe("daysUntil", () => {
  it("利用開始までの残日数を計算", () => {
    expect(daysUntil(new Date("2026-06-12T01:00:00Z"), NOW)).toBe(1);
    expect(daysUntil(new Date("2026-06-21T01:00:00Z"), NOW)).toBe(10);
    expect(daysUntil(new Date("2026-06-11T05:00:00Z"), NOW)).toBe(0); // 当日
  });
});

describe("calcRefund 段階制（インスタベース準拠）", () => {
  const amount = 4000;

  it("8日以上前は全額返金", () => {
    const r = calcRefund(amount, new Date("2026-06-19T05:00:00Z"), NOW, DEFAULT_POLICY);
    expect(r.feePercent).toBe(0);
    expect(r.refundAmount).toBe(4000);
    expect(r.tierLabel).toBe("利用日の8日以上前");
  });

  it("7日前は50%", () => {
    const r = calcRefund(amount, new Date("2026-06-18T05:00:00Z"), NOW, DEFAULT_POLICY);
    expect(r.feePercent).toBe(50);
    expect(r.refundAmount).toBe(2000);
  });

  it("2日前は50%", () => {
    const r = calcRefund(amount, new Date("2026-06-13T05:00:00Z"), NOW, DEFAULT_POLICY);
    expect(r.feePercent).toBe(50);
  });

  it("前日は100%（返金なし）", () => {
    const r = calcRefund(amount, new Date("2026-06-12T05:00:00Z"), NOW, DEFAULT_POLICY);
    expect(r.feePercent).toBe(100);
    expect(r.refundAmount).toBe(0);
    expect(r.tierLabel).toBe("利用日の前日・当日");
  });

  it("当日は100%", () => {
    const r = calcRefund(amount, new Date("2026-06-11T15:00:00Z"), NOW, DEFAULT_POLICY);
    expect(r.feePercent).toBe(100);
  });
});

describe("describePolicy", () => {
  it("人間向け説明を生成", () => {
    const lines = describePolicy(DEFAULT_POLICY);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("8日前");
    expect(lines[2]).toContain("前日");
  });
});
