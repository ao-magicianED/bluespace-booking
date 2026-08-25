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

/** 公開表示に使われるファイル（メタ情報・OGP・拠点コンテンツ含む） */
const TARGET_FILES = [
  "src/app/layout.tsx",
  "src/app/page.tsx",
  "src/app/[slug]/page.tsx",
  "src/app/manifest.ts",
  "src/app/opengraph-image.tsx",
  "src/content/venues.ts",
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
