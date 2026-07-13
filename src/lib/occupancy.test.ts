import { describe, expect, it } from "vitest";
import { jstDayOfWeek, jstToUtc } from "./slots";
import {
  dailyOccupancy,
  daysBetweenJst,
  judgeAlert,
  mergeRanges,
  occupancyForDates,
  overlapMs,
  weekdayTimeHeatmap,
} from "./occupancy";
import type { TimeRange } from "./types";

/** JSTの日付と時刻からTimeRangeを作るテストヘルパー */
function range(dateStr: string, startHour: number, endDateStr: string, endHour: number): TimeRange {
  return { start: jstToUtc(dateStr, startHour), end: jstToUtc(endDateStr, endHour) };
}

describe("daysBetweenJst", () => {
  it("同日は0、翌日は1", () => {
    expect(daysBetweenJst("2026-07-09", "2026-07-09")).toBe(0);
    expect(daysBetweenJst("2026-07-09", "2026-07-10")).toBe(1);
  });

  it("月・年をまたいでも正しい", () => {
    expect(daysBetweenJst("2026-01-01", "2026-02-01")).toBe(31);
    expect(daysBetweenJst("2026-01-01", "2026-07-09")).toBe(189);
  });
});

describe("mergeRanges", () => {
  it("重なり合う期間をマージする（順不同の入力でも）", () => {
    const merged = mergeRanges([
      range("2026-07-09", 12, "2026-07-09", 14),
      range("2026-07-09", 10, "2026-07-09", 13),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].start).toEqual(jstToUtc("2026-07-09", 10));
    expect(merged[0].end).toEqual(jstToUtc("2026-07-09", 14));
  });

  it("隣接する期間（終了=開始）は1つにまとめる", () => {
    const merged = mergeRanges([
      range("2026-07-09", 10, "2026-07-09", 12),
      range("2026-07-09", 12, "2026-07-09", 14),
    ]);
    expect(merged).toHaveLength(1);
  });

  it("離れた期間はそのまま、長さ0の期間は捨てる", () => {
    const merged = mergeRanges([
      range("2026-07-09", 10, "2026-07-09", 11),
      range("2026-07-09", 12, "2026-07-09", 12),
      range("2026-07-09", 13, "2026-07-09", 14),
    ]);
    expect(merged).toHaveLength(2);
  });

  it("入力のDateオブジェクトを破壊しない", () => {
    const a = range("2026-07-09", 10, "2026-07-09", 13);
    const originalEnd = a.end.getTime();
    mergeRanges([a, range("2026-07-09", 12, "2026-07-09", 14)]);
    expect(a.end.getTime()).toBe(originalEnd);
  });
});

describe("overlapMs", () => {
  it("窓の外は数えない・部分重なりは切り取る", () => {
    const merged = mergeRanges([range("2026-07-09", 8, "2026-07-09", 11)]);
    // 窓は10時〜22時 → 重なりは10〜11時の1時間
    const ms = overlapMs(merged, jstToUtc("2026-07-09", 10), jstToUtc("2026-07-09", 22));
    expect(ms).toBe(3_600_000);
  });
});

describe("dailyOccupancy / occupancyForDates", () => {
  const allDay = { open_hour: 0, close_hour: 24 };
  const daytime = { open_hour: 10, close_hour: 22 };

  it("24時間営業: 2時間の予約1件で稼働率 2/24", () => {
    const busy = [range("2026-07-09", 13, "2026-07-09", 15)];
    const [day] = dailyOccupancy(allDay, busy, "2026-07-09", 1);
    expect(day.busyHours).toBe(2);
    expect(day.capacityHours).toBe(24);
    expect(day.rate).toBeCloseTo(2 / 24);
  });

  it("深夜またぎの予約は日ごとに分割して数える", () => {
    // 7/9 23:00 〜 7/10 1:00（JST）
    const busy = [range("2026-07-09", 23, "2026-07-10", 1)];
    const days = dailyOccupancy(allDay, busy, "2026-07-09", 2);
    expect(days[0].busyHours).toBe(1);
    expect(days[1].busyHours).toBe(1);
  });

  it("営業時間外のbusy（終日ブロック）は営業時間の窓で切り取る", () => {
    // 終日ブロック（0〜24時） vs 営業10〜22時 → 埋まりは12h
    const busy = [range("2026-07-09", 0, "2026-07-10", 0)];
    const [day] = dailyOccupancy(daytime, busy, "2026-07-09", 1);
    expect(day.busyHours).toBe(12);
    expect(day.rate).toBe(1);
  });

  it("自社予約とカレンダーbusyが同じ時間帯でも二重に数えない", () => {
    // 同じ予約がDBとGoogleカレンダーの両方に入っているケース
    const busy = [
      range("2026-07-09", 13, "2026-07-09", 15),
      range("2026-07-09", 13, "2026-07-09", 15),
    ];
    const [day] = dailyOccupancy(allDay, busy, "2026-07-09", 1);
    expect(day.busyHours).toBe(2);
  });

  it("期間合計: 7日間の稼働率を合算する", () => {
    const busy = [
      range("2026-07-09", 10, "2026-07-09", 14), // 4h
      range("2026-07-11", 12, "2026-07-11", 15), // 3h
    ];
    const sum = occupancyForDates(daytime, busy, "2026-07-09", 7);
    expect(sum.busyHours).toBe(7);
    expect(sum.capacityHours).toBe(12 * 7);
    expect(sum.rate).toBeCloseTo(7 / 84);
  });

  it("numDaysが0以下なら枠0・稼働率0（月初や1月1日の実行でも落ちない）", () => {
    const sum = occupancyForDates(daytime, [], "2026-07-09", 0);
    expect(sum.busyHours).toBe(0);
    expect(sum.capacityHours).toBe(0);
    expect(sum.rate).toBe(0);
  });
});

