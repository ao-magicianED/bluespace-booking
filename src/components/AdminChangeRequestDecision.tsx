"use client";

import { useState } from "react";
import type { BookingChangeRequest } from "@/lib/types";

type Props = {
  changeRequest: BookingChangeRequest;
  currentPeriod: string;
  requestedPeriod: string;
};

/** お客様の変更申請（pending）に対する承認/却下UI */
export default function AdminChangeRequestDecision({
  changeRequest,
  currentPeriod,
  requestedPeriod,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [adminNote, setAdminNote] = useState("");
  const [error, setError] = useState("");

  async function decide(action: "approve" | "reject") {
    if (action === "reject" && !adminNote.trim()) {
      setError("却下の理由を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/decide-change-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        changeRequestId: changeRequest.id,
        action,
        adminNote,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "処理に失敗しました");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  return (
    <div className="admin-form-panel" style={{ marginTop: "1rem", borderColor: "#b45309", background: "#fef3c7" }}>
      <h3 style={{ marginTop: 0 }}>🔔 お客様からの変更申請（要承認）</h3>
      <p>
        <strong>現在:</strong> {currentPeriod}
        <br />
        <strong>ご希望:</strong> {requestedPeriod}
        <br />
        <strong>料金:</strong> ¥{changeRequest.previous_amount.toLocaleString()} → ¥
        {changeRequest.new_amount.toLocaleString()}
        {changeRequest.refund_amount > 0 && (
          <>
            <br />
            <strong>差額返金:</strong> ¥{changeRequest.refund_amount.toLocaleString()}（承認時に処理）
          </>
        )}
        {changeRequest.reason && (
          <>
            <br />
            <strong>申請理由:</strong> {changeRequest.reason}
          </>
        )}
        <br />
        <span className="policy">
          申請日時: {new Date(changeRequest.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
          （この時刻基準でキャンセル料を判定）
        </span>
      </p>
      <label>
        管理者メモ（却下時は必須・お客様に通知されます）
        <textarea
          rows={2}
          value={adminNote}
          onChange={(e) => setAdminNote(e.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder="例: 承認しました / 他のご予約があるため希望時間には変更できません"
        />
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="cancel-actions" style={{ marginTop: "0.75rem" }}>
        <button className="submit-btn" onClick={() => decide("approve")} disabled={busy}>
          {busy ? "処理中..." : "承認して反映する"}
        </button>
        <button className="cancel-back" onClick={() => decide("reject")} disabled={busy}>
          却下する
        </button>
      </div>
    </div>
  );
}
