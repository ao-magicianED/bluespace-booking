import { describe, expect, it, vi } from "vitest";
import { CheckoutAbortError, rollbackCheckout } from "./checkout-rollback";

const baseCtx = { bookingId: "b-1", sessionId: "cs_test_abc123", reason: "テスト理由" };

describe("rollbackCheckout", () => {
  it("DB解放がStripe失効より先に呼ばれる", async () => {
    const order: string[] = [];
    const releaseBooking = vi.fn(async () => {
      order.push("release");
      return { error: null };
    });
    const expireSession = vi.fn(async () => {
      order.push("expire");
      return undefined;
    });
    await rollbackCheckout(baseCtx, { releaseBooking, expireSession });
    expect(order).toEqual(["release", "expire"]);
  });

  it("expireSessionがthrowしてもthrowせず released:true, sessionExpired:false を返す", async () => {
    const releaseBooking = vi.fn(async () => ({ error: null }));
    const expireSession = vi.fn(async () => {
      throw new Error("stripe timeout");
    });
    const result = await rollbackCheckout(baseCtx, { releaseBooking, expireSession });
    expect(result).toEqual({ released: true, sessionExpired: false });
  });

  it("releaseBookingが{ error }を返してもStripe失効は試み、released:false", async () => {
    const releaseBooking = vi.fn(async () => ({ error: { message: "update failed" } }));
    const expireSession = vi.fn(async () => undefined);
    const result = await rollbackCheckout(baseCtx, { releaseBooking, expireSession });
    expect(result.released).toBe(false);
    expect(expireSession).toHaveBeenCalledTimes(1);
  });

  it("releaseBookingがthrowしても released:false でStripe失効は試みる", async () => {
    const releaseBooking = vi.fn(async () => {
      throw new Error("db down");
    });
    const expireSession = vi.fn(async () => undefined);
    const result = await rollbackCheckout(baseCtx, { releaseBooking, expireSession });
    expect(result.released).toBe(false);
    expect(expireSession).toHaveBeenCalledTimes(1);
  });

  it("sessionId が null なら expireSession は呼ばれず sessionExpired は null", async () => {
    const releaseBooking = vi.fn(async () => ({ error: null }));
    const expireSession = vi.fn(async () => undefined);
    const result = await rollbackCheckout(
      { ...baseCtx, sessionId: null },
      { releaseBooking, expireSession }
    );
    expect(expireSession).not.toHaveBeenCalled();
    expect(result.sessionExpired).toBeNull();
  });

  it("CheckoutAbortError は sessionId と name を持ち Error のインスタンスである", () => {
    const err = new CheckoutAbortError("失敗しました", "cs_test_xyz");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CheckoutAbortError");
    expect(err.sessionId).toBe("cs_test_xyz");
    expect(err.message).toBe("失敗しました");
  });
});
