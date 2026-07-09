import { describe, expect, it } from "vitest";
import { paymentStatusAfterRefund } from "./adjustment";
import { realizedRevenue } from "./ledger";

describe("paymentStatusAfterRefund", () => {
  it("全額返金で refunded", () => {
    expect(
      paymentStatusAfterRefund(
        { total_amount: 10000, extra_paid_amount: 0, refunded_amount: 0 },
        10000
      )
    ).toBe("refunded");
  });

  it("一部返金は partially_refunded", () => {
    expect(
      paymentStatusAfterRefund(
        { total_amount: 10000, extra_paid_amount: 0, refunded_amount: 0 },
        4000
      )
    ).toBe("partially_refunded");
  });

  it("過去の返金と合算して全額に達したら refunded", () => {
    // 短縮で2,000円返金済み → キャンセルで残り8,000円を返金
    expect(
      paymentStatusAfterRefund(
        { total_amount: 10000, extra_paid_amount: 0, refunded_amount: 2000 },
        8000
      )
    ).toBe("refunded");
  });

  it("増額分が残っていれば total_amount 以上返金しても partially_refunded（実収0円バグの回帰防止）", () => {
    // 当初10,000円 + 追加請求5,000円完了 → 大幅減額で12,000円返金。
    // 手元には3,000円残るので refunded にしてはいけない。
    // 旧実装（refunded >= total_amount で判定）だと refunded になり、
    // realizedRevenue() が対象外＝実収0円として過小集計されていた。
    const booking = { total_amount: 10000, extra_paid_amount: 5000, refunded_amount: 0 };
    const status = paymentStatusAfterRefund(booking, 12000);
    expect(status).toBe("partially_refunded");
    expect(
      realizedRevenue({ payment_status: status, ...booking, refunded_amount: 12000 })
    ).toBe(3000);
  });

  it("増額分も含めて全額返金しきったら refunded", () => {
    expect(
      paymentStatusAfterRefund(
        { total_amount: 10000, extra_paid_amount: 5000, refunded_amount: 3000 },
        12000
      )
    ).toBe("refunded");
  });

  it("extra_paid_amount / refunded_amount が未設定（null相当）でも動く", () => {
    expect(
      paymentStatusAfterRefund(
        {
          total_amount: 10000,
          extra_paid_amount: null as unknown as number,
          refunded_amount: null as unknown as number,
        },
        10000
      )
    ).toBe("refunded");
  });
});
