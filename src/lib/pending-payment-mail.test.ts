import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildPendingPaymentMail,
  formatJstDateTime,
  notifyPendingPayment,
  runNotifyWithSlowLog,
  type PendingPaymentNotifyResult,
} from "./pending-payment-mail";

describe("formatJstDateTime", () => {
  it("UTCをJSTに変換して整形する", () => {
    expect(formatJstDateTime(new Date("2026-09-08T07:38:00Z"))).toBe("2026年9月8日 16:38");
  });

  it("分は2桁ゼロ埋めする", () => {
    expect(formatJstDateTime(new Date("2026-09-08T07:05:00Z"))).toBe("2026年9月8日 16:05");
  });

  it("日付・年またぎも正しく繰り上がる", () => {
    expect(formatJstDateTime(new Date("2026-12-31T15:30:00Z"))).toBe("2027年1月1日 0:30");
  });
});

describe("buildPendingPaymentMail", () => {
  const baseInput = {
    customerName: "山田 太郎",
    label: "ブルースペース京成小岩 2026-09-08 17:30〜18:30（1時間）",
    partySize: 3,
    amount: 1000,
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_abc123",
    expiresAt: new Date("2026-09-08T07:38:00Z"),
    rebookUrl: "https://bluespacerental.com/keisei-koiwa",
  };

  it("件名は【仮予約受付】で始まりlabelを含み、【予約確定】は含まない", () => {
    const { subject } = buildPendingPaymentMail(baseInput);
    expect(subject.startsWith("【仮予約受付】")).toBe(true);
    expect(subject).toContain(baseInput.label);
    expect(subject).not.toContain("【予約確定】");
  });

  it("本文にcheckoutUrlとrebookUrlがそのまま含まれる", () => {
    const { text } = buildPendingPaymentMail(baseInput);
    expect(text).toContain(baseInput.checkoutUrl);
    expect(text).toContain(baseInput.rebookUrl);
  });

  it("本文に金額をカンマ区切りで含む", () => {
    const { text } = buildPendingPaymentMail(baseInput);
    expect(text).toContain("金額: ¥1,000");
    const { text: text2 } = buildPendingPaymentMail({ ...baseInput, amount: 1234567 });
    expect(text2).toContain("金額: ¥1,234,567");
  });

  it("本文にお支払い期限（日本時間）を含む", () => {
    const { text } = buildPendingPaymentMail(baseInput);
    expect(text).toContain("お支払い期限: 2026年9月8日 16:38（日本時間");
  });

  it("本文に必須の案内文言を含む", () => {
    const { text } = buildPendingPaymentMail(baseInput);
    expect(text).toContain("仮予約");
    expect(text).toContain("予約確定ではありません");
    expect(text).toContain("確定のご案内メール");
    expect(text).toContain("ご利用人数: 3名");
    expect(text).toContain("転送・共有");
    expect(text).toContain("心当たりがない");
    expect(text).toContain("お支払いが完了しないまま仮予約が失効した場合");
  });

  it("「様専用」は含まず、bearerリンクの実態に合わせた注意書きになっている", () => {
    const { text } = buildPendingPaymentMail(baseInput);
    expect(text).not.toContain("様専用");
  });

  it("本文に自動キャンセル・キャンセル料の文言を含まない", () => {
    const { text } = buildPendingPaymentMail(baseInput);
    expect(text).not.toContain("自動キャンセル");
    expect(text).not.toContain("キャンセル料");
  });
});

