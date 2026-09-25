import { describe, expect, it } from "vitest";
import {
  aggregateReviews,
  isReviewEligible,
  normalizeReviewInput,
  REVIEW_COMMENT_MAX,
  selectReviewRequestTargets,
  UUID_RE,
} from "./reviews";

describe("aggregateReviews", () => {
  it("空配列は count=0, average=0", () => {
    expect(aggregateReviews([])).toEqual({ count: 0, average: 0 });
  });

  it("平均を小数1桁に丸める", () => {
    expect(aggregateReviews([5, 4])).toEqual({ count: 2, average: 4.5 });
    expect(aggregateReviews([5, 4, 4])).toEqual({ count: 3, average: 4.3 }); // 4.333... → 4.3
    expect(aggregateReviews([5, 5, 4])).toEqual({ count: 3, average: 4.7 }); // 4.666... → 4.7
  });

  it("全件同じ評価なら整数のまま", () => {
    expect(aggregateReviews([3, 3, 3])).toEqual({ count: 3, average: 3 });
  });
});

describe("isReviewEligible", () => {
  const now = new Date("2026-07-10T12:00:00+09:00");

  it("確定済み・利用終了直後は投稿可", () => {
    const b = { booking_status: "confirmed", end_at: "2026-07-10T02:00:00.000Z" };
    expect(isReviewEligible(b, now)).toEqual({ ok: true });
  });

  it("確定以外（キャンセル等）は不可", () => {
    const b = { booking_status: "cancelled", end_at: "2026-07-10T02:00:00.000Z" };
    expect(isReviewEligible(b, now)).toEqual({ ok: false, reason: "not_confirmed" });
  });

  it("利用前は不可", () => {
    const b = { booking_status: "confirmed", end_at: "2026-07-11T02:00:00.000Z" };
    expect(isReviewEligible(b, now)).toEqual({ ok: false, reason: "not_ended" });
  });

  it("利用終了から30日を超えると期限切れ", () => {
    const b = { booking_status: "confirmed", end_at: "2026-06-09T00:00:00.000Z" };
    expect(isReviewEligible(b, now)).toEqual({ ok: false, reason: "window_expired" });
  });

  it("利用終了からちょうど30日以内なら投稿可", () => {
    // now(JST 7/10 12:00 = UTC 7/10 03:00) の30日前 = UTC 6/10 03:00
    const b = { booking_status: "confirmed", end_at: "2026-06-10T03:00:00.000Z" };
    expect(isReviewEligible(b, now)).toEqual({ ok: true });
  });
});

describe("selectReviewRequestTargets", () => {
  const card = (id: string, email: string) => ({ id, payment_method: "card", customer_email: email });

  it("カード払いで依頼履歴がなければ送る", () => {
    const r = selectReviewRequestTargets([card("a", "a@example.com")], []);
    expect(r.map((b) => b.id)).toEqual(["a"]);
  });

  it("請求書払い（法人の定期契約等）には送らない", () => {
    const invoice = { id: "i", payment_method: "invoice", customer_email: "corp@example.com" };
    expect(selectReviewRequestTargets([invoice], [])).toEqual([]);
  });

  it("直近に依頼済みのメールアドレスには送らない（大文字小文字・前後空白は無視）", () => {
    const r = selectReviewRequestTargets(
      [card("a", "Repeat@Example.com"), card("b", "new@example.com")],
      [" repeat@example.com "]
    );
    expect(r.map((b) => b.id)).toEqual(["b"]);
  });

  it("同じ回に同じお客様の予約が複数あっても1通だけ", () => {
    const r = selectReviewRequestTargets(
      [card("a", "same@example.com"), card("b", "SAME@example.com"), card("c", "other@example.com")],
      []
    );
    expect(r.map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("請求書払いの予約は同じ回のカード払い予約の送信を妨げない", () => {
    const invoice = { id: "i", payment_method: "invoice", customer_email: "mix@example.com" };
    const r = selectReviewRequestTargets([invoice, card("c", "mix@example.com")], []);
    expect(r.map((b) => b.id)).toEqual(["c"]);
  });
});

describe("normalizeReviewInput", () => {
  it("正常系: トリムして受理", () => {
    const r = normalizeReviewInput({
      rating: 5,
      comment: "  とても良かったです  ",
      purpose: "会議・打ち合わせ",
      reviewerName: "T.K.",
    });
    expect(r).toEqual({
      ok: true,
      rating: 5,
      comment: "とても良かったです",
      purpose: "会議・打ち合わせ",
      reviewerName: "T.K.",
    });
  });

  it("評価が範囲外・非整数・未指定なら拒否", () => {
    expect(normalizeReviewInput({ rating: 0 }).ok).toBe(false);
    expect(normalizeReviewInput({ rating: 6 }).ok).toBe(false);
    expect(normalizeReviewInput({ rating: 4.5 }).ok).toBe(false);
    expect(normalizeReviewInput({ rating: "abc" }).ok).toBe(false);
    expect(normalizeReviewInput({}).ok).toBe(false);
  });

  it("文字列評価 '4' は数値として受理（フォーム経由対策）", () => {
    const r = normalizeReviewInput({ rating: "4" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rating).toBe(4);
  });

  it("コメントは最大長で切り詰め、未指定は空文字", () => {
    const long = "あ".repeat(REVIEW_COMMENT_MAX + 100);
    const r = normalizeReviewInput({ rating: 3, comment: long });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment.length).toBe(REVIEW_COMMENT_MAX);
    const r2 = normalizeReviewInput({ rating: 3 });
    if (r2.ok) expect(r2.comment).toBe("");
  });

  it("制御文字・Bidi制御文字を除去する（表示崩し対策）", () => {
    // \x/\uエスケープシーケンスで組み立てる。ソースファイルに生の制御バイトを
    // 直接埋め込むとgitにバイナリファイル扱いされてしまうため、必ずエスケープで書く。
    // NUL・ベル・DELと、Bidi override（RLO ‮ 〜 PDF ‬）を混入させる
    const dirty = "A\x00B\x07C\x7fD‮E‬F";
    const r = normalizeReviewInput({ rating: 4, comment: dirty });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment).toBe("ABCDEF");
  });

  it("改行・タブは保持する（コメントの改行は表示に必要）", () => {
    const r = normalizeReviewInput({ rating: 4, comment: "1行目\n2行目\tタブ" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.comment).toBe("1行目\n2行目\tタブ");
  });
});

describe("UUID_RE", () => {
  it("正しいUUID形式のみ受理する", () => {
    expect(UUID_RE.test("a1b2c3d4-e5f6-4789-a123-b4c5d6e7f890")).toBe(true);
  });

  it("ハイフン位置が違う・長さが違う文字列は拒否する", () => {
    // 旧チェック /^[0-9a-f-]{36}$/ はハイフンの位置を見ておらず、
    // 例えば全部ハイフンの文字列（長さ36）も通ってしまっていた
    expect(UUID_RE.test("-".repeat(36))).toBe(false);
    expect(UUID_RE.test("a1b2c3d4-e5f6-4789-a123-b4c5d6e7f89")).toBe(false); // 1文字短い
    expect(UUID_RE.test("")).toBe(false);
  });
});
