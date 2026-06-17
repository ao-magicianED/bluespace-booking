import { getStripe } from "./stripe";

/**
 * 請求書払い（法人・銀行振込）の設計:
 * - 利用開始まで72時間以上ある予約のみ選択可
 * - 支払期限 = min(発行から3日後, 利用開始の24時間前)
 * - Stripe Invoicing + 銀行振込（顧客ごとの専用入金口座が自動発行され、
 *   入金されると invoice.paid Webhookが届いて予約が自動確定する）
 */

/** 請求書払いを選べる最低リードタイム（時間） */
export const INVOICE_MIN_LEAD_HOURS = 72;
/** 標準の支払期限（日） */
export const INVOICE_DUE_DAYS = 3;
/** 利用開始の何時間前までに入金が必要か */
export const INVOICE_DUE_BEFORE_START_HOURS = 24;

/** 請求書払いが選べるか（利用開始まで72時間以上） */
export function isInvoiceEligible(startAt: Date, now: Date): boolean {
  return startAt.getTime() - now.getTime() >= INVOICE_MIN_LEAD_HOURS * 60 * 60 * 1000;
}

/** 支払期限 = min(now+3日, 開始-24時間) */
export function calcInvoiceDueAt(startAt: Date, now: Date): Date {
  const standard = now.getTime() + INVOICE_DUE_DAYS * 24 * 60 * 60 * 1000;
  const beforeStart = startAt.getTime() - INVOICE_DUE_BEFORE_START_HOURS * 60 * 60 * 1000;
  return new Date(Math.min(standard, beforeStart));
}

/**
 * Stripe請求書を発行してメール送付する。
 * 戻り値の invoiceId は bookings.stripe_invoice_id に保存し、Webhookで突合する。
 */
export async function createAndSendInvoice(params: {
  bookingId: string;
  email: string;
  customerName: string;
  companyName: string | null;
  description: string;
  amount: number;
  dueAt: Date;
}): Promise<{ invoiceId: string; hostedInvoiceUrl: string | null }> {
  const stripe = getStripe();
  const displayName = params.companyName?.trim()
    ? `${params.companyName.trim()}（ご担当: ${params.customerName}）`
    : params.customerName;

  // 顧客（毎回作成でOK: 専用入金口座は顧客単位に発行される）
  const customer = await stripe.customers.create({
    email: params.email,
    name: displayName,
    metadata: { booking_id: params.bookingId },
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
    hostedInvoiceUrl: finalized.hosted_invoice_url ?? null,
  };
}

/** 期限切れ等で請求書を無効化する（失敗しても致命的でないため呼び出し側でcatch） */
export async function voidInvoice(invoiceId: string): Promise<void> {
  await getStripe().invoices.voidInvoice(invoiceId);
}
