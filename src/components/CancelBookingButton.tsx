"use client";

import { useState } from "react";

export default function CancelBookingButton({
  bookingId,
  refundPreview,
  feePercent,
  tierLabel,
}: {
  bookingId: string;
  refundPreview: number;
  feePercent: number;
  tierLabel: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookingId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "キャンセルに失敗しました");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  if (!confirming) {
    return (
      <button className="cancel-btn" onClick={() => setConfirming(true)}>
        この予約をキャンセルする
      </button>
    );
  }
  return (
    <div className="cancel-confirm">
      <p>
        <strong>キャンセル内容のご確認</strong>
      </p>
      <p>
        {tierLabel} のキャンセル料: <strong>{feePercent}%</strong>
        <br />
        ご返金額: <strong>¥{refundPreview.toLocaleString()}</strong>
        （クレジットカードへ自動返金）
      </p>
      <p>本当にキャンセルしてよろしいですか？この操作は取り消せません。</p>
      {error && <div className="notice error">{error}</div>}
      <div className="cancel-actions">
        <button className="submit-btn" onClick={submit} disabled={busy}>
          {busy ? "処理中..." : "キャンセルを確定する"}
        </button>
        <button className="cancel-back" onClick={() => setConfirming(false)} disabled={busy}>
          戻る
        </button>
      </div>
    </div>
  );
}
