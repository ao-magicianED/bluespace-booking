import { JST_OFFSET_MS } from "./slots";

/**
 * カード決済の仮予約受付メール（Checkout URL入り）を組み立てる純関数群。
 * P0-a（docs/pending-payment-recovery-design.md）: 決済画面を閉じた利用者が
 * 支払いを再開する手段を持てるよう、Stripe Checkout の URL と期限を案内する。
 * マイページURLは載せない（P1まで支払いボタンが無く、案内どおりにしても何もできないため）。
 */

export type PendingPaymentMailInput = {
  customerName: string;
  /** 例: "ブルースペース京成小岩 2026-09-08 17:30〜18:30（1時間）"（checkout route の label と同形式） */
  label: string;
  partySize: number;
  amount: number;
  /** Stripe Checkout セッションの URL（bearer リンク。本人宛メール本文にのみ載せる） */
  checkoutUrl: string;
  /** Stripe が返したセッションの実失効時刻（UTC） */
  expiresAt: Date;
  /** 期限切れ後に取り直すための拠点ページURL */
  rebookUrl: string;
};

/**
 * 日本時間（JST固定オフセット）で "2026年9月8日 16:38" 形式に整形する。
 * toLocaleString は使わない（実行環境のタイムゾーン・ICUに依存させないため）。
 */
