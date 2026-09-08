import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleAfterResponse } from "./after-response";

describe("scheduleAfterResponse", () => {
  const fallbackTimeoutMs = 8000;

  afterEach(() => {
    vi.useRealTimers();
  });

  it("登録成功: afterFnがtaskを1回受け取り、taskはその場では実行されない。記録した関数を後から2回呼んでもtaskは1回だけ実行される", async () => {
    const task = vi.fn(async () => {});
    let registered: (() => Promise<void>) | undefined;
    const afterFn = vi.fn((t: () => Promise<void>) => {
      registered = t;
    });
    const hooks = { onRegisterError: vi.fn(), onFallbackTimeout: vi.fn() };

    await scheduleAfterResponse(afterFn, task, hooks, fallbackTimeoutMs);

    expect(afterFn).toHaveBeenCalledTimes(1);
    expect(task).not.toHaveBeenCalled();
    expect(hooks.onRegisterError).not.toHaveBeenCalled();
    expect(hooks.onFallbackTimeout).not.toHaveBeenCalled();

    // run-once: 記録した関数を2回呼んでもtaskは1回だけ実行される
    expect(registered).toBeDefined();
    await registered!();
    await registered!();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("登録throw: onRegisterErrorが1回呼ばれ、taskがinlineで1回実行される。onFallbackTimeoutは未呼出。関数はthrowしない", async () => {
    const task = vi.fn(async () => {});
    const registerError = new Error("register failed");
    const afterFn = vi.fn(() => {
      throw registerError;
    });
    const hooks = { onRegisterError: vi.fn(), onFallbackTimeout: vi.fn() };

    await expect(
      scheduleAfterResponse(afterFn, task, hooks, fallbackTimeoutMs)
    ).resolves.toBeUndefined();

    expect(hooks.onRegisterError).toHaveBeenCalledTimes(1);
    expect(hooks.onRegisterError).toHaveBeenCalledWith(registerError);
    expect(task).toHaveBeenCalledTimes(1);
    expect(hooks.onFallbackTimeout).not.toHaveBeenCalled();
  });

  it("登録throwかつtaskもthrow: onRegisterErrorが2回呼ばれ、関数はthrowしない", async () => {
    const taskError = new Error("task failed");
    const task = vi.fn(async () => {
      throw taskError;
    });
    const registerError = new Error("register failed");
    const afterFn = vi.fn(() => {
      throw registerError;
    });
    const hooks = { onRegisterError: vi.fn(), onFallbackTimeout: vi.fn() };

    await expect(
      scheduleAfterResponse(afterFn, task, hooks, fallbackTimeoutMs)
    ).resolves.toBeUndefined();

    expect(hooks.onRegisterError).toHaveBeenCalledTimes(2);
    expect(hooks.onRegisterError).toHaveBeenNthCalledWith(1, registerError);
    expect(hooks.onRegisterError).toHaveBeenNthCalledWith(2, taskError);
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("登録してからthrow: taskは1回だけ実行される（inline側はrun-onceで即戻る）", async () => {
    const task = vi.fn(async () => {});
    const afterFn = (t: () => Promise<void>) => {
      void t();
      throw new Error("late");
    };
    const hooks = { onRegisterError: vi.fn(), onFallbackTimeout: vi.fn() };

    await scheduleAfterResponse(afterFn, task, hooks, fallbackTimeoutMs);

    expect(task).toHaveBeenCalledTimes(1);
  });

  it("フォールバックのタイムアウト: 8000ms経過でonFallbackTimeoutが1回、onRegisterErrorは登録失敗の1回のみ", async () => {
    vi.useFakeTimers();
    const task = vi.fn(() => new Promise<void>(() => {}));
    const registerError = new Error("register failed");
    const afterFn = vi.fn(() => {
      throw registerError;
    });
    const hooks = { onRegisterError: vi.fn(), onFallbackTimeout: vi.fn() };

    const run = scheduleAfterResponse(afterFn, task, hooks, fallbackTimeoutMs);
    await vi.advanceTimersByTimeAsync(8000);
    await run;

    expect(hooks.onFallbackTimeout).toHaveBeenCalledTimes(1);
    expect(hooks.onRegisterError).toHaveBeenCalledTimes(1);
    expect(hooks.onRegisterError).toHaveBeenCalledWith(registerError);
  });

  it("フォールバックが期限内に完了: onFallbackTimeoutは未呼出（その後8000ms進めても呼ばれない）", async () => {
    vi.useFakeTimers();
    const task = vi.fn(async () => {});
    const registerError = new Error("register failed");
    const afterFn = vi.fn(() => {
      throw registerError;
    });
    const hooks = { onRegisterError: vi.fn(), onFallbackTimeout: vi.fn() };

    const run = scheduleAfterResponse(afterFn, task, hooks, fallbackTimeoutMs);
    await run;

    expect(hooks.onFallbackTimeout).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8000);
    expect(hooks.onFallbackTimeout).not.toHaveBeenCalled();
  });
});
