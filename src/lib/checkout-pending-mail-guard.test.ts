import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * P0-a の不変条件（第3版）: 受付メールは stripe_session_id の CAS 保存成功後・URL返却前に
 * scheduleAfterResponse 経由で after() に登録する／URL無しセッションは保存しない／巻き戻しは
 * rollbackCheckout に集約（DB解放→Stripe失効の順）／Stripeの失効時刻は Date.now() ＋安全マージン
 * （STRIPE_EXPIRY_SAFETY_SECONDS）。
 * 通知は after() に登録し最後まで await する（Promise.race 禁止。after() が追跡するのはコールバックが
 * 返す Promise までのため、途中でタイマー側が先に解決すると通知が追跡外になり完遂保証が消える）。
 * after() の登録自体が request scope 外・waitUntil 無しの環境で同期 throw することがあるため、
 * scheduleAfterResponse が登録失敗時に inline 実行へフォールバックし、決済本体には波及させない。
 * セッション ID は catch の外側の createdSessionId に保持し、CAS 成功後の想定外の例外でも
 * 作成済みセッションを巻き戻せるようにする。
 * 応答オブジェクトは after() 登録前に構築する（登録後に応答生成が throw して失効した URL の
 * メールが送られる経路を防ぐ）。inline フォールバックは総時間上限つき（PENDING_MAIL_FALLBACK_TIMEOUT_MS）。
 * checkout/route.ts のソースを直接読んで形を検査する（tier-server-only.test.ts と同じ方式）。
 *
 * 注記: "after(" だけだとコメント内の「after() で」という日本語文言にも一致してしまうため、
 * 実際の呼び出し文字列 "scheduleAfterResponse(" 等を使う。
 */

describe("checkout route: 仮予約受付メールのガード", () => {
  const content = readFileSync(
    path.join(process.cwd(), "src/app/api/checkout/route.ts"),
    "utf8"
  );

  it("notifyPendingPayment を runNotifyWithSlowLog 経由・scheduleAfterResponse(after, ...) の中で使っている", () => {
    expect(content.includes("notifyPendingPayment(")).toBe(true);
    expect(content.includes("runNotifyWithSlowLog(")).toBe(true);
    expect(/scheduleAfterResponse\(\s*after,/.test(content)).toBe(true);
  });

  it("Promise.race による打ち切りは行わない（after() が追跡するのはコールバックのPromiseまでのため）", () => {
    expect(content.includes("Promise.race")).toBe(false);
    expect(content.includes("PENDING_MAIL_TIMEOUT_MS")).toBe(false);
    expect(content.includes("PENDING_MAIL_SLOW_LOG_MS")).toBe(true);
  });

  it("inlineフォールバックの総時間上限つき定数と、登録前に構築した応答変数を使っている", () => {
    expect(content.includes("PENDING_MAIL_FALLBACK_TIMEOUT_MS")).toBe(true);
    expect(content.includes("const response = NextResponse.json({ url: checkoutUrl })")).toBe(true);
  });

  it("CAS保存エラー処理 → 応答構築 → scheduleAfterResponse登録 → 受付メール通知 → return response の順で書かれている", () => {
    const iErr = content.indexOf("セッションID保存エラー");
    const iResponse = content.indexOf("NextResponse.json({ url:");
    const iSchedule = content.indexOf("scheduleAfterResponse(");
    const iNotify = content.indexOf("notifyPendingPayment(");
    const iRet = content.indexOf("return response;");
    expect(iErr).not.toBe(-1);
    expect(iResponse).not.toBe(-1);
    expect(iSchedule).not.toBe(-1);
    expect(iNotify).not.toBe(-1);
    expect(iRet).not.toBe(-1);
    expect(iErr).toBeLessThan(iResponse);
    expect(iResponse).toBeLessThan(iSchedule);
    expect(iSchedule).toBeLessThan(iNotify);
    expect(iNotify).toBeLessThan(iRet);
  });

  it("URLなしセッションはstripe_session_idを保存する前にガードしている", () => {
    const iUrlGuard = content.indexOf("if (!session.url)");
    const iStripeId = content.indexOf("stripe_session_id: session.id");
    expect(iUrlGuard).not.toBe(-1);
    expect(iUrlGuard).toBeLessThan(iStripeId);
  });

  it("巻き戻しは CheckoutAbortError と rollbackCheckout に集約されている", () => {
    expect(content.includes("new CheckoutAbortError(")).toBe(true);
    expect(content.includes("rollbackCheckout(")).toBe(true);
  });

  it("Stripeセッションの直接失効は巻き戻し経路にしか無い（sessions.expire は1箇所のみ）", () => {
    expect(content.split("sessions.expire(").length - 1).toBe(1);
  });

  it("送信記録列を使っている", () => {
    expect(content.includes("pending_payment_email_sent_at")).toBe(true);
  });

  it("セッションIDはcatchの外側のcreatedSessionIdに保持し、セッション作成前に宣言、作成直後に代入、巻き戻しでも使われる", () => {
    expect(content.includes("let createdSessionId: string | null = null")).toBe(true);
    const iDeclare = content.indexOf("let createdSessionId");
    const iCreate = content.indexOf("stripe.checkout.sessions.create(");
    expect(iDeclare).not.toBe(-1);
    expect(iCreate).not.toBe(-1);
    expect(iDeclare).toBeLessThan(iCreate);
    expect(content.includes("createdSessionId = session.id")).toBe(true);
    expect(/e\.sessionId\s*:\s*createdSessionId/.test(content)).toBe(true);
  });

  it("Stripeの失効時刻は処理開始時のnowではなく作成直前のDate.now()＋安全マージンを基準にしている", () => {
    expect(/expires_at:\s*Math\.floor\(now\.getTime\(\)/.test(content)).toBe(false);
    expect(
      /expires_at:\s*Math\.floor\(Date\.now\(\)\s*\/\s*1000\)\s*\+\s*PENDING_HOLD_MINUTES\s*\*\s*60\s*\+\s*STRIPE_EXPIRY_SAFETY_SECONDS/.test(
        content
      )
    ).toBe(true);
  });
});
