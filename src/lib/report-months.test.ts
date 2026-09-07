import { describe, expect, it } from "vitest";
import { pickClosedMonths } from "./report-months";

describe("pickClosedMonths", () => {
  it("未来月と当月を除外する", () => {
    const months = ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2027-02"];
    expect(pickClosedMonths(months, "2026-09")).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });

  it("先々の継続予約があっても、書きたい月が落ちない", () => {
    // 実データで確認された継続予約(2027-02まで)を含むケース。
    // 除外しないと直近6ヶ月が 2026-09〜2027-02 になり、対象の2026-08が消える。
    const months = [
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
      "2027-01", "2027-02",
    ];
    const picked = pickClosedMonths(months, "2026-09");
    expect(picked).toContain("2026-08");
    expect(picked.some((m) => m >= "2026-09")).toBe(false);
    expect(picked).toHaveLength(6);
  });

  it("重複を除き、古い順に並べる", () => {
    expect(pickClosedMonths(["2026-03", "2026-01", "2026-03", "2026-02"], "2026-04", 2)).toEqual([
      "2026-02",
      "2026-03",
    ]);
  });

  it("完結した月が無ければ空配列", () => {
    expect(pickClosedMonths(["2026-09", "2026-10"], "2026-09")).toEqual([]);
  });
});
