import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  breakdownAfterDayTypeChange,
  calcChangeAmounts,
  classifyChange,
  resolveChangeDayTypes,
  type ChangeDayTypes,
} from "./change-request";
import type { Booking, Venue } from "./types";

// getHolidaySetだけモック（DB接続を避ける）。isHolidayDate等は実物を使う
const h = vi.hoisted(() => ({
  holidays: new Set<string>(),
  getHolidaySet: vi.fn(),
}));
vi.mock("./holidays", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./holidays")>();
  return { ...actual, getHolidaySet: h.getHolidaySet };
});

/** JSTの日付＋時（小数可）からDateを作る */
const jst = (dateStr: string, hour: number) =>
  new Date(new Date(`${dateStr}T00:00:00+09:00`).getTime() + hour * 60 * 60 * 1000);

const range = (dateStr: string, startHour: number, endHour: number) => ({
  start: jst(dateStr, startHour),
  end: jst(dateStr, endHour),
});

// 平日1,900円/祝日2,300円の拠点（設計レビューの実例値）
const venue = {
  hourly_price: 1900,
  holiday_hourly_price: 2300,
  cancellation_policy: null,
} as unknown as Venue;

// 2026-09-01(火) 10:00-13:00 JST・3h・平日単価スナップショット
function makeBooking(overrides: Record<string, unknown> = {}): Booking {
  return {
    id: "b1",
    start_at: jst("2026-09-01", 10).toISOString(),
    end_at: jst("2026-09-01", 13).toISOString(),
    total_amount: 5700,
    adjusted_total: null,
    extra_paid_amount: 0,
    refunded_amount: 0,
    price_breakdown: { rule: "v2", pricePerHour: 1900, dayType: "weekday", hours: 3, options: [] },
    ...overrides,
  } as unknown as Booking;
}

const SAME_DAY: ChangeDayTypes = { previous: "weekday", next: "weekday" };
const TO_HOLIDAY: ChangeDayTypes = { previous: "weekday", next: "holiday" };
const TO_WEEKDAY: ChangeDayTypes = { previous: "holiday", next: "weekday" };

// キャンセル料0%区間（12日前）/ 50%区間（3日前）
const REFUNDABLE_BASIS = jst("2026-08-20", 10);
const NON_REFUNDABLE_BASIS = jst("2026-08-29", 10);

beforeEach(() => {
  h.holidays = new Set();
  h.getHolidaySet.mockClear();
  h.getHolidaySet.mockImplementation(async () => h.holidays);
});

describe("classifyChange", () => {
  it("同一開始で終了が後ろ=extend、前=shorten、開始が動く=shift", () => {
    const prev = range("2026-09-01", 10, 13);
    expect(classifyChange(prev, range("2026-09-01", 10, 14))).toBe("extend");
    expect(classifyChange(prev, range("2026-09-01", 10, 12))).toBe("shorten");
    expect(classifyChange(prev, range("2026-09-01", 11, 14))).toBe("shift");
    expect(classifyChange(prev, range("2026-09-05", 10, 13))).toBe("shift");
  });
});

describe("calcChangeAmounts 延長", () => {
  it("スナップショット単価×時間差で追加請求", () => {
    const r = calcChangeAmounts(
      makeBooking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 14),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.kind).toBe("extend");
    expect(r.extraAmount).toBe(1900);
    expect(r.newAmount).toBe(7600);
    expect(r.refundAmount).toBe(0);
  });

  it("per_hourオプションの時間単価も延長差額に含める（per_bookingは含めない）", () => {
    const booking = makeBooking({
      total_amount: 6500,
      price_breakdown: {
        rule: "v2", pricePerHour: 1900, dayType: "weekday", hours: 3,
        options: [
          { id: "h1", name: "ヒーター", amount: 300, unitPrice: 100, priceUnit: "per_hour" },
          { id: "p1", name: "プロジェクター", amount: 500, unitPrice: 500, priceUnit: "per_booking" },
        ],
      },
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 14),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.extraAmount).toBe(2000); // 1900 + 100
    expect(r.newAmount).toBe(8500);
  });

  it("旧スナップショット（unitPrice無し）は従来通り基本単価のみ（後方互換）", () => {
    const booking = makeBooking({
      total_amount: 6500,
      price_breakdown: {
        rule: "v2", pricePerHour: 1900, dayType: "weekday", hours: 3,
        options: [{ id: "h1", name: "ヒーター", amount: 300 }],
      },
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 14),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.extraAmount).toBe(1900);
  });

  it("30分延長（0.5h）も正しく丸める", () => {
    const r = calcChangeAmounts(
      makeBooking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 13.5),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.extraAmount).toBe(950);
  });

  it("奇数円単価×0.5hの丸めが延長と短縮で対称（1円ずれない）", () => {
    const oddVenue = { ...venue, hourly_price: 1905 } as unknown as Venue;
    const booking = makeBooking({
      total_amount: 5715,
      price_breakdown: { rule: "v2", pricePerHour: 1905, dayType: "weekday", hours: 3, options: [] },
    });
    const ext = calcChangeAmounts(
      booking, oddVenue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 13.5),
      REFUNDABLE_BASIS, SAME_DAY
    );
    const longerBooking = makeBooking({
      end_at: jst("2026-09-01", 13.5).toISOString(),
      total_amount: 6668,
      price_breakdown: { rule: "v2", pricePerHour: 1905, dayType: "weekday", hours: 3.5, options: [] },
    });
    const sho = calcChangeAmounts(
      longerBooking, oddVenue,
      range("2026-09-01", 10, 13.5), range("2026-09-01", 10, 13),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(ext.extraAmount).toBe(953);
    expect(sho.refundAmount).toBe(953);
  });
});

