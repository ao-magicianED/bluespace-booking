import { getDb } from "./supabase";
import { getHolidaySet, isHolidayDate } from "./holidays";
import { calcQuote, type CouponInfo, type PriceBreakdown, type SelectedOption } from "./pricing";
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
 * オプション・クーポンを検証して見積もりを作る。
 * /api/quote（表示用）と /api/checkout（決済用）の両方がこれを呼ぶため、
 * 画面に出る金額と請求額は必ず一致する。
 */
export async function buildQuote(
  venue: Venue,
  dateStr: string,
  startHour: number,
  hours: number,
  optionIds: string[],
  couponCode: string,
  now: Date
): Promise<PriceBreakdown> {
  const db = getDb();

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
    const holidaySetPre = await getHolidaySet([dateStr]);
    const pre = calcQuote(
      venue,
      dateStr,
      startHour,
      hours,
      isHolidayDate(dateStr, holidaySetPre),
      now,
      options,
      null
    );
    if (pre.total < (c.min_amount ?? 0)) {
      throw new QuoteError(`このクーポンは¥${(c.min_amount ?? 0).toLocaleString()}以上のご利用で使えます`);
    }
  }

  const holidaySet = await getHolidaySet([dateStr]);
  return calcQuote(
    venue,
    dateStr,
    startHour,
    hours,
    isHolidayDate(dateStr, holidaySet),
    now,
    options,
    coupon
  );
}