export function formatJstDateTime(d: Date): string {
  const jst = new Date(d.getTime() + JST_OFFSET_MS);
  const year = jst.getUTCFullYear();
  const month = jst.getUTCMonth() + 1;
  const day = jst.getUTCDate();
  const hour = jst.getUTCHours();
  const minute = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${year}年${month}月${day}日 ${hour}:${minute}`;
}

export function buildPendingPaymentMail(
  input: PendingPaymentMailInput
): { subject: string; text: string } {
  const { customerName, label, partySize, amount, checkoutUrl, expiresAt, rebookUrl } = input;
  const subject = `【仮予約受付】${label} お支払いのご案内`;
  const text = [
    `${customerName} 様`,
    ``,
    `ご予約ありがとうございます。以下の内容で仮予約（仮押さえ）を受け付けました。`,
    `お支払いの完了をもって本予約が確定します。まだ予約確定ではありませんのでご注意ください。`,
    ``,
    `▼ご予約内容`,
    `拠点・日時: ${label}`,
    `ご利用人数: ${partySize}名`,
    `金額: ¥${amount.toLocaleString("ja-JP")}`,
    `お支払い期限: ${formatJstDateTime(expiresAt)}（日本時間・お手続き開始から約30分）`,
    ``,
    `▼お支払いはこちら`,
    `決済画面を閉じてしまった場合も、期限内であれば下記のリンクから同じお支払いを再開できます。`,
    `${checkoutUrl}`,
    `※このリンクはURLを知る方がどなたでもアクセスできます。転送・共有はしないでください。`,
    `※心当たりがない場合はお支払いをせず、このメールへの返信でご連絡ください。`,
    ``,
    `▼期限を過ぎた場合`,
    `期限を過ぎると上記のお支払いリンクは利用できなくなり、仮予約は順次失効します。お支払いが完了しないまま仮予約が失効した場合、この仮予約について料金は発生しません。`,
    `期限の直前にお支払い操作をされた場合は、確定のご案内メールの有無とカードのご利用明細をご確認ください。`,
    `空き状況への反映には10分ほどかかる場合があります。引き続きご利用をご希望の場合は、反映後に空き状況をご確認のうえ、改めてお申し込みください（同じ日時の空きを保証するものではありません）。`,
    `${rebookUrl}`,
    ``,
    `お支払いが完了しましたら、確定のご案内メールを別途お送りします。`,
    ``,
    `ブルーステージ合同会社`,
  ].join("\n");
  return { subject, text };
}

export type PendingPaymentNotifyParams = PendingPaymentMailInput & {
  bookingId: string;
  sessionId: string;
  email: string;
  phone: string;
};

export type PendingPaymentNotifyDeps = {
  sendMail: (mail: { to: string; subject: string; text: string }) => Promise<boolean>;
  sendAdminAlert: (subject: string, text: string) => Promise<unknown>;
  /** pending_payment_email_sent_at を記録する。PostgREST 流儀で { error } を返し、throw しない */
  markSent: (bookingId: string, sentAtIso: string) => Promise<{ error: { message: string } | null }>;
};

export type PendingPaymentNotifyResult = "sent" | "send_failed" | "mark_failed";

/**
 * カード決済の仮予約受付メール（Checkout URL入り）を送り、受理できたら送信記録を残す。
 * 呼び出し側の契約: stripe_session_id の CAS 保存が成功した後にだけ呼ぶこと
 * （保存失敗→巻き戻し後に「生きて見える決済リンク」だけが利用者の手元に残るのを防ぐ）。
 * 送信失敗は throw せず管理者へフォロー依頼を出す（メール基盤の異常は離脱とは別問題）。
 * Checkout URL は bearer リンクなので通知・ログには載せない。
 * 外部I/Oは全て deps 経由（テストで差し替えるため）。
 */
export async function notifyPendingPayment(
  params: PendingPaymentNotifyParams,
  deps: PendingPaymentNotifyDeps
): Promise<PendingPaymentNotifyResult> {
  const { subject, text } = buildPendingPaymentMail(params);
  const ok = await deps.sendMail({ to: params.email, subject, text });
  if (!ok) {
    console.error(`[checkout] 仮予約受付メール送信失敗 booking=${params.bookingId}`);
    await deps.sendAdminAlert(
      "⚠️ 仮予約受付メール送信失敗（要フォロー）",
      [
        `お客様への仮予約受付メール（お支払いリンク入り）の送信に失敗しました。`,
        `お客様が決済画面を閉じてしまった場合、支払いを再開する手段がありません。`,
        `期限内に決済が完了しない場合は、お客様への連絡（電話等）をご検討ください。`,
        ``,
        `拠点: ${params.label}`,
        `お客様: ${params.customerName} <${params.email}> ${params.phone}`,
        `金額: ¥${params.amount.toLocaleString("ja-JP")}`,
        `お支払い期限: ${formatJstDateTime(params.expiresAt)}（日本時間）`,
        `予約ID: ${params.bookingId}`,
        `Stripeセッション: ${params.sessionId}`,
      ].join("\n")
    );
    return "send_failed";
  }
  // 送信受理の記録（best-effort）。CAS の update には同居させない：
  // マイグレーション未適用でこの列が無くても、壊れるのはこの記録だけで決済は継続できる。
  // booking_status 条件は付けない（送信直後に Webhook で confirmed になっても送信事実は残す）
  const { error } = await deps.markSent(params.bookingId, new Date().toISOString());
  if (error) {
    console.error("[checkout] 受付メール送信記録の更新失敗（決済は継続）:", error.message);
    return "mark_failed";
  }
  return "sent";
}

/**
 * after() から呼ぶ本体。通知を**最後まで await** し、遅いときはログを出すだけで打ち切らない。
 * after() が追跡するのはコールバックが返す Promise までなので、Promise.race でタイマー側が先に
 * 解決すると通知は追跡外になり、サーバーレスでは完遂保証が消える（第2版の不具合）。
 * throw しない（after() 内の未処理例外を作らない）。
 */
export async function runNotifyWithSlowLog(
  notify: () => Promise<PendingPaymentNotifyResult>,
  opts: { slowAfterMs: number; onSlow: () => void; onError: (e: unknown) => void }
): Promise<PendingPaymentNotifyResult | "error"> {
  const timer = setTimeout(opts.onSlow, opts.slowAfterMs);
  try {
    return await notify();
  } catch (e) {
    opts.onError(e);
    return "error";
  } finally {
    clearTimeout(timer);
  }
}
