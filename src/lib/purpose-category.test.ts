import { describe, expect, it } from "vitest";
import { categorizePurpose, summarizePurposeCategories } from "./purpose-category";

describe("categorizePurpose", () => {
  it("外部モールの固定値を7分類に直接マッピングする", () => {
    expect(categorizePurpose("会議・打ち合わせ")).toBe("会議・打ち合わせ");
    expect(categorizePurpose("勉強会・セミナー")).toBe("セミナー・勉強会");
    expect(categorizePurpose("歓迎会・送別会")).toBe("パーティー・懇親会");
    expect(categorizePurpose("ダンス")).toBe("レッスン・教室");
    expect(categorizePurpose("動画撮影")).toBe("撮影・収録");
    expect(categorizePurpose("ボードゲーム")).toBe("ボードゲーム会");
  });

  it("7分類に該当しない値(作業・テレワーク等)はその他・未分類に丸める", () => {
    expect(categorizePurpose("作業")).toBe("その他・未分類");
    expect(categorizePurpose("テレワーク")).toBe("その他・未分類");
    expect(categorizePurpose("その他")).toBe("その他・未分類");
  });

  it("自社サイトの自由記述はキーワード推定で分類する", () => {
    expect(categorizePurpose("演技ワークショップ（12〜13名）")).toBe("レッスン・教室");
    expect(categorizePurpose("月次会議")).toBe("会議・打ち合わせ");
    expect(categorizePurpose("説明会")).toBe("セミナー・勉強会");
  });

  it("空文字・null・未一致の自由記述はその他・未分類にする", () => {
    expect(categorizePurpose("")).toBe("その他・未分類");
    expect(categorizePurpose(null)).toBe("その他・未分類");
    expect(categorizePurpose(undefined)).toBe("その他・未分類");
    expect(categorizePurpose("未知の用途テキスト")).toBe("その他・未分類");
  });

  it("固有名詞を含む自由記述でも、返り値はカテゴリ名のみで原文を含まない", () => {
    const result = categorizePurpose("株式会社サンプル商事の会議");
    expect(result).toBe("会議・打ち合わせ");
    expect(result).not.toContain("株式会社");
  });
});

describe("summarizePurposeCategories", () => {
  it("カテゴリ別の件数に集計する", () => {
    const counts = summarizePurposeCategories([
      "会議・打ち合わせ",
      "会議・打ち合わせ",
      "ダンス",
      "作業",
      null,
    ]);
    expect(counts["会議・打ち合わせ"]).toBe(2);
    expect(counts["レッスン・教室"]).toBe(1);
    expect(counts["その他・未分類"]).toBe(2);
    expect(counts["撮影・収録"]).toBe(0);
  });
});
