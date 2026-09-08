/**
 * レスポンス返却後に実行したい処理の登録。
 * Next.js の after() は request scope の外や waitUntil の無い環境では**登録時に同期 throw** する。
 * 登録失敗を呼び出し元（決済本体）に波及させず、その場で実行する
 * （メールを落とすより利用者を少し待たせる方がまし）。この関数自体は throw しない。
 *
 * ただし inline 実行は呼び出し元の応答を止め得る（Resend 等の fetch にタイムアウトが無い）ため、
 * フォールバック経路だけは総時間上限を設け、超過時は劣化ログを残して戻る（応答を優先。
 * task 自体は継続し得るが完遂は保証されない）。登録成功時の after() 内は上限を設けず最後まで待つ。
 */
export type ScheduleAfterResponseHooks = {
  /** after() の登録が throw したとき／フォールバック実行中に task が throw したとき */
  onRegisterError: (e: unknown) => void;
  /** フォールバック実行が fallbackTimeoutMs 以内に完了しなかったとき */
  onFallbackTimeout: () => void;
};

export async function scheduleAfterResponse(
  afterFn: (task: () => Promise<void>) => void,
  task: () => Promise<void>,
  hooks: ScheduleAfterResponseHooks,
  fallbackTimeoutMs: number
): Promise<void> {
  // 二重実行防止: afterFn が「登録してから同期 throw」する実装でも task は1回しか走らない
  let started = false;
  const runOnce = async () => {
    if (started) return;
    started = true;
    await task();
  };

  try {
    afterFn(runOnce);
    return;
  } catch (e) {
    hooks.onRegisterError(e);
  }

  // --- フォールバック（inline 実行・総時間上限つき）---
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), fallbackTimeoutMs);
  });
  try {
    const result = await Promise.race([runOnce().then(() => "done" as const), deadline]);
    if (result === "timeout") hooks.onFallbackTimeout();
  } catch (taskErr) {
    hooks.onRegisterError(taskErr);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
