"use client";

import { useState } from "react";

type Props = {
  bookingId: string;
  currentStartIso: string;
  currentEndIso: string;
  minHours: number;
  maxHours: number;
};

function isoToJstInput(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}
function jstInputToIso(input: string): string {
  if (!input) return "";
  return new Date(input + ":00+09:00").toISOString();
}

export default function AdminChangeTimeForm({
  bookingId,
  currentStartIso,
  currentEndIso,
  minHours,
  maxHours,
}: Props) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(isoToJstInput(currentStartIso));
  const [end, setEnd] = useState(isoToJstInput(currentEndIso));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string; url?: string } | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/change-time", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId,
        startAt: jstInputToIso(start),
        endAt: jstInputToIso(end),
        reason,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage({ kind: "error", text: json.error ?? "変更に失敗しました" });
      setBusy(false);
      return;
    }
    if (json.type === "pending_payment") {
      setMessage({
        kind: "info",
        text: "差額の追加請求が必要なため、お客様にお支払いリンクを送信しました。決済完了後に時間が反映されます。",
        url: json.checkoutUrl,
      });
      setBusy(false);
      return;
    }
    setMessage({ kind: "info", text: "予約時間を変更しました" });
    setTimeout(() => window.location.reload(), 1200);
  }

  if (!open) {
    return (
      <p style={{ marginTop: "1rem" }}>
        <button className="link-button" onClick={() => setOpen(true)}>
          🕐 予約時間を変更する（管理者）
        </button>
      </p>
    );
  }
  return (
    <div className="admin-form-panel" style={{ marginTop: "1rem" }}>
      <h3 style={{ marginTop: 0 }}>予約時間の変更（管理者）</h3>
      <p className="policy">
        管理者は時間を即時変更できます。料金差額があれば自動処理: 増額→お客様にお支払いリンク、減額→自動返金。
        最低{minHours}h〜最大{maxHours}h、30分単位。
      </p>
      <label>
        新しい開始日時
        <input
          type="datetime-local"
          step={1800}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        新しい終了日時
        <input
          type="datetime-local"
          step={1800}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        変更理由（必須）
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder="例: お客様からの要望（電話）"
        />
      </label>

      {message && (
        <div className={`notice ${message.kind === "error" ? "error" : ""}`}>
          {message.text}
          {message.url && (
            <>
              <br />
              <a href={message.url} target="_blank" rel="noopener noreferrer">
                Checkoutを開く →
              </a>
            </>
          )}
        </div>
      )}

      <div className="cancel-actions" style={{ marginTop: "0.75rem" }}>
        <button className="submit-btn" onClick={submit} disabled={busy || !start || !end || !reason.trim()}>
          {busy ? "処理中..." : "変更を実行する"}
        </button>
        <button className="cancel-back" onClick={() => setOpen(false)} disabled={busy}>
          閉じる
        </button>
      </div>
    </div>
  );
}
