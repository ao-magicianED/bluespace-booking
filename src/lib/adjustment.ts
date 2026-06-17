import type { Booking } from "./types";

/** 調整後の実効金額を取得（adjusted_totalがnullならtotal_amountをそのまま使う） */
export function effectiveTotal(
  b: Pick<Booking, "total_amount" | "adjusted_total">
): number {
  return b.adjusted_total ?? b.total_amount;
}

/**
 * 予約に紐づく全てのStripe Payment Intent IDを返す（返金時に使う）。
 * メインPI → 追加請求のPI の順で返す。
 */
export async function collectPaymentIntents(
  bookingId: string,
  mainPiId: string | null,
  invoiceId: string | null,
  db: ReturnType<typeof import("./supabase").getDb>
): Promise<{ piId: string; maxRefundable: number }[]> {
  const pis: { piId: string; maxRefundable: number }[] = [];

  // メインPI（カード決済）
  if (mainPiId) {
    pis.push({ piId: mainPiId, maxRefundable: Infinity });
  } else if (invoiceId) {
    // 請求書払い: InvoiceのPaymentsからPIを取得
    try {
      const { getStripe } = await import("./stripe");
      const inv = await getStripe().invoices.retrieve(invoiceId, {
        expand: ["payments.data.payment_intent"],
      });
      const invPayment = inv.payments?.data?.[0];
      const pi = invPayment?.payment?.payment_intent;
      const piId = typeof pi === "string" ? pi : pi?.id;
      if (piId) pis.push({ piId, maxRefundable: Infinity });
    } catch {
      // PI取得不可 → 手動返金が必要
    }
  }

  // 追加請求のPI（booking_adjustmentsから取得）
  const { data: adjustments } = await db
    .from("booking_adjustments")
    .select("stripe_payment_intent_id, new_amount, previous_amount")
    .eq("booking_id", bookingId)
    .eq("adjustment_type", "price_increase")
    .eq("status", "completed")
    .not("stripe_payment_intent_id", "is", null)
    .order("created_at", { ascending: true });

  for (const adj of adjustments ?? []) {
    if (adj.stripe_payment_intent_id) {
      pis.push({
        piId: adj.stripe_payment_intent_id,
        maxRefundable: Infinity,
      });
    }
  }

  return pis;
}

/**
 * 複数のPayment Intentから指定金額を返金する。
 * リスト順に各PIから可能な限り返金し、不足分は次のPIへ進む。
 * 戻り値: 返金したRefund IDの配列と、返金できなかった残額。
 */
export async function refundFromPaymentIntents(
  pis: { piId: string }[],
  amount: number,
  idempotencyPrefix: string
): Promise<{ refundIds: string[]; remainingAmount: number }> {
  const { getStripe } = await import("./stripe");
  const stripe = getStripe();
  const refundIds: string[] = [];
  let remaining = amount;

  for (let i = 0; i < pis.length && remaining > 0; i++) {
    try {
      const r = await stripe.refunds.create(
        {
          payment_intent: pis[i].piId,
          amount: remaining,
          reason: "requested_by_customer",
        },
        { idempotencyKey: `${idempotencyPrefix}-${i}` }
      );
      refundIds.push(r.id);
      remaining = 0;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // 返金額がPI残額を超えた場合: そのPIの残額分だけ返金して次へ
      if (msg.includes("greater than")) {
        try {
          // PIの残額を確認
          const pi = await stripe.paymentIntents.retrieve(pis[i].piId);
          const charged = pi.amount;
          const alreadyRefunded = pi.amount - (pi.amount_received ?? pi.amount);
          // charges配列から正確な返金済額を取得
          let totalRefunded = 0;
          if (typeof pi.latest_charge === "string") {
            const ch = await stripe.charges.retrieve(pi.latest_charge);
            totalRefunded = ch.amount_refunded;
          }
          const refundable = charged - Math.max(alreadyRefunded, totalRefunded);
          if (refundable > 0) {
            const r = await stripe.refunds.create(
              {
                payment_intent: pis[i].piId,
                amount: refundable,
                reason: "requested_by_customer",
              },
              { idempotencyKey: `${idempotencyPrefix}-${i}-partial` }
            );
            refundIds.push(r.id);
            remaining -= refundable;
          }
        } catch {
          // このPIからの返金は諦めて次へ
        }
      }
    }
  }

  return { refundIds, remainingAmount: remaining };
}
