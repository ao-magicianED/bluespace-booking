import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * 管理者認証（1人運用向けのシンプル設計）。
 * - パスワード: 環境変数 ADMIN_PASSWORD
 * - セッション: HMAC署名つきCookie（鍵はCRON_SECRETを流用、有効期限7日）
 */

const COOKIE_NAME = "admin_session";
const SESSION_DAYS = 7;

function secret(): string {
  const s = process.env.CRON_SECRET;
  if (!s) throw new Error("CRON_SECRET が未設定です");
  return s;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

export function verifyAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !input) return false;
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** ログイン成功時にCookieへ入れる値を作る */
export function createAdminSessionValue(): { name: string; value: string; maxAge: number } {
  const exp = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  const payload = `admin:${exp}`;
  return {
    name: COOKIE_NAME,
    value: `${exp}.${sign(payload)}`,
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

/** サーバーコンポーネント/APIルートから管理者ログイン状態を確認 */
export async function isAdmin(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD || !process.env.CRON_SECRET) return false;
  try {
    const store = await cookies();
    const raw = store.get(COOKIE_NAME)?.value;
    if (!raw) return false;
    const [expStr, sig] = raw.split(".");
    const exp = Number(expStr);
    if (!exp || !sig || exp < Date.now()) return false;
    const expected = sign(`admin:${exp}`);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
