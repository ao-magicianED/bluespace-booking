import { describe, expect, it } from "vitest";
import { buildSnapshots, type OccupancyReportData, type VenueOccupancy } from "./occupancy-report";
import type { OccupancySummary } from "./occupancy";

function summary(busyHours: number, capacityHours: number): OccupancySummary {
  return { busyHours, capacityHours, rate: capacityHours > 0 ? busyHours / capacityHours : 0 };
}

/** テストに無関係なフィールドはダミー値で埋めた最小のVenueOccupancy */
function venue(overrides: Partial<VenueOccupancy> & Pick<VenueOccupancy, "id">): VenueOccupancy {
  return {
    slug: "test-venue",
    name: "テスト拠点",
    openHour: 0,
    closeHour: 24,
    calendarOk: true,
    recentDays: [],
    lastWeek: summary(0, 168),
    pastWeeksHours: [0, 0, 0, 0],
    avgWeekHours: 0,
    nextWeek: summary(0, 168),
    nextDays: [],
    yearOwn: summary(0, 0),
    monthOwn: summary(0, 0),
    monthlyOwn: [],
    alert: { level: "normal", ratioPercent: null, message: "" },
    ...overrides,
  };
}

function data(overrides: Partial<OccupancyReportData> = {}): OccupancyReportData {
  return { today: "2026-07-10", bookingsTruncated: false, venues: [], ...overrides };
}

describe("buildSnapshots", () => {
  it("recentDaysをそのままスナップショットに変換する", () => {
    const v = venue({
      id: "venue-1",
      recentDays: [
        { date: "2026-07-09", own: summary(5, 24), combined: summary(8, 24) },
        { date: "2026-07-08", own: summary(3, 24), combined: summary(3, 24) },
      ],
    });
    const snapshots = buildSnapshots(data({ venues: [v] }));
    expect(snapshots).toEqual([
      { venueId: "venue-1", date: "2026-07-09", ownBusyHours: 5, combinedBusyHours: 8, capacityHours: 24 },
      { venueId: "venue-1", date: "2026-07-08", ownBusyHours: 3, combinedBusyHours: 3, capacityHours: 24 },
    ]);
  });

  it("カレンダー取得失敗の拠点はcombinedBusyHoursをnullにする（不完全な値を正常値として残さない）", () => {
    const v = venue({
      id: "venue-2",
      calendarOk: false,
      recentDays: [{ date: "2026-07-09", own: summary(5, 24), combined: summary(5, 24) }],
    });
    const snapshots = buildSnapshots(data({ venues: [v] }));
    expect(snapshots[0].combinedBusyHours).toBeNull();
    expect(snapshots[0].ownBusyHours).toBe(5);
  });

  it("予約取得が打ち切られた回はスナップショットを丸ごと保存しない", () => {
    const v = venue({
      id: "venue-3",
      recentDays: [{ date: "2026-07-09", own: summary(5, 24), combined: summary(5, 24) }],
    });
    const snapshots = buildSnapshots(data({ venues: [v], bookingsTruncated: true }));
    expect(snapshots).toEqual([]);
  });
});
