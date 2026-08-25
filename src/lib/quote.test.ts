import { describe, expect, it } from "vitest";
import { checkCouponRestrictEmail, QuoteError } from "./quote";

describe("checkCouponRestrictEmail（本人専用クーポン）", () => {
  it("未ログインはログイン必須エラー（401）", () => {
    const err = checkCouponRestrictEmail("member@example.com", null);
    expect(err).toBeInstanceOf(QuoteError);
    expect(err?.status).toBe(401);
    expect(err?.message).toContain("ログイン");
  });

  it("ログインメール未取得（undefined）も同様に拒否", () => {
    expect(checkCouponRestrictEmail("member@example.com", undefined)?.status).toBe(401);
  });

  it("ログインメールが宛先と一致すれば利用できる", () => {
    expect(checkCouponRestrictEmail("member@example.com", "member@example.com")).toBeNull();
  });

  it("大文字小文字・前後空白の違いは無視する", () => {
    expect(checkCouponRestrictEmail("Member@Example.com", "member@example.com")).toBeNull();
    expect(checkCouponRestrictEmail(" member@example.com ", "member@example.com")).toBeNull();
  });

  it("宛先と違うアカウントは拒否（403）", () => {
    const err = checkCouponRestrictEmail("member@example.com", "attacker@example.com");
    expect(err).toBeInstanceOf(QuoteError);
    expect(err?.status).toBe(403);
  });
});
