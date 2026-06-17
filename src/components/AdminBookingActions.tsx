"use client";

import { useState } from "react";

/** 管理者用: キャンセル返金・カレンダー再同期・料金変更のワンクリック操作 */
export default function AdminBookingActions({
  bookingId,
  canCancel,
  policyRefund,
  fullRefund,
  effectiveAmount,
  syncFailed,
}: {
  bookingId: string;
  canCancel: boolean;
  policyRefund: number;
  fullRefund: number;
  effectiveAmount: number;
  syncFailed: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  // 料金変更フォーム
  const [showAdjust, setShowAdjust] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState(effectiveAmount.toString());
  const [adjustReason, setAdjustReason] = useState("");

  // カスタムキャンセルフォーム
  const [showCustomCancel, setShowCustomCancel] = useState(false);
  const [customFee, setCustomFee] = useState("0");

  async function call(api: string, payload: object, confirmText: string, label: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const res = await fetch(api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setError(j.error ?? "処理に失敗しました");
      } else {
        let msg = "処理が完了しました。ページを再読み込みします...";
        if (j.type === "increase" && j.checkoutUrl) {
          msg = `お客様に追加お支払いリンクをメールで送信しました（¥${j.chargeAmount?.toLocaleString()}）。ページを再読み込みします...`;
        }
        if (j.manualRefundNeeded > 0) {
          msg = `返金処理完了（¥${j.manualRefundNeeded.toLocaleString()} は手動返金が必要です）。ページを再読み込みします...`;
        }
        setMessage(msg);
        setTimeout(() => window.location.reload(), 1500);
      }
    } catch {
      setError("通信エラーが発生しました");
    }
    setBusy("");
  }

  const parsedAdjust = parseInt(adjustAmount, 10);
  const adjustValid =
    !isNaN(parsedAdjust) && parsedAdjust >= 0 && parsedAdjust !== effectiveAmount && adjustReason.trim() !== "";
  const adjustDelta = parsedAdjust - effectiveAmount;

  const parsedFee = parseInt(customFee, 10);
  const feeValid = !isNaN(parsedFee) && parsedFee >= 0 && parsedFee <= effectiveAmount;
  const customRefund = effectiveAmount - (feeValid ? parsedFee : 0);

  return (
    <div className="admin-actions">
      <h3>操作</h3>
      <div className="admin-action-buttons">
        {/* --- 料金変更 --- */}
        {canCancel && (
          <button className="admin-btn" disabled={busy !== ""} onClick={() => setShowAdjust(!showAdjust)}>
            💰 料金を変更する
          </button>
        )}

        {showAdjust && (
          <div className="admin-form-panel">
            <label>
              新しい金額（税込・円）:
              <input
                type="number"
                min={0}
                max={1000000}
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                style={{ width: "120px", marginLeft: "8px" }}
              />
            </label>
            {adjustValid && (
              <p className="policy" style={{ margin: "4px 0" }}>
                {adjustDelta < 0
                  ? `▼ ¥${Math.abs(adjustDelta).toLocaleString()} を返金します`
                  : `▲ ¥${adjustDelta.toLocaleString()} を追加請求します（お客様にメールで決済リンクを送信）`}
              </p>
            )}
            <label style={{ display: "block", marginTop: "8px" }}>
              変更理由（必須）:
              <input
                type="text"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="例: 利用時間を3h→2hに短縮"
                style={{ width: "100%", marginTop: "4px" }}
              />
            </label>
            <button
              className="admin-btn"
              disabled={busy !== "" || !adjustValid}
              style={{ marginTop: "8px" }}
              onClick={() =>
                call(
                  "/api/admin/adjust-price",
                  { bookingId, newAmount: parsedAdjust, reason: adjustReason.trim() },
                  adjustDelta < 0
                    ? `¥${effectiveAmount.toLocaleString()} → ¥${parsedAdjust.toLocaleString()}（¥${Math.abs(adjustDelta).toLocaleString()} 返金）\n理由: ${adjustReason}\n\n実行しますか？`
                    : `¥${effectiveAmount.toLocaleString()} → ¥${parsedAdjust.toLocaleString()}（¥${adjustDelta.toLocaleString()} 追加請求）\nお客様にお支払いリンクをメール送信します。\n理由: ${adjustReason}\n\n実行しますか？`,
                  "adjust"
                )
              }
            >
              {busy === "adjust"
                ? "処理中..."
                : adjustDelta < 0
                  ? `減額して ¥${Math.abs(adjustDelta).toLocaleString()} を返金`
                  : `増額して ¥${adjustDelta.toLocaleString()} を追加請求`}
            </button>
          </div>
        )}

        {/* --- キャンセル --- */}
        {canCancel && (
          <>
            <button
              className="admin-btn danger"
              disabled={busy !== ""}
              onClick={() =>
                call(
                  "/api/admin/cancel",
                  { bookingId, mode: "policy" },
                  `規定どおり ¥${policyRefund.toLocaleString()} を返金してキャンセルします。よろしいですか？\n（Stripe返金・カレンダー削除・お客様へのメールまで自動実行されます）`,
                  "policy"
                )
              }
            >
              {busy === "policy" ? "処理中..." : `キャンセル（規定返金 ¥${policyRefund.toLocaleString()}）`}
            </button>
            <button
              className="admin-btn danger"
              disabled={busy !== ""}
              onClick={() =>
                call(
                  "/api/admin/cancel",
                  { bookingId, mode: "full" },
                  `全額 ¥${fullRefund.toLocaleString()} を返金してキャンセルします（運営都合など）。よろしいですか？`,
                  "full"
                )
              }
            >
              {busy === "full" ? "処理中..." : `キャンセル（全額返金 ¥${fullRefund.toLocaleString()}）`}
            </button>

            {/* カスタムキャンセル料 */}
            <button
              className="admin-btn danger"
              disabled={busy !== ""}
              onClick={() => setShowCustomCancel(!showCustomCancel)}
            >
              キャンセル（カスタム手数料）
            </button>
            {showCustomCancel && (
              <div className="admin-form-panel">
                <label>
                  キャンセル料（円）:
                  <input
                    type="number"
                    min={0}
                    max={effectiveAmount}
                    value={customFee}
                    onChange={(e) => setCustomFee(e.target.value)}
                    style={{ width: "120px", marginLeft: "8px" }}
                  />
                </label>
                {feeValid && (
                  <p className="policy" style={{ margin: "4px 0" }}>
                    キャンセル料 ¥{parsedFee.toLocaleString()} / 返金額 ¥{customRefund.toLocaleString()}
                  </p>
                )}
                <button
                  className="admin-btn danger"
                  disabled={busy !== "" || !feeValid}
                  style={{ marginTop: "8px" }}
                  onClick={() =>
                    call(
                      "/api/admin/cancel",
                      { bookingId, mode: "custom", customFeeAmount: parsedFee },
                      `キャンセル料 ¥${parsedFee.toLocaleString()} / 返金 ¥${customRefund.toLocaleString()} でキャンセルします。\nよろしいですか？`,
                      "custom"
                    )
                  }
                >
                  {busy === "custom"
                    ? "処理中..."
                    : `返金 ¥${customRefund.toLocaleString()} でキャンセル`}
                </button>
              </div>
            )}
          </>
        )}

        {syncFailed && (
          <button
            className="admin-btn"
            disabled={busy !== ""}
            onClick={() =>
              call(
                "/api/admin/resync",
                { bookingId },
                "Googleカレンダーへの登録と確認メールを再試行します。よろしいですか？",
                "resync"
              )
            }
          >
            {busy === "resync" ? "再試行中..." : "🔄 カレンダー再同期"}
          </button>
        )}
      </div>
      {message && <div className="notice">{message}</div>}
      {error && <div className="notice error">{error}</div>}
    </div>
  );
}
