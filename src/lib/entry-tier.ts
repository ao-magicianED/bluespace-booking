import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "./supabase";
import type { PriceTier } from "./pricing";

/**
 * 価格ティアの入口（現地QR）とサーバー側ティア解決。
 *
 * 設計（R2: サーバー検証のみ・fail-expensive）:
 * - /r/[token] が venue_entry_tokens をDB照合し、成立時のみHMAC署名Cookieを発行
 * - Cookieは自己完結にしない: 値にトークンIDを入れ、ティア判定のたびに
 *   DBで active を照合する（active=false で発行済みCookieも即時無効＝キルスイッチ）
 * - 署名NG・期限NG・トークン不在・active=false・DBエラー・シークレット未設定、
 *   いずれも standard（高い方）へフォールバック
 * - 鍵は専用の PRICE_TIER_COOKIE_SECRET（CRON_SECRETと分離。ローテーション時に
 *   管理者認証を巻き込まないため）
 */

const COOKIE_DAYS = 90;
/** 検証時に許容する期限の上限（署名が正しくても異常に長いexpは拒否する） */
const MAX_EXP_DAYS = 91;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** HMAC鍵の最低長。CookieにHMACの既知平文・署名ペアが露出するため、短い鍵は辞書攻撃可能 */
const MIN_SECRET_LENGTH = 32;

/** __Host- プレフィックスはSecure必須のため、ローカル開発（http）のみ接頭辞なしに落とす */
export function priceTierCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-bs_pt" : "bs_pt";
}

function secret(): string | null {
  const s = process.env.PRICE_TIER_COOKIE_SECRET || "";
  if (!s) return null;
  if (s.length < MIN_SECRET_LENGTH) {
    // 弱い鍵で運用するより、repeat価格を無効化（＝全員standard）する方が安全
    console.error(
      `[entry-tier] PRICE_TIER_COOKIE_SECRET が短すぎます（${MIN_SECRET_LENGTH}文字以上必須）。repeat価格を無効化します`
    );
    return null;
  }
  return s;
}

function sign(token: string, exp: number, key: string): string {
  return createHmac("sha256", key).update(`v1:${token}:${exp}`).digest("hex");
}

/**
 * 入口成立時に発行するCookie値を作る。シークレット未設定ならnull（Cookieを発行しない）。
 */
export function createPriceTierCookie(
  tokenUuid: string,
  now: Date
): { name: string; value: string; maxAge: number; secure: boolean } | null {
  const key = secret();
  if (!key || !UUID_RE.test(tokenUuid)) return null;
  const exp = Math.floor(now.getTime() / 1000) + COOKIE_DAYS * 24 * 60 * 60;
  const token = tokenUuid.toLowerCase();
  return {
    name: priceTierCookieName(),
    value: `v1.${token}.${exp}.${sign(token, exp, key)}`,
    maxAge: COOKIE_DAYS * 24 * 60 * 60,
    secure: process.env.NODE_ENV === "production",
  };
}

/**
 * Cookie値の署名・期限を検証してトークンUUIDを返す（純粋関数・単体テスト対象）。
 * 検証NGはすべて null（＝standard扱い）。
 */
export function verifyPriceTierCookieValue(
  raw: string | undefined,
  now: Date,
  key: string | null = secret()
): string | null {
  if (!raw || !key) return null;
  const parts = raw.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, token, expStr, sig] = parts;
  if (!UUID_RE.test(token)) return null;
  if (!/^\d{1,12}$/.test(expStr)) return null;
  const exp = Number(expStr);
  const nowSec = Math.floor(now.getTime() / 1000);
  // 期限切れ、および署名が正しくても異常に長い期限（鍵漏えい時の永続Cookie化）を拒否
  if (!Number.isInteger(exp) || exp <= nowSec || exp > nowSec + MAX_EXP_DAYS * 24 * 60 * 60) {
    return null;
  }
  const expected = sign(token.toLowerCase(), exp, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return token.toLowerCase();
}

/**
 * リクエストの価格ティアを解決する（quote / checkout / availability から毎回呼ぶ）。
 * Cookie署名検証 → venue_entry_tokens をPKで照合し active=true を確認 →
 * すべて成立したときだけ repeat。それ以外は必ず standard（fail-expensive）。
 * body / query / header のティア指定は一切読まない。
 */
export async function resolveTier(): Promise<PriceTier> {
  try {
    const store = await cookies();
    const raw = store.get(priceTierCookieName())?.value;
    const token = verifyPriceTierCookieValue(raw, new Date());
    if (!token) return "standard";

    const { data, error } = await getDb()
      .from("venue_entry_tokens")
      .select("active")
      .eq("token", token)
      .maybeSingle<{ active: boolean }>();
    if (error || !data || data.active !== true) return "standard";
    return "repeat";
  } catch {
    return "standard";
  }
}
