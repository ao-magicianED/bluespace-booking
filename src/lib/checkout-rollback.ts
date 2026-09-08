/**
 * カード決済フローの巻き戻し（仮押さえ解放＋Stripe Checkout セッション失効）。
 * 順序は必ず「DB 解放 → Stripe 失効」。Stripe への到達待ち（SDK 既定は 80 秒×再試行 2 回）で
 * 関数の実行上限に達し、DB の解放に辿り着かないまま「URL の無い pending」が残るのを防ぐ。
 * どちらが失敗しても throw しない（結果を返し、呼び出し側でログ・通知に使う）。
 */
export type CheckoutRollbackDeps = {
  /** bookings を pending→expired にする。PostgREST 流儀で { error } を返す */
  releaseBooking: () => Promise<{ error: { message: string } | null }>;
  /** Stripe セッション失効。route 側で時間上限つき・再試行なしの RequestOptions を渡して呼ぶこと */
  expireSession: (sessionId: string) => Promise<unknown>;
};

export type CheckoutRollbackResult = {
  released: boolean;
  /** セッション未作成なら null */
  sessionExpired: boolean | null;
};

/** カード分岐の途中失敗を外側 catch まで運ぶ（作成済みセッションIDを添えて巻き戻しに使う） */
export class CheckoutAbortError extends Error {
  constructor(message: string, readonly sessionId: string | null) {
    super(message);
    this.name = "CheckoutAbortError";
  }
}

export async function rollbackCheckout(
  ctx: { bookingId: string; sessionId: string | null; reason: string },
  deps: CheckoutRollbackDeps
): Promise<CheckoutRollbackResult> {
  let released = false;
  try {
    const { error } = await deps.releaseBooking();
    if (error) {
      console.error(
        `[checkout] 仮押さえ解放失敗 booking=${ctx.bookingId} reason=${ctx.reason}:`,
        error.message
      );
    } else {
      released = true;
    }
  } catch (e) {
    console.error(`[checkout] 仮押さえ解放失敗 booking=${ctx.bookingId} reason=${ctx.reason}:`, e);
  }

  let sessionExpired: boolean | null = null;
  if (ctx.sessionId) {
    try {
      await deps.expireSession(ctx.sessionId);
      sessionExpired = true;
    } catch (e) {
      console.error("[checkout] セッション失効失敗:", e);
      sessionExpired = false;
    }
  }

  return { released, sessionExpired };
}
