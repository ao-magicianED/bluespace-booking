"use client";

import { useState } from "react";

export default function AdminCouponGrantForm() {
  const [email, setEmail] = useState("");
  const [kind, setKind] = useState("review_reward");
  const [percentOff, setPercentOff] = useState(10);
  const [validDays, setValidDays] = useState(30);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/coupons/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, kind, percentOff, validDays, note }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ kind: "error", text: json.error ?? "発行に失敗しました" });
        return;
      }
      setMessage({
        kind: "info",
        text: `発行しました（クーポンコード: ${json.code}）${json.mailSent ? "。メールも送信しました。" : "。メール送信には失敗したので、コードを直接お客様にお伝えください。"}`,
      });
      setEmail("");
      setNote("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-form-panel">
      <h3 style={{ marginTop: 0 }}>クーポン手動発行（アンケート回答・クチコミ確認後など）</h3>
      <p className="policy">
        Googleクチコミへの投稿自体を条件にクーポンを配ることはポリシー違反のリスクがあるため、
        「アンケートに回答してくれた」「丁寧な感想をいただいた」等を確認したうえで、このフォームから個別発行してください。
      </p>
      <label>
        メールアドレス
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={busy}
          placeholder="customer@example.com"
        />
      </label>
      <label>
        発行区分（同じ区分は同一メールに1回まで）
        <select value={kind} onChange={(e) => setKind(e.target.value)} disabled={busy}>
          <option value="review_reward">クチコミ・アンケート特典（review_reward）</option>
          <option value="survey_reward">アンケート回答特典（survey_reward）</option>
          <option value="goodwill">お詫び・お礼（goodwill）</option>
        </select>
      </label>
      <label>
        割引率(%)
        <input
          type="number"
          min={1}
          max={100}
          value={percentOff}
          onChange={(e) => setPercentOff(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <label>
        有効日数
        <input
          type="number"
          min={1}
          max={365}
          value={validDays}
          onChange={(e) => setValidDays(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <label>
        メモ（任意）
        <input type="text" value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} maxLength={300} />
      </label>

      {message && <div className={`notice ${message.kind === "error" ? "error" : ""}`}>{message.text}</div>}

      <div className="cancel-actions" style={{ marginTop: "0.75rem" }}>
        <button className="submit-btn" onClick={submit} disabled={busy || !email.trim()}>
          {busy ? "発行中..." : "クーポンを発行してメール送信"}
        </button>
      </div>
    </div>
  );
}