describe("judgeAlert", () => {
  it("過去4週平均の50%未満は低稼働（値下げ検討）", () => {
    const alert = judgeAlert(2, 8.5);
    expect(alert.level).toBe("low");
    expect(alert.ratioPercent).toBe(23); // 23.5% → 切り捨て（表示と判定の整合のため）
    expect(alert.message).toContain("値下げ");
  });

  it("表示用%は切り捨てなので境界直下でも判定と矛盾しない（49.875%→49%表示でlow）", () => {
    const alert = judgeAlert(3.99, 8);
    expect(alert.level).toBe("low");
    expect(alert.ratioPercent).toBe(49);
  });

  it("130%以上は好調（静観・値上げ検討）", () => {
    const alert = judgeAlert(12, 8);
    expect(alert.level).toBe("high");
    expect(alert.ratioPercent).toBe(150);
    expect(alert.message).toContain("値上げ");
  });

  it("その間は平常", () => {
    const alert = judgeAlert(7, 8);
    expect(alert.level).toBe("normal");
    expect(alert.ratioPercent).toBe(87); // 87.5% → 切り捨て
  });

  it("ちょうど50%は低稼働ではない（境界は平常側）", () => {
    expect(judgeAlert(4, 8).level).toBe("normal");
  });

  it("過去も来週も予約ゼロは低稼働扱い", () => {
    const alert = judgeAlert(0, 0);
    expect(alert.level).toBe("low");
    expect(alert.ratioPercent).toBeNull();
  });

  it("過去ゼロ→来週予約ありは好調扱い", () => {
    const alert = judgeAlert(3, 0);
    expect(alert.level).toBe("high");
    expect(alert.ratioPercent).toBeNull();
  });
});

describe("weekdayTimeHeatmap", () => {
  const venue = { open_hour: 0, close_hour: 24 };

  it("特定の曜日・時間帯の予約がそのセルの稼働率に反映される", () => {
    const busy = [range("2026-07-09", 10, "2026-07-09", 12)];
    const cells = weekdayTimeHeatmap(venue, busy, "2026-07-10", 1, 2);
    const dow = jstDayOfWeek("2026-07-09");
    const bucketIndex = 5; // 10-12時 = (10 - open_hour) / bucketHours
    expect(cells[dow][bucketIndex].rate).toBe(1);
    expect(cells[dow][bucketIndex].busyHours).toBe(2);
    expect(cells[dow][bucketIndex].sampleDays).toBe(1);
    expect(cells[dow][0].rate).toBe(0); // 同じ曜日の別バケットは空き
  });

  it("fromDate当日の予約は集計対象に含めない（今日を含まない過去N週）", () => {
    const busy = [range("2026-07-10", 10, "2026-07-10", 12)];
    const cells = weekdayTimeHeatmap(venue, busy, "2026-07-10", 1, 2);
    const total = cells.flat().reduce((s, c) => s + c.busyHours, 0);
    expect(total).toBe(0);
  });

  it("バケット数はopen_hour/close_hourとbucketHoursから決まる", () => {
    const cells = weekdayTimeHeatmap(venue, [], "2026-07-10", 1, 2);
    expect(cells).toHaveLength(7);
    expect(cells[0]).toHaveLength(12); // (24-0)/2
  });

  it("sampleDaysは各曜日の出現回数（週numWeeks回）と一致する", () => {
    const cells = weekdayTimeHeatmap(venue, [], "2026-07-10", 4, 2);
    for (const row of cells) {
      for (const cell of row) {
        expect(cell.sampleDays).toBe(4);
        expect(cell.rate).toBe(0); // 予約なしなら稼働率0（capacityHours>0のためnullにはならない）
      }
    }
  });
});
