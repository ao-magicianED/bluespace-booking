import { describe, expect, it } from "vitest";
import { COMMON_FAQS, venueContents } from "@/content/venues";
import {
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildVenueJsonLd,
  buildWebSiteJsonLd,
  organizationId,
  serializeJsonLd,
} from "./structured-data";
import {
  describeDayBands,
  describeHourlyPrice,
  describeOpeningHours,
  formatHours,
  isStandardAmenity,
} from "./venue-facts";

const SITE = "https://bluespacerental.com";

describe("buildVenueJsonLd", () => {
  for (const c of Object.values(venueContents)) {
    it(`${c.slug}: GBP・定員・広さを持ち、aggregateRating を出さない`, () => {
      const ld = buildVenueJsonLd({ site: SITE, content: c, priceRange: "¥1,000〜¥2,000/時間", openHour: 0, closeHour: 24 });
      expect(ld["@type"]).toBe("LocalBusiness");
      expect(ld.url).toBe(`${SITE}/${c.slug}`);
      // 自社レビューは星表示の対象外（自己宣伝レビュー）のため付けない
      expect(ld).not.toHaveProperty("aggregateRating");
      expect(ld.maximumAttendeeCapacity).toBe(c.maxCapacity);
      expect(ld.parentOrganization).toEqual({ "@id": organizationId(SITE) });
      if (c.gbpCid) {
        expect(ld.sameAs).toEqual([`https://maps.google.com/?cid=${c.gbpCid}`]);
        expect(ld.hasMap).toBe(`https://maps.google.com/?cid=${c.gbpCid}`);
      }
      // 画像は絶対URL
      for (const img of ld.image as string[]) expect(img).toMatch(/^https:\/\//);
    });
  }

  it("capacityShort の「最大N名」と maxCapacity が一致する（二重管理のずれ検知）", () => {
    for (const c of Object.values(venueContents)) {
      const m = c.capacityShort.match(/最大(\d+)名/);
      expect(m, `${c.slug}: capacityShort に「最大N名」がない`).not.toBeNull();
      expect(Number(m![1]), c.slug).toBe(c.maxCapacity);
    }
  });

  it("GBPのCIDは数字のみ（URLに直接埋め込むため）", () => {
    for (const c of Object.values(venueContents)) {
      if (c.gbpCid) expect(c.gbpCid, c.slug).toMatch(/^\d+$/);
    }
  });

  it("相対パスの写真は絶対URLにし、重複は除く", () => {
    const c = venueContents["kanda"];
    const ld = buildVenueJsonLd({
      site: SITE,
      content: c,
      priceRange: "x",
      openHour: 0,
      closeHour: 24,
      extraImages: [c.photos.hero, "https://example.supabase.co/a.jpg"],
    });
    expect(ld.image).toEqual([`${SITE}${c.photos.hero}`, "https://example.supabase.co/a.jpg"]);
  });
});

describe("設備・営業時間", () => {
  it("オプション・有償・持ち込み前提の設備は amenityFeature（備え付けあり）に載せない", () => {
    const shirokane = buildVenueJsonLd({
      site: SITE,
      content: venueContents["shirokane-takanawa"],
      priceRange: "x",
      openHour: 0,
      closeHour: 24,
    });
    const names = (shirokane.amenityFeature as { name: string }[]).map((a) => a.name);
    expect(names).not.toContain("施術ベッド");
    expect(names).not.toContain("プロジェクター");
    expect(names).toContain("姿見鏡");
    const ueno4a = buildVenueJsonLd({ site: SITE, content: venueContents["ueno-4a"], priceRange: "x", openHour: 0, closeHour: 24 });
    expect((ueno4a.amenityFeature as { name: string }[]).map((a) => a.name)).not.toContain("撮影機材");
    expect(isStandardAmenity({ label: "ゴミ持ち帰り不要", note: "スタッフ対応 ※有償" })).toBe(false);
    expect(isStandardAmenity({ label: "ゴミ持ち帰り不要", note: "スタッフ対応" })).toBe(true);
  });
  it("営業時間はDBの値から作り、24時は 23:59 で表す", () => {
    const c = venueContents["kanda"];
    const h24 = buildVenueJsonLd({ site: SITE, content: c, priceRange: "x", openHour: 0, closeHour: 24 });
    expect(h24.openingHoursSpecification).toMatchObject({ opens: "00:00", closes: "23:59" });
    const day = buildVenueJsonLd({ site: SITE, content: c, priceRange: "x", openHour: 9, closeHour: 21.5 });
    expect(day.openingHoursSpecification).toMatchObject({ opens: "09:00", closes: "21:30" });
  });
});

describe("Organization / WebSite", () => {
  it("Organization の url は接続できる www 付きのコーポレートURL", () => {
    const org = buildOrganizationJsonLd(SITE);
    expect(org.url).toBe("https://www.bluestage-lcc.com");
    expect(org["@id"]).toBe(`${SITE}/#organization`);
  });
  it("WebSite の publisher は Organization を参照する", () => {
    expect(buildWebSiteJsonLd(SITE).publisher).toEqual({ "@id": `${SITE}/#organization` });
  });
});

describe("FAQ", () => {
  it("空なら FAQPage を出さない", () => {
    expect(buildFaqPageJsonLd([])).toBeNull();
  });
  it("拠点固有FAQに共通FAQと同じ質問を入れない（同じQ&Aの重複マークアップ防止）", () => {
    const common = new Set(COMMON_FAQS.map((f) => f.q));
    for (const c of Object.values(venueContents)) {
      expect(c.faqs.length, `${c.slug} の拠点固有FAQが空`).toBeGreaterThan(0);
      for (const f of c.faqs) expect(common.has(f.q), `${c.slug}: ${f.q}`).toBe(false);
    }
  });
  it("< をエスケープして </script> で壊れない", () => {
    const json = serializeJsonLd(buildFaqPageJsonLd([{ q: "</script>", a: "<b>" }])!);
    expect(json).not.toContain("<");
  });
});

describe("venue-facts", () => {
  it("帯の最低額と、その時間帯を併記する", () => {
    expect(
      describeDayBands([
        { startHour: 0, endHour: 6, hourlyPrice: 1130 },
        { startHour: 6, endHour: 12, hourlyPrice: 1820 },
        { startHour: 12, endHour: 24, hourlyPrice: 2510 },
      ])
    ).toBe("¥1,130〜¥2,510（0:00〜6:00は¥1,130）");
  });
  it("最低額の帯が複数あれば全部並べる", () => {
    expect(
      describeDayBands([
        { startHour: 0, endHour: 6, hourlyPrice: 1440 },
        { startHour: 6, endHour: 18, hourlyPrice: 1730 },
        { startHour: 18, endHour: 24, hourlyPrice: 1440 },
      ])
    ).toBe("¥1,440〜¥1,730（0:00〜6:00・18:00〜24:00は¥1,440）");
  });
  it("帯なし拠点は平日/土日祝の単一価格", () => {
    expect(describeHourlyPrice(null, { hourly_price: 1000, holiday_hourly_price: 2000 })).toBe(
      "平日 ¥1,000 ／ 土日祝 ¥2,000"
    );
    expect(describeHourlyPrice(null, { hourly_price: 1200, holiday_hourly_price: 1200 })).toBe(
      "¥1,200（平日・土日祝とも）"
    );
  });
  it("時間・営業時間の表記", () => {
    expect(formatHours(1)).toBe("1時間");
    expect(formatHours(1.5)).toBe("1時間30分");
    expect(formatHours(0.5)).toBe("30分");
    expect(describeOpeningHours(0, 24)).toBe("24時間営業（0:00〜24:00）");
    expect(describeOpeningHours(9, 21)).toBe("9:00〜21:00");
  });
});
