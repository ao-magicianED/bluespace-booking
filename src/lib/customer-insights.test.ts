import { describe, expect, it } from "vitest";
import {
  computeCustomerInsights,
  dayTypeOf,
  leadTimeBucket,
  parseEmailList,
  purposeBucket,
  startHourBucket,
  type InsightBooking,
} from "./customer-insights";

/** テストに無関係なフィールドはダミー値で埋めた予約1件 */
function booking(overrides: Partial<InsightBooking> = {}): InsightBooking {
  return {
    customer_email: "a@example.com",
    user_id: null,
    customer_type: "individual",
    party_size: null,
    purpose: "",
    // 2026-07-06(月) JST 10:00〜12:00、予約は5日前
    start_at: "2026-07-06T01:00:00.000Z",
    end_at: "2026-07-06T03:00:00.000Z",
    created_at: "2026-07-01T01:00:00.000Z",
    venue_name: "拠点A",
    revenue: 3000,
    ...overrides,
  };
}

describe("parseEmailList", () => {
  it("カンマ区切りを trim・小文字化し、空要素は捨てる", () => {
    expect(parseEmailList(" Owner@Example.com, staff@example.com ,,")).toEqual(
      new Set(["owner@example.com", "staff@example.com"])
    );
  });

  it("未設定・空文字は空Set", () => {
    expect(parseEmailList(undefined).size).toBe(0);
    expect(parseEmailList("").size).toBe(0);
    expect(parseEmailList(null).size).toBe(0);
  });
});

describe("leadTimeBucket", () => {
  const start = "2026-07-20T01:00:00.000Z";
  const before = (hours: number) => new Date(Date.parse(start) - hours * 3600000).toISOString();

  it("24時間未満は当日、24〜72時間未満は1〜2日前", () => {
    expect(leadTimeBucket(before(0.5), start)).toBe("当日（24時間以内）");
    expect(leadTimeBucket(before(23.9), start)).toBe("当日（24時間以内）");
    expect(leadTimeBucket(before(24), start)).toBe("1〜2日前");
    expect(leadTimeBucket(before(71.9), start)).toBe("1〜2日前");
  });

  it("3〜13日前と14日以上前の境界", () => {
    expect(leadTimeBucket(before(72), start)).toBe("3〜13日前");
    expect(leadTimeBucket(before(14 * 24 - 1), start)).toBe("3〜13日前");
    expect(leadTimeBucket(before(14 * 24), start)).toBe("14日以上前");
  });

  it("利用開始より後に作られた予約（手入力等）は当日扱い", () => {
    expect(leadTimeBucket(before(-5), start)).toBe("当日（24時間以内）");
  });
});

describe("startHourBucket（JST基準）", () => {
  it.each([
    ["2026-07-05T15:00:00.000Z", "〜8時"], // JST 0:00
    ["2026-07-05T23:30:00.000Z", "〜8時"], // JST 8:30
    ["2026-07-06T00:00:00.000Z", "9〜11時"], // JST 9:00
    ["2026-07-06T02:59:00.000Z", "9〜11時"], // JST 11:59
    ["2026-07-06T03:00:00.000Z", "12〜16時"], // JST 12:00
    ["2026-07-06T07:30:00.000Z", "12〜16時"], // JST 16:30
    ["2026-07-06T08:00:00.000Z", "17〜20時"], // JST 17:00
    ["2026-07-06T11:30:00.000Z", "17〜20時"], // JST 20:30
    ["2026-07-06T12:00:00.000Z", "21時〜"], // JST 21:00
  ])("%s → %s", (startAt, want) => {
    expect(startHourBucket(startAt)).toBe(want);
  });
});

describe("dayTypeOf", () => {
  it("JSTの曜日で判定する（UTCでは日曜でもJSTで月曜なら平日）", () => {
    // UTC 7/5(日) 15:30 = JST 7/6(月) 0:30
    expect(dayTypeOf("2026-07-05T15:30:00.000Z", new Set())).toBe("平日");
    // UTC 7/4(土) 14:00 = JST 7/4(土) 23:00
    expect(dayTypeOf("2026-07-04T14:00:00.000Z", new Set())).toBe("土日祝");
  });

  it("祝日Setに含まれる平日は土日祝", () => {
    // 2026-07-20(月) 海の日
    expect(dayTypeOf("2026-07-20T01:00:00.000Z", new Set())).toBe("平日");
    expect(dayTypeOf("2026-07-20T01:00:00.000Z", new Set(["2026-07-20"]))).toBe("土日祝");
  });
});

