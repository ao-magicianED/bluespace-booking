import { getDb } from "./supabase";
import { getHolidaySetStrict, isHolidayDate } from "./holidays";
import { calcQuote, type CouponInfo, type PriceBreakdown, type PriceTier, type SelectedOption } from "./pricing";
import { resolvePricing } from "./price-bands";
import type { Venue } from "./types";

/** 利用者に見せられる見積もりエラー（statusつき） */
export class QuoteError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * 本人専用クーポン（restrict_email付き）の利用資格チェック。
 * 予約フォームのメールは自由入力のため判定に使わず、ログイン済みの認証メール一致のみを認める
 * （コードと宛先メールを知る第三者による流用や、max_uses枠の使い潰しを防ぐ）。
 * @returns 利用不可ならQuoteError（呼び出し側でレスポンスに変換）、利用可ならnull
 */
export function checkCouponRestrictEmail(
  restrictEmail: string,
  loginEmail: string | null | undefined
): QuoteError | null {
  if (!loginEmail) {
    return new QuoteError("このクーポンはログインしてご利用ください", 401);
  }
  if (loginEmail.trim().toLowerCase() !== restrictEmail.trim().toLowerCase()) {
    return new QuoteError(
      "このクーポンはお届けした方ご本人さま専用です。クーポンが届いたメールアドレスのアカウントでログインしてご利用ください",
      403
    );
  }
  return null;
}

/**
 * オプション・クーポンを検証して見積もりを作る。
 * /api/quote（表示用）と /api/checkout（決済用）の両方がこれを呼ぶため、
 * 画面に出る金額と請求額は必ず一致する。
 *
 * tier はサーバー側で resolveTier()（署名Cookie＋DB照合）により解決した値のみを渡すこと。
 * リクエストbody/query/headerのティア指定は絶対に渡さない（R2: fail-expensive）。
 *
 * 祝日判定は厳格版（getHolidaySetStrict）を使う。祝日DBが読めないとき平日価格で
 * 売るのは過小請求（fail-cheap）のため、取得不能時は QuoteError(503) で停止する。
 */
export async function buildQuote(
  venue: Venue,
  dateStr: string,
  startHour: number,
  hours: number,
  optionIds: string[],
  couponCode: string,
  now: Date,
  tier: PriceTier = "standard"
): Promise<PriceBreakdown> {
  const db = getDb();

  // --- 祝日判定（厳格版・fail-expensive） ---
  let holidaySet: Set<string>;
  try {
    holidaySet = await getHolidaySetStrict([dateStr]);
  } catch (e) {
    console.error("[quote] 祝日データ取得失敗（見積を停止）:", e);
    throw new QuoteError("現在ご予約を受け付けられません。時間をおいてお試しください", 503);
  }
  const isHoliday = isHolidayDate(dateStr, holidaySet);

  // --- 適用料金の解決（帯があれば帯、無ければフラット） ---
  // 帯なし拠点は従来どおり rule:"v2" のフラット計算（後方互換）。
  const resolved = await resolvePricing(venue, tier, isHoliday ? "holiday" : "weekday");
  const pricing = resolved.source === "bands" ? resolved : null;

  // --- オプション検証 ---
  let options: SelectedOption[] = [];
  if (optionIds.length > 0) {
    if (optionIds.length > 20) throw new QuoteError("オプションが多すぎます");
    const { data, error } = await db
      .from("venue_options")
      .select("id, name, price, price_unit")
      .eq("venue_id", venue.id)
      .eq("active", true)
      .in("id", optionIds);
    if (error) throw new Error(`オプション取得エラー: ${error.message}`);
    options = (data ?? []) as SelectedOption[];
    if (options.length !== new Set(optionIds).size) {
      throw new QuoteError("選択されたオプションが見つかりません");
    }
  }

  // --- クーポン検証 ---
  let coupon: CouponInfo | null = null;
  const code = couponCode.trim().toUpperCase();
  if (code) {
    if (!/^[A-Z0-9_-]{2,32}$/.test(code)) throw new QuoteError("クーポンコードの形式が正しくありません");
    const { data: c, error } = await db
      .from("coupons")
      .select("*")
      .ilike("code", code)
      .maybeSingle();
    if (error) throw new Error(`クーポン取得エラー: ${error.message}`);
    const nowIso = now.toISOString();
    if (!c || !c.active) throw new QuoteError("このクーポンは利用できません");
    if (c.starts_at && c.starts_at > nowIso) throw new QuoteError("このクーポンはまだ利用開始前です");
    if (c.ends_at && c.ends_at < nowIso) throw new QuoteError("このクーポンは期限切れです");
    if (c.max_uses != null && c.used_count >= c.max_uses) {
      throw new QuoteError("このクーポンは利用上限に達しました");
    }
    if (c.venue_id && c.venue_id !== venue.id) {
      throw new QuoteError("このクーポンは対象外のスペースです");
    }
    coupon = { code: c.code, percent_off: c.percent_off, amount_off: c.amount_off };

    // 最低利用金額のチェック（クーポン適用前金額に対して）
    const pre = calcQuote(venue, dateStr, startHour, hours, isHoliday, now, options, null, pricing);
    if (pre.total < (c.min_amount ?? 0)) {
      throw new QuoteError(`このクーポンは¥${(c.min_amount ?? 0).toLocaleString()}以上のご利用で使えます`);
    }
  }

  return calcQuote(venue, dateStr, startHour, hours, isHoliday, now, options, coupon, pricing);
}
