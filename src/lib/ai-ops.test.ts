import { describe, expect, it } from "vitest";
import { parseNaturalLanguageCommand } from "./ai-ops";

const venues = [
  { slug: "kanda", name: "ブルースペース神田" },
  { slug: "ueno-4a", name: "ブルースペース上野駅前4A" },
  { slug: "keisei-koiwa", name: "ブルースペース京成小岩" },
  { slug: "shirokane-takanawa", name: "ブルースペース白金高輪" },
];

describe("parseNaturalLanguageCommand", () => {
  it("土日祝料金変更を解釈する", () => {
    expect(parseNaturalLanguageCommand("神田の土日祝料金を2,500円にして", venues)).toEqual({
      type: "update_venue_pricing",
      venueSlug: "kanda",
      holidayHourlyPrice: 2500,
    });
  });

  it("平日料金変更を解釈する", () => {
    expect(parseNaturalLanguageCommand("上野4Aの平日料金を1800円に変更", venues)).toEqual({
      type: "update_venue_pricing",
      venueSlug: "ueno-4a",
      weekdayHourlyPrice: 1800,
    });
  });

  it("営業時間変更を解釈する", () => {
    expect(parseNaturalLanguageCommand("京成小岩の営業時間を9時から22時にして", venues)).toEqual({
      type: "update_venue_booking_rules",
      venueSlug: "keisei-koiwa",
      openHour: 9,
      closeHour: 22,
    });
  });

  it("受付停止を解釈する", () => {
    expect(parseNaturalLanguageCommand("白金高輪を受付停止にして", venues)).toEqual({
      type: "update_venue_booking_rules",
      venueSlug: "shirokane-takanawa",
      active: false,
    });
  });

  it("クーポン作成を解釈する", () => {
    expect(parseNaturalLanguageCommand("クーポン REPEAT10 10% 上限100回 最低2000円", venues)).toEqual({
      type: "create_coupon",
      code: "REPEAT10",
      percentOff: 10,
      amountOff: undefined,
      venueSlug: null,
      maxUses: 100,
      minAmount: 2000,
      restrictEmail: null,
      description: "AI設定から作成",
    });
  });

  it("対象拠点がない場合は失敗する", () => {
    expect(() => parseNaturalLanguageCommand("土日祝料金を2500円にして", venues)).toThrow("対象拠点");
  });
});