describe("purposeBucket", () => {
  it("カテゴリ・自由記述のみ・未記入に振り分ける", () => {
    expect(purposeBucket("[撮影・配信] 商品撮影")).toBe("撮影・配信");
    expect(purposeBucket("[その他]")).toBe("その他");
    expect(purposeBucket("会議です")).toBe("自由記述のみ");
    expect(purposeBucket("[社内] 会議")).toBe("自由記述のみ");
    expect(purposeBucket("")).toBe("未記入");
    expect(purposeBucket("  ")).toBe("未記入");
    expect(purposeBucket(null)).toBe("未記入");
  });
});

describe("computeCustomerInsights", () => {
  it("空配列でも落ちず、平均・率はnull/0", () => {
    const r = computeCustomerInsights([]);
    expect(r.totalBookings).toBe(0);
    expect(r.excluded).toEqual({ total: 0, internalEmail: 0, testPurpose: 0 });
    expect(r.customers).toEqual({ unique: 0, repeaters: 0, repeatRate: null, medianDaysToSecondVisit: null });
    for (const s of [r.segments.初回, r.segments.リピート]) {
      expect(s.bookings).toBe(0);
      expect(s.share).toBe(0);
      expect(s.avgRevenue).toBe(0);
      expect(s.avgPartySize).toBeNull();
      expect(s.avgHours).toBeNull();
      expect(s.venues).toEqual([]);
    }
  });

  it("社内メール（大文字小文字・前後空白を無視）とテスト目的の予約を除外して件数を報告する", () => {
    const rows = [
      booking({ customer_email: " Owner@Example.com " }),
      booking({ customer_email: "owner@example.com", purpose: "テスト" }), // 両方該当 → 社内メールとして1回だけ数える
      booking({ customer_email: "x@example.com", purpose: "E2E run" }),
      booking({ customer_email: "y@example.com", purpose: "[その他] 動作確認" }),
      booking({ customer_email: "z@example.com", purpose: "TEST" }),
      booking({ customer_email: "real@example.com", purpose: "[会議・打ち合わせ] 定例" }),
    ];
    const r = computeCustomerInsights(rows, { excludedEmails: parseEmailList("owner@example.com") });
    expect(r.excluded).toEqual({ total: 5, internalEmail: 2, testPurpose: 3 });
    expect(r.totalBookings).toBe(1);
    expect(r.customers.unique).toBe(1);
  });

  it("除外メールSetが未正規化でも一致させる", () => {
    const r = computeCustomerInsights([booking({ customer_email: "owner@example.com" })], {
      excludedEmails: new Set([" OWNER@example.com "]),
    });
    expect(r.excluded.internalEmail).toBe(1);
    expect(r.totalBookings).toBe(0);
  });

  it("顧客ごとに created_at 順で1件目=初回・2件目以降=リピート（利用日順ではない）", () => {
    const rows = [
      // 先に予約した方（利用日は後）が初回
      booking({
        customer_email: "A@example.com",
        created_at: "2026-07-01T00:00:00.000Z",
        start_at: "2026-07-20T01:00:00.000Z",
        end_at: "2026-07-20T02:00:00.000Z",
        revenue: 1000,
      }),
      booking({
        customer_email: "a@example.com",
        created_at: "2026-07-02T00:00:00.000Z",
        start_at: "2026-07-05T01:00:00.000Z",
        end_at: "2026-07-05T05:00:00.000Z",
        revenue: 4000,
      }),
      booking({ customer_email: "a@example.com", created_at: "2026-07-03T00:00:00+00:00", revenue: 2000 }),
    ];
    const r = computeCustomerInsights(rows);
    expect(r.segments.初回.bookings).toBe(1);
    expect(r.segments.初回.revenue).toBe(1000);
    expect(r.segments.初回.avgHours).toBe(1);
    expect(r.segments.リピート.bookings).toBe(2);
    expect(r.segments.リピート.avgRevenue).toBe(3000);
    expect(r.segments.初回.share).toBeCloseTo(1 / 3);
    expect(r.segments.リピート.share).toBeCloseTo(2 / 3);
    expect(r.customers.unique).toBe(1);
  });

  it("同じJST日付の予約だけの顧客はリピーターに数えない（予約単位ではリピート扱い）", () => {
    const rows = [
      booking({ customer_email: "same@example.com", start_at: "2026-07-06T01:00:00.000Z" }),
      booking({
        customer_email: "same@example.com",
        created_at: "2026-07-01T02:00:00.000Z",
        start_at: "2026-07-06T14:00:00.000Z", // JST 7/6 23:00（同日）
        end_at: "2026-07-06T14:30:00.000Z",
      }),
    ];
    const r = computeCustomerInsights(rows);
    expect(r.customers).toEqual({ unique: 1, repeaters: 0, repeatRate: 0, medianDaysToSecondVisit: null });
    expect(r.segments.リピート.bookings).toBe(1);
  });

  it("リピーター率と1回目→2回目（別日）の間隔の中央値", () => {
    const visit = (email: string, jstDate: string, createdDay: string) =>
      booking({
        customer_email: email,
        start_at: `${jstDate}T10:00:00+09:00`,
        end_at: `${jstDate}T12:00:00+09:00`,
        created_at: `${createdDay}T09:00:00+09:00`,
      });
    const rows = [
      // p: 3日後に再訪（同日の追加予約は間隔計算に使わない）
      visit("p@example.com", "2026-07-01", "2026-06-20"),
      visit("p@example.com", "2026-07-01", "2026-06-21"),
      visit("p@example.com", "2026-07-04", "2026-06-22"),
      // q: 10日後に再訪、さらにその後も利用
      visit("q@example.com", "2026-07-01", "2026-06-20"),
      visit("q@example.com", "2026-07-11", "2026-06-25"),
      visit("q@example.com", "2026-07-30", "2026-07-20"),
      // r: 20日後に再訪
      visit("r@example.com", "2026-07-01", "2026-06-20"),
      visit("r@example.com", "2026-07-21", "2026-07-10"),
      // s: 1回のみ
      visit("s@example.com", "2026-07-01", "2026-06-20"),
    ];
    const r = computeCustomerInsights(rows);
    expect(r.customers.unique).toBe(4);
    expect(r.customers.repeaters).toBe(3);
    expect(r.customers.repeatRate).toBe(0.75);
    expect(r.customers.medianDaysToSecondVisit).toBe(10);
    expect(r.segments.初回.bookings).toBe(4);
    expect(r.segments.リピート.bookings).toBe(5);

    // 偶数人なら中央2値の平均（3日と10日 → 6.5日）
    const r2 = computeCustomerInsights(rows.filter((b) => b.customer_email !== "r@example.com"));
    expect(r2.customers.medianDaysToSecondVisit).toBe(6.5);
  });

  it("人数の平均は入力ありの予約だけで計算し、母数を返す", () => {
    const rows = [
      booking({ customer_email: "a@example.com", party_size: 2 }),
      booking({ customer_email: "b@example.com", party_size: 5 }),
      booking({ customer_email: "c@example.com", party_size: null }),
    ];
    const s = computeCustomerInsights(rows).segments.初回;
    expect(s.avgPartySize).toBe(3.5);
    expect(s.partySizeN).toBe(2);
  });

  it("会員・法人・目的・拠点・曜日・時間帯・リードタイムを区分ごとに数える", () => {
    const rows = [
      booking({
        customer_email: "a@example.com",
        user_id: "u1",
        customer_type: "corporate",
        purpose: "[会議・打ち合わせ] 定例",
        venue_name: "拠点B",
      }),
      booking({ customer_email: "b@example.com", purpose: "ダンス練習", venue_name: "拠点A" }),
      booking({
        customer_email: "c@example.com",
        purpose: "",
        venue_name: "拠点B",
        // JST 7/20(祝) 21:00開始、予約は2時間前
        start_at: "2026-07-20T12:00:00.000Z",
        end_at: "2026-07-20T13:00:00.000Z",
        created_at: "2026-07-20T10:00:00.000Z",
      }),
    ];
    const s = computeCustomerInsights(rows, { holidaySet: new Set(["2026-07-20"]) }).segments.初回;
    expect(s.members).toBe(1);
    expect(s.corporate).toBe(1);
    expect(s.purpose["会議・打ち合わせ"]).toBe(1);
    expect(s.purpose["自由記述のみ"]).toBe(1);
    expect(s.purpose["未記入"]).toBe(1);
    expect(s.purpose["撮影・配信"]).toBe(0);
    expect(s.venues).toEqual([
      { name: "拠点B", count: 2 },
      { name: "拠点A", count: 1 },
    ]);
    expect(s.dayType).toEqual({ 平日: 2, 土日祝: 1 });
    expect(s.startHour["9〜11時"]).toBe(2);
    expect(s.startHour["21時〜"]).toBe(1);
    expect(s.leadTime["3〜13日前"]).toBe(2);
    expect(s.leadTime["当日（24時間以内）"]).toBe(1);
  });

  it("入力の並び順に依存しない（決定的）", () => {
    const rows = [
      booking({ customer_email: "a@example.com", created_at: "2026-07-01T00:00:00.000Z", revenue: 100 }),
      booking({
        customer_email: "a@example.com",
        created_at: "2026-07-02T00:00:00.000Z",
        start_at: "2026-07-10T01:00:00.000Z",
        end_at: "2026-07-10T02:00:00.000Z",
        revenue: 200,
      }),
      booking({ customer_email: "b@example.com", revenue: 300 }),
    ];
    const forward = computeCustomerInsights(rows);
    const reversed = computeCustomerInsights([...rows].reverse());
    expect(reversed).toEqual(forward);
    expect(forward.segments.初回.revenue).toBe(400);
    expect(forward.segments.リピート.revenue).toBe(200);
  });
});
