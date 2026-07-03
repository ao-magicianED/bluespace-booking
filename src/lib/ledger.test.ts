import { describe, expect, it } from "vitest";
import { realizedRevenue } from "./ledger";

describe("realizedRevenue", () => {
  it("未決済（unpaid）は実収0", () => {
    expect(
      realizedRevenue({
        payment_status: "unpaid",
        total_amount: 10000,
        refunded_amount: 0,
        extra_paid_amount: 0,
      })
    ).toBe(0);
  });

  it("全額決済・調整なしはtotal_amountそのまま", () => {
    expect(
      realizedRevenue({
        payment_status: "paid",
        total_amount: 10000,
        refunded_amount: 0,
        extra_paid_amount: 0,
      })
    ).toBe(10000);
  });

  it("通常キャンセル（キャンセル料あり・adjusted_total変更なし）は手数料分が実収になる（回帰防止）", () => {
    // 10,000円支払い→キャンセル、50%キャンセル料（返金5,000円）
    // このケースは adjusted_total を一切更新しない運用（executeCancellation）。
    expect(
      realizedRevenue({
        payment_status: "partially_refunded",
        total_amount: 10000,
        refunded_amount: 5000,
        extra_paid_amount: 0,
      })
    ).toBe(5000);
  });

  it("全額返金キャンセル（キャンセル料なし）は実収0", () => {
    expect(
      realizedRevenue({
        payment_status: "refunded",
        total_amount: 10000,
        refunded_amount: 10000,
        extra_paid_amount: 0,
      })
    ).toBe(0);
  });

  it("時間短縮による減額: 二重控除バグの回帰防止（10,000円→短縮で2,000円返金、実収は8,000円）", () => {
    // 修正前バグ: adjusted_total(8000) - refunded_amount(2000) = 6000円（誤り）
    // 修正後: total_amount(10000) + extra_paid_amount(0) - refunded_amount(2000) = 8000円
    expect(
      realizedRevenue({
        payment_status: "partially_refunded",
        total_amount: 10000,
        refunded_amount: 2000,
        extra_paid_amount: 0,
      })
    ).toBe(8000);
  });

  it("管理者による料金減額（adjust-price decrease）でも同様に二重控除しない", () => {
    // 10,000円→8,000円に減額（2,000円返金）、実収は8,000円
    expect(
      realizedRevenue({
        payment_status: "partially_refunded",
        total_amount: 10000,
        refunded_amount: 2000,
        extra_paid_amount: 0,
      })
    ).toBe(8000);
  });

  it("追加請求（price_increase）完了: 実収は当初+追加分", () => {
    // 10,000円→追加請求5,000円完了（extra_paid_amountに積み上がる）
    expect(
      realizedRevenue({
        payment_status: "paid",
        total_amount: 10000,
        refunded_amount: 0,
        extra_paid_amount: 5000,
      })
    ).toBe(15000);
  });

  it("予約延長の決済完了でも実収は当初+延長分", () => {
    expect(
      realizedRevenue({
        payment_status: "paid",
        total_amount: 10000,
        refunded_amount: 0,
        extra_paid_amount: 3000,
      })
    ).toBe(13000);
  });

  it("増額後に短縮（減額）が起きても、増額分は保持されたまま返金分だけ引かれる", () => {
    // 当初10,000円 → 増額+1,000円確定(extra_paid_amount=1000, 実質11,000円)
    // → 短縮で2,000円返金(refunded_amount=2000)
    // 実収 = 10,000 + 1,000 - 2,000 = 9,000円
    expect(
      realizedRevenue({
        payment_status: "partially_refunded",
        total_amount: 10000,
        refunded_amount: 2000,
        extra_paid_amount: 1000,
      })
    ).toBe(9000);
  });
});
