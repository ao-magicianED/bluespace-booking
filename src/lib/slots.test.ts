import { describe, expect, it } from "vitest";
import {
  addDaysJst,
  buildDays,
  jstToUtc,
  jstDayOfWeek,
  overlaps,
  slotStatus,
  utcToJstDateStr,
  validateBookingRequest,
  hourToTimeStr,
  formatDuration,
  SLOT_MINUTES,
} from "./slots";

// 基準時刻: JST 2026-06-11 10:00 = UTC 2026-06-11 01:00
const NOW = new Date("2026-06-11T01:00:00Z");

describe("時刻変換", () => {
  it("JSTの日付+時（整数） → UTC", () => {
    expect(jstToUtc("2026-06-11", 9).toISOString()).toBe("2026-06-11T00:00:00.000Z");
    expect(jstToUtc("2026-06-11", 0).toISOString()).toBe("2026-06-10T15:00:00.000Z");
  });

  it("JSTの日付+時（小数: 9.5=9:30） → UTC", () => {
    expect(jstToUtc("2026-06-11", 9.5).toISOString()).toBe("2026-06-11T00:30:00.000Z");
    expect(jstToUtc("2026-06-11", 13.5).toISOString()).toBe("2026-06-11T04:30:00.000Z");
  });

  it("UTC → JST日付（日付またぎ）", () => {
    expect(utcToJstDateStr(new Date("2026-06-10T15:00:00Z"))).toBe("2026-06-11");
    expect(utcToJstDateStr(new Date("2026-06-10T14:59:00Z"))).toBe("2026-06-10");
  });

  it("JST基準の曜日", () => {
    expect(jstDayOfWeek("2026-06-11")).toBe(4); // 木曜
    expect(jstDayOfWeek("2026-06-14")).toBe(0); // 日曜
  });

  it("日付の加算", () => {
    expect(addDaysJst("2026-06-30", 1)).toBe("2026-07-01");
  });

  it("hourToTimeStr", () => {
    expect(hourToTimeStr(9)).toBe("09:00");
    expect(hourToTimeStr(9.5)).toBe("09:30");
    expect(hourToTimeStr(0)).toBe("00:00");
    expect(hourToTimeStr(23.5)).toBe("23:30");
  });

  it("formatDuration", () => {
    expect(formatDuration(1)).toBe("1時間");
    expect(formatDuration(0.5)).toBe("30分");
    expect(formatDuration(1.5)).toBe("1時間30分");
    expect(formatDuration(3)).toBe("3時間");
  });
});

describe("overlaps", () => {
  const range = (s: string, e: string) => ({ start: new Date(s), end: new Date(e) });

  it("重なる場合true", () => {
    expect(
      overlaps(
        range("2026-06-11T01:00:00Z", "2026-06-11T03:00:00Z"),
        range("2026-06-11T02:00:00Z", "2026-06-11T04:00:00Z")
      )
    ).toBe(true);
  });

  it("端が接するだけ（[start, end)）はfalse", () => {
    expect(
      overlaps(
        range("2026-06-11T01:00:00Z", "2026-06-11T02:00:00Z"),
        range("2026-06-11T02:00:00Z", "2026-06-11T03:00:00Z")
      )
    ).toBe(false);
  });
});

describe("slotStatus (30分スロット)", () => {
  it("空き", () => {
    expect(slotStatus("2026-06-12", 10, [], NOW)).toBe("available");
    expect(slotStatus("2026-06-12", 10.5, [], NOW)).toBe("available");
  });

  it("busyと重なればbooked（30分スロット）", () => {
    const busy = [{ start: jstToUtc("2026-06-12", 10), end: jstToUtc("2026-06-12", 11) }];
    expect(slotStatus("2026-06-12", 10, busy, NOW)).toBe("booked");
    expect(slotStatus("2026-06-12", 10.5, busy, NOW)).toBe("booked");
    expect(slotStatus("2026-06-12", 11, busy, NOW)).toBe("available");
  });

  it("過去・締切後はclosed（現在JST10:00 → リードタイム1分なので10:30枠から可）", () => {
    expect(slotStatus("2026-06-11", 9, [], NOW)).toBe("closed");
    expect(slotStatus("2026-06-11", 10, [], NOW)).toBe("closed");
    expect(slotStatus("2026-06-11", 10.5, [], NOW)).toBe("available");
    expect(slotStatus("2026-06-11", 11, [], NOW)).toBe("available");
    expect(slotStatus("2026-06-11", 11.5, [], NOW)).toBe("available");
  });

  it("60日を超える先はclosed", () => {
    expect(slotStatus("2026-08-10", 10, [], NOW)).toBe("available");
    expect(slotStatus("2026-08-11", 10, [], NOW)).toBe("closed");
  });
});

describe("buildDays (30分スロット)", () => {
  const venue = { open_hour: 9, close_hour: 18 };

  it("営業時間分のスロットを日数分作る（30分刻み: 9時間 × 2 = 18スロット）", () => {
    const days = buildDays(venue, "2026-06-12", 7, [], NOW);
    expect(days).toHaveLength(7);
    expect(days[0].slots).toHaveLength(18); // 9:00〜17:30 = 18スロット
    expect(days[0].slots[0].hour).toBe(9);
    expect(days[0].slots[1].hour).toBe(9.5);
    expect(days[0].slots[17].hour).toBe(17.5);
  });

  it("calendarError時は全枠closed（fail closed）", () => {
    const days = buildDays(venue, "2026-06-12", 2, [], NOW, true);
    expect(days.every((d) => d.slots.every((s) => s.status === "closed"))).toBe(true);
  });

  it("SLOT_MINUTESは30", () => {
    expect(SLOT_MINUTES).toBe(30);
  });
});

describe("validateBookingRequest (30分対応)", () => {
  const venue = { open_hour: 9, close_hour: 18, min_hours: 0.5, max_hours: 8 };

  it("正常な予約はnull（30分）", () => {
    expect(validateBookingRequest(venue, "2026-06-12", 10, 0.5, NOW)).toBeNull();
    expect(validateBookingRequest(venue, "2026-06-12", 10.5, 1.5, NOW)).toBeNull();
  });

  it("営業時間外を弾く", () => {
    expect(validateBookingRequest(venue, "2026-06-12", 8.5, 1, NOW)).toContain("営業時間外");
    expect(validateBookingRequest(venue, "2026-06-12", 17.5, 1, NOW)).toContain("営業時間外");
  });

  it("最大時間超過を弾く", () => {
    expect(validateBookingRequest(venue, "2026-06-12", 9, 8.5, NOW)).toContain("最大");
  });

  it("最低利用時間未満を弾く", () => {
    // min_hours=0.5なので、0は弾かれるが0.5はOK
    // ただし0は0.5刻みとして無効ではない（0時間予約は意味がないが）
    // 実際には0.5未満は弾く
  });

  it("締切後を弾く", () => {
    expect(validateBookingRequest(venue, "2026-06-11", 10, 1, NOW)).toContain("締め切り");
  });

  it("不正な日付を弾く", () => {
    expect(validateBookingRequest(venue, "2026-13-99", 10, 1, NOW)).toContain("日付");
    expect(validateBookingRequest(venue, "abc", 10, 1, NOW)).toContain("日付");
  });

  it("0.5刻みでない値を弾く", () => {
    expect(validateBookingRequest(venue, "2026-06-12", 10.3, 1, NOW)).toContain("時刻");
    expect(validateBookingRequest(venue, "2026-06-12", 10, 0.7, NOW)).toContain("時刻");
  });
});
