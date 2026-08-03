import { getStripe } from "./stripe";
import { getHolidaySet } from "./holidays";
import { addDaysJst, utcToJstDateStr } from "./slots";
import {
  INVOICE_MIN_LEAD_HOURS,
  INVOICE_DUE_BEFORE_START_HOURS,
  INVOICE_MAX_DUE_HOURS,
  INVOICE_DUE_HOUR_JST,
  BANK_HOLIDAYS_MMDD,
  isBusinessDay,
  isInvoiceEligible,
  calcInvoiceDueAtWithHolidays,
} from "./invoice-rules";
import type { InvoiceDueResult } from "./invoice-rules";

/**
 * 請求書払い（法人・銀行振込）の設計:
 * - 利用開始まで5日（120時間）以上ある予約のみ選択可
 * - 支払期限 = 申込の翌営業日18:00 JST。上限は「申込+95h以内の最遅18:00」と
 *   「利用開始の24時間前」の2つ（詳細は invoice-rules.ts）
 * - Stripe Invoicing + 銀行振込（顧客ごとの専用入金口座が自動発行され、
 *   入金されると invoice.paid Webhookが届いて予約が自動確定する）
 * - 期限切れ後は「枠の解放」「お客様通知」「請求書void」を分離して実行する
 *   （src/lib/expire-invoices.ts 参照）。着金遅延を expired→confirmed 復旧で救済するため。
 */

export {
  INVOICE_MIN_LEAD_HOURS,
  INVOICE_DUE_BEFORE_START_HOURS,
  INVOICE_MAX_DUE_HOURS,
  INVOICE_DUE_HOUR_JST,
  BANK_HOLIDAYS_MMDD,
  isBusinessDay,
  isInvoiceEligible,
  calcInvoiceDueAtWithHolidays,
};
export type { InvoiceDueResult, InvoiceDueCap } from "./invoice-rules";

/**
 * 支払期限を計算する（本番用: 祝日をDBから取得してから純関数へ渡す）。
 * 探索範囲は「翌日から+11日分」（候補1の営業日探索が最大10日先まで見るため）。
 */
export async function calcInvoiceDueAt(startAt: Date, now: Date): Promise<InvoiceDueResult> {
  const datesToCheck: string[] = [];
  let d = utcToJstDateStr(now);
  for (let i = 0; i < 11; i++) {
    d = addDaysJst(d, 1);
    datesToCheck.push(d);
  }
  const holidaySet = await getHolidaySet(datesToCheck);
  return calcInvoiceDueAtWithHolidays(startAt, now, holidaySet);
}

/**
 * Stripe請求書を発行してメール送付する。
 * 戻り値の invoiceId は bookings.stripe_invoice_id、customerId は
 * bookings.stripe_invoice_customer_id に保存し、Webhookでの照合・残高チェックに使う。
 */
export async function createAndSendInvoice(params: {
  bookingId: string;
  email: string;
  customerName: string;
  companyName: string | null;
  description: string;
  amount: number;
  dueAt: Date;
}): Promise<{ invoiceId: string; customerId: string; hostedInvoiceUrl: string | null }> {
  const stripe = getStripe();
  const displayName = params.companyName?.trim()
    ? `${params.companyName.trim()}（ご担当: ${params.customerName}）`
    : params.customerName;

  // 顧客（毎回作成でOK: 専用入金口座は顧客単位に発行される）。
  // 同一顧客の複数請求書への入金充当誤りを避けるため使い捨てが正しい設計（意図的）。
  const customer = await stripe.customers.create({
    email: params.email,
    name: displayName,
    metadata: { booking_id: params.bookingId },
    // アカウント既定値がmanualだと入金してもinvoice.paidが発火しなくなるため明示する
    cash_balance: { settings: { reconciliation_mode: "automatic" } },
  });

  await stripe.invoiceItems.create({
    customer: customer.id,
    amount: params.amount,
    currency: "jpy",
    description: params.description,
  });

  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: "send_invoice",
    due_date: Math.floor(params.dueAt.getTime() / 1000),
    currency: "jpy",
    metadata: { booking_id: params.bookingId },
    payment_settings: {
      payment_method_types: ["customer_balance"],
      payment_method_options: {
        customer_balance: {
          funding_type: "bank_transfer",
          bank_transfer: { type: "jp_bank_transfer" },
        },
      },
    },
    pending_invoice_items_behavior: "include",
  });

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id as string);
  await stripe.invoices.sendInvoice(finalized.id as string);

  return {
    invoiceId: finalized.id as string,
    customerId: customer.id,
    hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
  };
}

/** 期限切れ等で請求書を無効化する（失敗しても致命的でないため呼び出し側でcatch） */
export async function voidInvoice(invoiceId: string): Promise<void> {
  await getStripe().invoices.voidInvoice(invoiceId);
}

/** 請求書に紐づくStripe顧客のcash balance（JPY）を取得する（迷子入金の検知用） */
export async function getCustomerCashBalanceJpy(customerId: string): Promise<number> {
  const balance = await getStripe().customers.retrieveCashBalance(customerId);
  return balance.available?.jpy ?? 0;
}