describe("notifyPendingPayment", () => {
  const baseParams = {
    customerName: "山田 太郎",
    label: "ブルースペース京成小岩 2026-09-08 17:30〜18:30（1時間）",
    partySize: 3,
    amount: 1000,
    checkoutUrl: "https://checkout.stripe.com/c/pay/cs_test_abc123",
    expiresAt: new Date("2026-09-08T07:38:00Z"),
    rebookUrl: "https://bluespacerental.com/keisei-koiwa",
    bookingId: "b-1",
    sessionId: "cs_test_abc123",
    email: "taro@example.com",
    phone: "09012345678",
  };

  it("送信成功: sendMailがbuilderと同じsubject/textで呼ばれ、markSentが記録し、sentを返す", async () => {
    const { subject, text } = buildPendingPaymentMail(baseParams);
    const sendMail = vi.fn(async (_mail: { to: string; subject: string; text: string }) => true);
    const sendAdminAlert = vi.fn(async (_subject: string, _text: string) => undefined);
    const markSent = vi.fn(async (_bookingId: string, _sentAtIso: string) => ({ error: null as { message: string } | null }));

    const result = await notifyPendingPayment(baseParams, { sendMail, sendAdminAlert, markSent });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledWith({ to: "taro@example.com", subject, text });
    expect(markSent).toHaveBeenCalledTimes(1);
    const [calledBookingId, calledSentAt] = markSent.mock.calls[0];
    expect(calledBookingId).toBe("b-1");
    expect(() => new Date(calledSentAt).toISOString()).not.toThrow();
    expect(new Date(calledSentAt).toISOString()).toBe(calledSentAt);
    expect(sendAdminAlert).not.toHaveBeenCalled();
    expect(result).toBe("sent");
  });

  it("sendMailがfalse: sendAdminAlertが1回呼ばれ、本文にbookingId/sessionIdを含みcheckoutUrlは含まない。markSentは呼ばれず send_failed を返す", async () => {
    const sendMail = vi.fn(async (_mail: { to: string; subject: string; text: string }) => false);
    const sendAdminAlert = vi.fn(async (_subject: string, _text: string) => undefined);
    const markSent = vi.fn(async (_bookingId: string, _sentAtIso: string) => ({ error: null as { message: string } | null }));

    const result = await notifyPendingPayment(baseParams, { sendMail, sendAdminAlert, markSent });

    expect(sendAdminAlert).toHaveBeenCalledTimes(1);
    const [alertSubject, alertText] = sendAdminAlert.mock.calls[0];
    expect(alertText).toContain("b-1");
    expect(alertText).toContain("cs_test_abc123");
    expect(alertText).not.toContain(baseParams.checkoutUrl);
    expect(alertSubject).not.toContain(baseParams.checkoutUrl);
    expect(markSent).not.toHaveBeenCalled();
    expect(result).toBe("send_failed");
  });

  it("markSentがエラーを返す: mark_failed を返し、sendAdminAlertは呼ばれない", async () => {
    const sendMail = vi.fn(async (_mail: { to: string; subject: string; text: string }) => true);
    const sendAdminAlert = vi.fn(async (_subject: string, _text: string) => undefined);
    const markSent = vi.fn(async (_bookingId: string, _sentAtIso: string) => ({ error: { message: "column does not exist" } as { message: string } | null }));

    const result = await notifyPendingPayment(baseParams, { sendMail, sendAdminAlert, markSent });

    expect(result).toBe("mark_failed");
    expect(sendAdminAlert).not.toHaveBeenCalled();
  });
});

describe("runNotifyWithSlowLog", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("遅延観測: 8秒を過ぎるとonSlowを呼ぶが、通知が終わるまで戻り値は確定しない", async () => {
    let resolveNotify!: (v: PendingPaymentNotifyResult) => void;
    const deferred = new Promise<PendingPaymentNotifyResult>((resolve) => {
      resolveNotify = resolve;
    });
    const onSlow = vi.fn();
    const onError = vi.fn();

    const run = runNotifyWithSlowLog(() => deferred, {
      slowAfterMs: 8000,
      onSlow,
      onError,
    });
    let settled = false;
    run.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(8000);
    expect(onSlow).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveNotify("sent");
    expect(await run).toBe("sent");
  });

  it("速い場合: 即座に完了すればonSlowは呼ばれず戻り値がそのまま返る", async () => {
    const onSlow = vi.fn();
    const onError = vi.fn();

    const result = await runNotifyWithSlowLog(async () => "sent", {
      slowAfterMs: 8000,
      onSlow,
      onError,
    });

    expect(result).toBe("sent");
    await vi.advanceTimersByTimeAsync(8000);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it("throw: onErrorが1回呼ばれ\"error\"を返し、onSlowは呼ばれない", async () => {
    const notifyError = new Error("mail api down");
    const onSlow = vi.fn();
    const onError = vi.fn();

    const result = await runNotifyWithSlowLog(
      async () => {
        throw notifyError;
      },
      { slowAfterMs: 8000, onSlow, onError }
    );

    expect(result).toBe("error");
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(notifyError);
    expect(onSlow).not.toHaveBeenCalled();
  });
});
