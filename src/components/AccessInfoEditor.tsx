"use client";

import { useState } from "react";

/** 管理画面: 拠点の入退室案内エディタ（1拠点分） */
export default function AccessInfoEditor({
  venueId,
  venueName,
  initial,
}: {
  venueId: string;
  venueName: string;
  initial: string;
}) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/venue-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, accessInfo: text }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: json.error ?? "保存に失敗しました" });
      } else {
        setMessage({ ok: true, text: "保存しました。以降の確定メール・マイページに反映されます。" });
      }
    } catch {
      setMessage({ ok: false, text: "通信エラーが発生しました" });
    }
    setBusy(false);
  }

  return (
    <div className="access-editor">
      <h2>{venueName}</h2>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={16}
        placeholder="入退室のご案内（鍵の開け方・Wi-Fi・退室時のお願いなど）。空にすると案内は表示されません。"
      />
      <div className="access-editor-foot">
        <span className="policy">{text.length.toLocaleString()}文字</span>
        <button className="submit-btn" onClick={save} disabled={busy}>
          {busy ? "保存中..." : "保存する"}
        </button>
      </div>
      {message && (
        <div className={`notice ${message.ok ? "success" : "error"}`}>{message.text}</div>
      )}
    </div>
  );
}
