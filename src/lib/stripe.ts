import Stripe from "stripe";

/**
 * このシステムが作成したCheckout Session/PaymentIntentであることを示す目印。
 * 同一Stripeアカウントを他サービス（あおサロン等）と共有しているため、
 * Webhookで「このシステムの決済かどうか」をmetadataで判別するのに使う。
 *
 * Webhook側で新しく異常検知アラートを追加するときは、必ずこのタグでガードすること
 * （`session.metadata?.app !== STRIPE_APP_TAG` なら黙って無視）。
 * 忘れると他サービスの決済でアラートが誤発火する（例: booking_idのない決済検知）。
 */
export const STRIPE_APP_TAG = "bluespace-booking";

let stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY が未設定です");
    stripe = new Stripe(key);
  }
  return stripe;
}
