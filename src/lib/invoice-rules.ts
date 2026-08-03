import { addDaysJst, jstDayOfWeek, utcToJstDateStr } from "./slots";

/**
 * 請求書払い（法人・銀行振込）の期限ルール（純関数のみ）。
 * BookingGrid（クライアント）からも参照するため、Stripe SDKやDBアクセス（./invoice, ./holidays,
 * ./supabase 等）を一切importしないこと。祝日情報は呼び出し側が Set<string> で注入する。
 */

/** 請求書払いを選べる最低リードタイム（時間）。利用開始まで5日（120時間）以上必要 */
export const INVOICE_MIN_LEAD_HOURS = 120;
/** 利用開始の何時間前までに入金が必要か（支払期限の物理上限） */
export const INVOICE_DUE_BEFORE_START_HOURS = 24;
/**
 * 支払期限の上限（申込から何時間後までを許容するか。連休対策）。
 * DB関数 create_pending_booking の expires_at 上限は4日（96h）だが、
 * アプリのnowとDBのnow()は別ホストのためクロック差がありうる。1時間の余裕を見て95hとする。
 */
export const INVOICE_MAX_DUE_HOURS = 95;
/** 支払期限の時刻（JST・24時間表記） */
export const INVOICE_DUE_HOUR_JST = 18;
/** 銀行休業日（国民の祝日ではないが銀行が休みの日）。MM-DD形式 */
export const BANK_HOLIDAYS_MMDD = ["12-31", "01-02", "01-03"];

function jstDateAtHour(dateStr: string, hour: number): Date {
  return new Date(`${dateStr}T${String(hour).padStart(2, "0")}:00:00+09:00`);
}

/** 土日・国民の祝日（holidaySet）・銀行休業日（12/31,1/2,1/3）のいずれでもない日か */
export function isBusinessDay(dateStr: string, holidaySet: Set<string>): boolean {
  const dow = jstDayOfWeek(dateStr);
  if (dow === 0 || dow === 6) return false;
  if (holidaySet.has(dateStr)) return false;
  if (BANK_HOLIDAYS_MMDD.includes(dateStr.slice(5))) return false;
  return true;
}

/** 請求書払いが選べるか（利用開始まで5日=120時間以上） */
export function isInvoiceEligible(startAt: Date, now: Date): boolean {
  return startAt.getTime() - now.getTime() >= INVOICE_MIN_LEAD_HOURS * 60 * 60 * 1000;
}

export type InvoiceDueCap = "next_business_day" | "max_hours" | "start_minus_24h";

export type InvoiceDueResult = {
  dueAt: Date;
  /** 期限日が営業日でない（土日祝・銀行休業日）か */
  dueOnNonBusinessDay: boolean;
  /** どの上限で確定したか */
  cappedBy: InvoiceDueCap;
};

/**
 * 支払期限を計算する（祝日Set注入版・純関数・テスト対象）。
 * 候補1: 申込翌日以降で最初の営業日の18:00 JST
 * 候補2: 申込+95hの時点以前で最も遅い18:00 JST（候補2自体は営業日に限らない。連休対策の上限）
 * 最終: min(候補1, 候補2, 利用開始−24h)
 */
export function calcInvoiceDueAtWithHolidays(
  startAt: Date,
  now: Date,
  holidaySet: Set<string>
): InvoiceDueResult {
  // --- 候補1: 翌日以降で最初の営業日の18:00 ---
  let candidate1Date = addDaysJst(utcToJstDateStr(now), 1);
  // 上限10日（銀行休業日+祝日が連続しても十分な余裕）
  for (let i = 0; i < 10 && !isBusinessDay(candidate1Date, holidaySet); i++) {
    candidate1Date = addDaysJst(candidate1Date, 1);
  }
  const candidate1 = jstDateAtHour(candidate1Date, INVOICE_DUE_HOUR_JST);

  // --- 候補2: 申込+95h以前で最も遅い18:00（営業日に限らない） ---
  const maxAt = new Date(now.getTime() + INVOICE_MAX_DUE_HOURS * 60 * 60 * 1000);
  let candidate2Date = utcToJstDateStr(maxAt);
  let candidate2 = jstDateAtHour(candidate2Date, INVOICE_DUE_HOUR_JST);
  if (candidate2.getTime() > maxAt.getTime()) {
    candidate2Date = addDaysJst(candidate2Date, -1);
    candidate2 = jstDateAtHour(candidate2Date, INVOICE_DUE_HOUR_JST);
  }

  const basicDueAt = candidate1.getTime() <= candidate2.getTime() ? candidate1 : candidate2;
  let cappedBy: InvoiceDueCap = candidate1.getTime() <= candidate2.getTime() ? "next_business_day" : "max_hours";

  // --- 物理上限: 利用開始−24h ---
  const startCap = new Date(startAt.getTime() - INVOICE_DUE_BEFORE_START_HOURS * 60 * 60 * 1000);
  let dueAt = basicDueAt;
  if (startCap.getTime() < basicDueAt.getTime()) {
    dueAt = startCap;
    cappedBy = "start_minus_24h";
  }

  const dueOnNonBusinessDay = !isBusinessDay(utcToJstDateStr(dueAt), holidaySet);

  return { dueAt, dueOnNonBusinessDay, cappedBy };
}
