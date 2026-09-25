import { describe, expect, it } from "vitest";
import {
  formatPurpose,
  isUsageCategory,
  parsePurpose,
  PURPOSE_MAX_LENGTH,
  USAGE_CATEGORIES,
} from "./usage-categories";

describe("USAGE_CATEGORIES", () => {
  it("13カテゴリ・重複なし・最後は「その他」", () => {
    expect(USAGE_CATEGORIES).toHaveLength(13);
    expect(new Set(USAGE_CATEGORIES).size).toBe(13);
    expect(USAGE_CATEGORIES[USAGE_CATEGORIES.length - 1]).toBe("その他");
  });

  it("ラベルに角括弧を含まない（保存形式の区切りと衝突しない）", () => {
    for (const c of USAGE_CATEGORIES) expect(c).not.toMatch(/[[\]［］]/);
  });

  it("isUsageCategory は一覧にある文字列だけ受理する", () => {
    expect(isUsageCategory("撮影・配信")).toBe(true);
    expect(isUsageCategory("撮影")).toBe(false);
    expect(isUsageCategory("")).toBe(false);
    expect(isUsageCategory(null)).toBe(false);
  });
});

describe("formatPurpose", () => {
  it("カテゴリ＋詳細は '[カテゴリ] 詳細'", () => {
    expect(formatPurpose("会議・打ち合わせ", "定例ミーティング")).toBe("[会議・打ち合わせ] 定例ミーティング");
  });

  it("詳細が空ならカテゴリだけ", () => {
    expect(formatPurpose("撮影・配信", "")).toBe("[撮影・配信]");
    expect(formatPurpose("撮影・配信", "   ")).toBe("[撮影・配信]");
  });

  it("カテゴリ未選択なら詳細だけ（旧来の自由記述と同じ形）", () => {
    expect(formatPurpose(null, " 打ち合わせ ")).toBe("打ち合わせ");
    expect(formatPurpose(null, "")).toBe("");
  });

  it("前後の半角・全角スペースを除去する", () => {
    expect(formatPurpose("商談・面接", "　 面接 　")).toBe("[商談・面接] 面接");
    expect(formatPurpose(null, "　　")).toBe("");
  });

  it(`全体を${PURPOSE_MAX_LENGTH}文字以内に収める`, () => {
    const s = formatPurpose("会議・打ち合わせ", "あ".repeat(600));
    expect(s.length).toBe(PURPOSE_MAX_LENGTH);
    expect(s.startsWith("[会議・打ち合わせ] あ")).toBe(true);
    expect(formatPurpose(null, "い".repeat(600)).length).toBe(PURPOSE_MAX_LENGTH);
  });

  it("切り詰め位置でサロゲートペアを分断しない", () => {
    // "[その他] " は6文字。残り494文字の位置に絵文字（2コードユニット）の前半が来るよう調整
    const detail = "a".repeat(PURPOSE_MAX_LENGTH - 6 - 1) + "😀" + "b";
    const s = formatPurpose("その他", detail);
    expect(s.length).toBe(PURPOSE_MAX_LENGTH - 1);
    expect(s.endsWith("a")).toBe(true);
  });
});

describe("parsePurpose", () => {
  it("全カテゴリで往復変換できる", () => {
    for (const c of USAGE_CATEGORIES) {
      expect(parsePurpose(formatPurpose(c, "詳細テキスト"))).toEqual({ category: c, detail: "詳細テキスト" });
      expect(parsePurpose(formatPurpose(c, ""))).toEqual({ category: c, detail: "" });
    }
    expect(parsePurpose(formatPurpose(null, "自由記述"))).toEqual({ category: null, detail: "自由記述" });
  });

  it("旧来の自由記述はカテゴリなし・全体が詳細", () => {
    expect(parsePurpose("会議・撮影")).toEqual({ category: null, detail: "会議・撮影" });
    expect(parsePurpose("  ダンス練習  ")).toEqual({ category: null, detail: "ダンス練習" });
  });

  it("一覧にないラベルの角括弧はカテゴリなし（全体を詳細として保持）", () => {
    expect(parsePurpose("[社内] 定例会議")).toEqual({ category: null, detail: "[社内] 定例会議" });
    expect(parsePurpose("[会議] 打ち合わせ")).toEqual({ category: null, detail: "[会議] 打ち合わせ" });
  });

  it("空・null・undefined は未記入扱い", () => {
    expect(parsePurpose("")).toEqual({ category: null, detail: "" });
    expect(parsePurpose("   ")).toEqual({ category: null, detail: "" });
    expect(parsePurpose(null)).toEqual({ category: null, detail: "" });
    expect(parsePurpose(undefined)).toEqual({ category: null, detail: "" });
  });

  it("区切りの空白は半角・全角・なしのいずれも受け付ける", () => {
    const want = { category: "撮影・配信", detail: "商品撮影" };
    expect(parsePurpose("[撮影・配信] 商品撮影")).toEqual(want);
    expect(parsePurpose("[撮影・配信]　商品撮影")).toEqual(want);
    expect(parsePurpose("[撮影・配信]商品撮影")).toEqual(want);
    expect(parsePurpose("　[撮影・配信]  商品撮影　")).toEqual(want);
  });

  it("括弧内の前後空白・全角の［］も許容する（手入力対策）", () => {
    expect(parsePurpose("[ 撮影・配信 ] 商品撮影")).toEqual({ category: "撮影・配信", detail: "商品撮影" });
    expect(parsePurpose("［撮影・配信］商品撮影")).toEqual({ category: "撮影・配信", detail: "商品撮影" });
  });

  it("詳細中の角括弧や改行はそのまま保持する", () => {
    expect(parsePurpose("[撮影・配信] 新作[春]の撮影")).toEqual({
      category: "撮影・配信",
      detail: "新作[春]の撮影",
    });
    expect(parsePurpose("[その他] 1行目\n2行目")).toEqual({ category: "その他", detail: "1行目\n2行目" });
  });

  it(`${PURPOSE_MAX_LENGTH}文字で切り詰めた値もカテゴリを保つ`, () => {
    const s = formatPurpose("教室・レッスン・ワークショップ", "x".repeat(1000));
    const p = parsePurpose(s);
    expect(p.category).toBe("教室・レッスン・ワークショップ");
    expect(p.detail).toBe("x".repeat(PURPOSE_MAX_LENGTH - "[教室・レッスン・ワークショップ] ".length));
  });
});
