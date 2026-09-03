import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 禁止語ガード（景表法対策）。
 * 「最安」を含む最上級・有利誤認になりうる対外表現を、公開ページを構成するファイルに
 * 書き戻したらテストが落ちるようにする（2026-08 価格改定でR1として削除済み）。
 * 対象外: src/app/storage/ 配下の「最安プラン」は自社3プラン内の比較（真実・検証可能）のため許容。
 */

const BANNED = ["最安"];

/**
 * コンサル関連ページ（他社との比較表を含む）向けの追加禁止語。
 * 比較広告は実証性・正確性・公正性が要件で、最上級表現や成果保証は
 * 実証できない限り優良誤認・有利誤認になりうるため、書き戻しを機械的に止める。
 */
const BANNED_COMPARISON = [
  "最安",
  "業界No.1",
  "業界no.1",
  "日本一",
  "唯一無二",
  "圧倒的",
  "必ず成果",
  "絶対に",
];

/**
 * 「成果を保証」は打消し表示（「同様の成果を保証するものではありません」）でも登場するため、
 * 単純な部分一致では打消し表示まで弾いてしまう。肯定形だけを禁止する。
 */
const BANNED_COMPARISON_PATTERNS: { pattern: RegExp; label: string }[] = [
  {
    pattern: /成果を保証(?!するものではあり|しません|いたしません|するものではな)/,
    label: "成果を保証（肯定形）",
  },
];

/** 公開表示に使われるファイル（メタ情報・OGP・拠点コンテンツ含む） */
const TARGET_FILES = [
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/[slug]/page.tsx",
  "src/app/manifest.ts",
  "src/app/opengraph-image.tsx",
  "src/content/venues.ts",
];

/** 他社比較を含むコンサル導線のページ（より厳しい語彙制限をかける） */
const COMPARISON_FILES = [
  "src/app/consulting/page.tsx",
  "src/app/consulting/tokushoho/page.tsx",
  "src/components/ConsultingInquiryForm.tsx",
];

describe("禁止語ガード（対外価格表現）", () => {
  for (const rel of TARGET_FILES) {
    it(`${rel} に禁止語を含まない`, () => {
      const content = readFileSync(path.join(process.cwd(), rel), "utf8");
      for (const word of BANNED) {
        expect(
          content.includes(word),
          `${rel} に禁止語「${word}」が含まれています（景表法の有利誤認リスク。R1参照）`
        ).toBe(false);
      }
    });
  }
});

describe("禁止語ガード（他社比較を含むコンサル導線）", () => {
  for (const rel of COMPARISON_FILES) {
    it(`${rel} に最上級・成果保証の表現を含まない`, () => {
      const content = readFileSync(path.join(process.cwd(), rel), "utf8");
      for (const word of BANNED_COMPARISON) {
        expect(
          content.includes(word),
          `${rel} に禁止語「${word}」が含まれています（比較広告の実証性要件・成果保証の禁止に抵触。docs/media-disclosure-strategy.md 7章・10章参照）`
        ).toBe(false);
      }
      for (const { pattern, label } of BANNED_COMPARISON_PATTERNS) {
        expect(
          pattern.test(content),
          `${rel} に禁止表現「${label}」が含まれています（打消し表示は許容、肯定形は不可）`
        ).toBe(false);
      }
    });
  }

  it("打消し表示（成果を保証するものではありません）は禁止語ガードに引っかからない", () => {
    const { pattern } = BANNED_COMPARISON_PATTERNS[0];
    expect(pattern.test("同様の成果を保証するものではありません。")).toBe(false);
    expect(pattern.test("成果を保証します。")).toBe(true);
  });

  it("比較表には出典の取得日と、単純比較できない旨の注記が入っている", () => {
    const content = readFileSync(
      path.join(process.cwd(), "src/app/consulting/page.tsx"),
      "utf8"
    );
    expect(content).toContain("MARKET_SURVEYED_ON");
    expect(content).toContain("単純な比較はできません");
    expect(content).toContain("提供の有無を示すものではありません");
  });
});
