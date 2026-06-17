/**
 * 段階制キャンセルポリシーの計算（インスタベース標準準拠）。
 *
 * デフォルト:
 *   8日以上前: 顧客負担0%（全額返金）
 *   7〜2日前: 50%
 *   前日・当日: 100%（返金なし）
 *
 * 拠点ごとに venues.cancellation_policy で上書き可能。
 */

export type CancellationTier = { days_before: number; percent: number };
export type CancellationPolicy = { tiers: CancellationTier[] };

export const DEFAULT_POLICY: CancellationPolicy = {
  tiers: [
    { days_before: 8, percent: 0 },
    { days_before: 2, percent: 50 },
    { days_before: 0, percent: 100 },
  ],
};

/** 利用開始までの残日数を計算（JST基準・小数点切り上げ前の整数日） */
export function daysUntil(startAt: Date, now: Date): number {
  const ms = startAt.getTime() - now.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export type RefundQuote = {
  /** 顧客負担割合（％） */
  feePercent: number;
  /** 返金額（円・整数） */
  refundAmount: number;
  /** キャンセル手数料（円・整数） */
  feeAmount: number;
  /** 適用された段階の説明（"利用日の8日以上前" 等） */
  tierLabel: string;
};

/**
 * 予約金額・開始時刻・ポリシーから返金額を計算する。
 * 何日前まで何%という階段関数を、上から順に判定する。
 */
export function calcRefund(
  totalAmount: number,
  startAt: Date,
  now: Date,
  policy: CancellationPolicy | null
): RefundQuote {
  const p = policy ?? DEFAULT_POLICY;
  const sorted = [...p.tiers].sort((a, b) => b.days_before - a.days_before);
  const lead = daysUntil(startAt, now);
  // lead >= tier.days_before の最も厳しい（残日数の小さい）段階を採用
  const matched =
    sorted.find((t) => lead >= t.days_before) ?? sorted[sorted.length - 1];
  const feePercent = matched.percent;
  const feeAmount = Math.floor((totalAmount * feePercent) / 100);
  const refundAmount = totalAmount - feeAmount;
  const tierLabel =
    matched.days_before === 0
      ? "利用日の前日・当日"
      : `利用日の${matched.days_before}日以上前`;
  return { feePercent, refundAmount, feeAmount, tierLabel };
}

/** ポリシーを人間向けに説明する文字列を作る（規約・確認画面表示用） */
export function describePolicy(policy: CancellationPolicy | null): string[] {
  const p = policy ?? DEFAULT_POLICY;
  const sorted = [...p.tiers].sort((a, b) => b.days_before - a.days_before);
  const lines: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    const next = sorted[i + 1];
    const refund = 100 - cur.percent;
    if (cur.days_before > 0 && next) {
      lines.push(`利用日の${cur.days_before}日前まで: ${refund}%返金（手数料${cur.percent}%）`);
    } else if (cur.days_before === 0) {
      lines.push(`利用日の前日・当日: ${refund}%返金（手数料${cur.percent}%）`);
    } else {
      lines.push(`利用日の${cur.days_before}日前まで: ${refund}%返金`);
    }
  }
  return lines;
}
