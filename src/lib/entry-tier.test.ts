import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 価格ティアCookie（現地QR入口）の検証テスト。
 * - Cookie値の署名・期限検証（純粋関数）
 * - resolveTier のDB照合（active=false で発行済みCookieも即時standard＝キルスイッチ）
 */

// next/headers と supabase をモック（DB接続・リクエストコンテキストを避ける）
const h = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  dbResult: { data: null as { active: boolean } | null, error: null as { message: string } | null },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "bs_pt" && h.cookieValue !== undefined ? { value: h.cookieValue } : undefined,
  }),
}));

vi.mock("./supabase", () => ({
  getDb: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => h.dbResult,
        }),
      }),
    }),
  }),
}));

import { createPriceTierCookie, resolveTier, verifyPriceTierCookieValue } from "./entry-tier";

const SECRET = "test-secret-for-price-tier-0123456789abcdef"; // 32文字以上（最低長要件）
const TOKEN = "12345678-1234-1234-1234-123456789abc";
const NOW = new Date("2026-09-01T00:00:00Z");

beforeEach(() => {
  process.env.PRICE_TIER_COOKIE_SECRET = SECRET;
  h.cookieValue = undefined;
  h.dbResult = { data: null, error: null };
});

afterEach(() => {
  delete process.env.PRICE_TIER_COOKIE_SECRET;
});

describe("verifyPriceTierCookieValue", () => {
  it("正常発行→検証でトークンUUIDが返る", () => {
    const cookie = createPriceTierCookie(TOKEN, NOW);
    expect(cookie).not.toBeNull();
    expect(cookie!.name).toBe("bs_pt"); // テスト環境（非production）は接頭辞なし
    expect(verifyPriceTierCookieValue(cookie!.value, NOW, SECRET)).toBe(TOKEN);
    // 89日後でもまだ有効
    const later = new Date(NOW.getTime() + 89 * 24 * 60 * 60 * 1000);
    expect(verifyPriceTierCookieValue(cookie!.value, later, SECRET)).toBe(TOKEN);
  });

  it("期限切れ → null", () => {
    const cookie = createPriceTierCookie(TOKEN, NOW)!;
    const after91d = new Date(NOW.getTime() + 91 * 24 * 60 * 60 * 1000);
    expect(verifyPriceTierCookieValue(cookie.value, after91d, SECRET)).toBeNull();
  });

  it("署名が正しくても異常に長いexpは拒否（現在+91日超）", () => {
    const cookie = createPriceTierCookie(TOKEN, NOW)!;
    // 発行から5日巻き戻した時点で検証すると exp が「現在+95日」相当になり上限91日を超える
    const past = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
    expect(verifyPriceTierCookieValue(cookie.value, past, SECRET)).toBeNull();
  });

  it("署名改ざん → null", () => {
    const cookie = createPriceTierCookie(TOKEN, NOW)!;
    const parts = cookie.value.split(".");
    parts[3] = parts[3].replace(/^./, parts[3][0] === "a" ? "b" : "a");
    expect(verifyPriceTierCookieValue(parts.join("."), NOW, SECRET)).toBeNull();
    // トークン部分のすり替えも拒否
    const swapped = cookie.value.replace(TOKEN, "aaaaaaaa-1234-1234-1234-123456789abc");
    expect(verifyPriceTierCookieValue(swapped, NOW, SECRET)).toBeNull();
  });

  it("別シークレットで作られた値 → null", () => {
    const cookie = createPriceTierCookie(TOKEN, NOW)!;
    expect(verifyPriceTierCookieValue(cookie.value, NOW, "other-secret")).toBeNull();
  });

  it("形式不正・未設定 → null", () => {
    expect(verifyPriceTierCookieValue(undefined, NOW, SECRET)).toBeNull();
    expect(verifyPriceTierCookieValue("", NOW, SECRET)).toBeNull();
    expect(verifyPriceTierCookieValue("v1.not-a-uuid.123.abc", NOW, SECRET)).toBeNull();
    expect(verifyPriceTierCookieValue(`v2.${TOKEN}.123.abc`, NOW, SECRET)).toBeNull();
    // シークレット未設定なら検証不能 → null
    expect(verifyPriceTierCookieValue("whatever", NOW, null)).toBeNull();
  });
});

describe("resolveTier（毎回DB照合＝キルスイッチ）", () => {
  it("Cookieなし → standard", async () => {
    h.cookieValue = undefined;
    expect(await resolveTier()).toBe("standard");
  });

  it("有効Cookie＋DBでactive=true → repeat", async () => {
    h.cookieValue = createPriceTierCookie(TOKEN, new Date())!.value;
    h.dbResult = { data: { active: true }, error: null };
    expect(await resolveTier()).toBe("repeat");
  });

  it("有効Cookieでも active=false → standard（発行済みCookieが残っていても即時失効）", async () => {
    h.cookieValue = createPriceTierCookie(TOKEN, new Date())!.value;
    h.dbResult = { data: { active: false }, error: null };
    expect(await resolveTier()).toBe("standard");
  });

  it("有効Cookieでもトークンが存在しない → standard", async () => {
    h.cookieValue = createPriceTierCookie(TOKEN, new Date())!.value;
    h.dbResult = { data: null, error: null };
    expect(await resolveTier()).toBe("standard");
  });

  it("DBエラー → standard（fail-expensive）", async () => {
    h.cookieValue = createPriceTierCookie(TOKEN, new Date())!.value;
    h.dbResult = { data: null, error: { message: "db down" } };
    expect(await resolveTier()).toBe("standard");
  });

  it("改ざんCookie → DBを見るまでもなくstandard", async () => {
    const cookie = createPriceTierCookie(TOKEN, new Date())!;
    h.cookieValue = cookie.value.slice(0, -2) + "zz";
    h.dbResult = { data: { active: true }, error: null };
    expect(await resolveTier()).toBe("standard");
  });

  it("シークレット未設定 → standard", async () => {
    h.cookieValue = createPriceTierCookie(TOKEN, new Date())!.value;
    delete process.env.PRICE_TIER_COOKIE_SECRET;
    h.dbResult = { data: { active: true }, error: null };
    expect(await resolveTier()).toBe("standard");
  });

  it("短すぎるシークレット（32文字未満）は鍵として扱わない → Cookie発行されずstandard", async () => {
    h.cookieValue = createPriceTierCookie(TOKEN, new Date())!.value; // 正規鍵で発行済みの想定
    process.env.PRICE_TIER_COOKIE_SECRET = "short-key";
    expect(createPriceTierCookie(TOKEN, new Date())).toBeNull();
    h.dbResult = { data: { active: true }, error: null };
    expect(await resolveTier()).toBe("standard");
  });
});