describe("calcChangeAmounts 短縮", () => {
  it("全額返金区間なら差額返金（per_hourオプション込み）", () => {
    const booking = makeBooking({
      total_amount: 6000,
      price_breakdown: {
        rule: "v2", pricePerHour: 1900, dayType: "weekday", hours: 3,
        options: [{ id: "h1", name: "ヒーター", amount: 300, unitPrice: 100, priceUnit: "per_hour" }],
      },
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 12),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.kind).toBe("shorten");
    expect(r.refundAmount).toBe(2000); // 1900 + 100
    expect(r.newAmount).toBe(4000);
  });

  it("キャンセル料有料区間なら料金据え置き", () => {
    const r = calcChangeAmounts(
      makeBooking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 12),
      NON_REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.refundAmount).toBe(0);
    expect(r.newAmount).toBe(5700);
  });

  it("返金は実効金額を上限にする（クーポン等で支払額が単価×時間より低い場合）", () => {
    const booking = makeBooking({ total_amount: 700 }); // クーポン適用で¥700しか払っていない想定
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 12),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.refundAmount).toBe(700); // 単価上は1,900だが支払額を超えない
    expect(r.newAmount).toBe(0);
  });
});

describe("calcChangeAmounts 別日シフト（dayType変更）", () => {
  it("平日→祝日の同時間数シフトは単価差×時間数を追加請求（1,900→2,300×3h=1,200）", () => {
    const r = calcChangeAmounts(
      makeBooking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-05", 10, 13),
      REFUNDABLE_BASIS, TO_HOLIDAY
    );
    expect(r.kind).toBe("shift");
    expect(r.extraAmount).toBe(1200);
    expect(r.newAmount).toBe(6900);
    expect(r.dayTypeChanged).toBe(true);
    expect(r.pricePerHour).toBe(1900);
    expect(r.nextPricePerHour).toBe(2300);
  });

  it("祝日→平日の同時間数シフトは全額返金区間なら差額返金", () => {
    const booking = makeBooking({
      start_at: jst("2026-09-05", 10).toISOString(),
      end_at: jst("2026-09-05", 13).toISOString(),
      total_amount: 6900,
      price_breakdown: { rule: "v2", pricePerHour: 2300, dayType: "holiday", hours: 3, options: [] },
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-05", 10, 13), range("2026-09-08", 10, 13),
      REFUNDABLE_BASIS, TO_WEEKDAY
    );
    expect(r.refundAmount).toBe(1200);
    expect(r.newAmount).toBe(5700);
  });

  it("祝日→平日でもキャンセル料有料区間なら据え置き", () => {
    const booking = makeBooking({
      start_at: jst("2026-09-05", 10).toISOString(),
      end_at: jst("2026-09-05", 13).toISOString(),
      total_amount: 6900,
      price_breakdown: { rule: "v2", pricePerHour: 2300, dayType: "holiday", hours: 3, options: [] },
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-05", 10, 13), range("2026-09-08", 10, 13),
      jst("2026-09-03", 10), TO_WEEKDAY
    );
    expect(r.refundAmount).toBe(0);
    expect(r.newAmount).toBe(6900);
  });

  it("平日→祝日で時間数も増える場合は両方の差額を合算（2,300×4h−1,900×3h=3,500）", () => {
    const r = calcChangeAmounts(
      makeBooking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-05", 10, 14),
      REFUNDABLE_BASIS, TO_HOLIDAY
    );
    expect(r.extraAmount).toBe(3500);
    expect(r.newAmount).toBe(9200);
  });

  it("holiday_hourly_price未設定の拠点は祝日シフトでも据え置き", () => {
    const flatVenue = { ...venue, holiday_hourly_price: null } as unknown as Venue;
    const r = calcChangeAmounts(
      makeBooking(), flatVenue,
      range("2026-09-01", 10, 13), range("2026-09-05", 10, 13),
      REFUNDABLE_BASIS, TO_HOLIDAY
    );
    expect(r.extraAmount).toBe(0);
    expect(r.newAmount).toBe(5700);
  });

  it("dayType不変の別日シフト（同時間数）は従来通り据え置き", () => {
    const r = calcChangeAmounts(
      makeBooking(), venue,
      range("2026-09-01", 10, 13), range("2026-09-02", 10, 13),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.extraAmount).toBe(0);
    expect(r.refundAmount).toBe(0);
    expect(r.newAmount).toBe(5700);
    expect(r.dayTypeChanged).toBe(false);
  });

  it("スナップショットにpricePerHourが無い場合は変更前dayTypeのvenue単価で代替", () => {
    const booking = makeBooking({
      start_at: jst("2026-09-05", 10).toISOString(),
      end_at: jst("2026-09-05", 13).toISOString(),
      total_amount: 6900,
      price_breakdown: null,
    });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-05", 10, 13), range("2026-09-08", 10, 13),
      REFUNDABLE_BASIS, TO_WEEKDAY
    );
    expect(r.pricePerHour).toBe(2300);
    expect(r.nextPricePerHour).toBe(1900);
    expect(r.refundAmount).toBe(1200);
  });
});

describe("calcChangeAmounts adjusted_total", () => {
  it("調整済み金額（adjusted_total）を基準に増減する", () => {
    const booking = makeBooking({ adjusted_total: 5000 });
    const r = calcChangeAmounts(
      booking, venue,
      range("2026-09-01", 10, 13), range("2026-09-01", 10, 14),
      REFUNDABLE_BASIS, SAME_DAY
    );
    expect(r.newAmount).toBe(6900); // 5000 + 1900
  });
});

describe("breakdownAfterDayTypeChange", () => {
  it("dayTypeが変わらなければnull（スナップショット据え置き）", () => {
    expect(
      breakdownAfterDayTypeChange(makeBooking(), venue, SAME_DAY, jst("2026-09-02", 10))
    ).toBeNull();
  });

  it("平日→祝日の確定でdayType・単価・日付を更新し、他のフィールドは保持する", () => {
    const booking = makeBooking({
      price_breakdown: {
        rule: "v2", pricePerHour: 1900, dayType: "weekday", hours: 3, date: "2026-09-01",
        options: [{ id: "h1", name: "ヒーター", amount: 300, unitPrice: 100, priceUnit: "per_hour" }],
      },
    });
    const bd = breakdownAfterDayTypeChange(booking, venue, TO_HOLIDAY, jst("2026-09-05", 10));
    expect(bd).toMatchObject({
      rule: "v2",
      dayType: "holiday",
      pricePerHour: 2300,
      date: "2026-09-05",
      hours: 3,
    });
    expect((bd as { options: unknown[] }).options).toHaveLength(1);
  });

  it("holiday_hourly_price未設定なら平日単価のまま更新する", () => {
    const flatVenue = { ...venue, holiday_hourly_price: null } as unknown as Venue;
    const bd = breakdownAfterDayTypeChange(makeBooking(), flatVenue, TO_HOLIDAY, jst("2026-09-05", 10));
    expect(bd).toMatchObject({ dayType: "holiday", pricePerHour: 1900 });
  });
});

describe("resolveChangeDayTypes", () => {
  it("同一日の変更はスナップショットのdayTypeを使い、祝日DBを引かない", async () => {
    const dt = await resolveChangeDayTypes(makeBooking(), jst("2026-09-01", 11));
    expect(dt).toEqual({ previous: "weekday", next: "weekday" });
    expect(h.getHolidaySet).not.toHaveBeenCalled();
  });

  it("平日→土曜へのシフトはnext=holiday", async () => {
    const dt = await resolveChangeDayTypes(makeBooking(), jst("2026-09-05", 10));
    expect(dt).toEqual({ previous: "weekday", next: "holiday" });
  });

  it("平日→祝日テーブル登録日へのシフトはnext=holiday", async () => {
    h.holidays = new Set(["2026-09-22"]);
    const dt = await resolveChangeDayTypes(makeBooking(), jst("2026-09-22", 10));
    expect(dt).toEqual({ previous: "weekday", next: "holiday" });
  });

  it("変更前はスナップショットのdayTypeを優先する（祝日テーブルが後から変わっても請求根拠を維持）", async () => {
    const booking = makeBooking({
      price_breakdown: { rule: "v2", pricePerHour: 2300, dayType: "holiday", hours: 3, options: [] },
    });
    const dt = await resolveChangeDayTypes(booking, jst("2026-09-02", 10));
    expect(dt).toEqual({ previous: "holiday", next: "weekday" });
  });

  it("スナップショットが無い場合は変更前もカレンダーから判定する", async () => {
    const booking = makeBooking({
      start_at: jst("2026-09-05", 10).toISOString(),
      end_at: jst("2026-09-05", 13).toISOString(),
      price_breakdown: null,
    });
    const dt = await resolveChangeDayTypes(booking, jst("2026-09-08", 10));
    expect(dt).toEqual({ previous: "holiday", next: "weekday" });
  });
});
