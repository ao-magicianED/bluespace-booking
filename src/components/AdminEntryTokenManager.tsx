"use client";

import { useState } from "react";

/**
 * 管理画面: 現地QR入口トークンの発行・失効・URLコピー。
 * active=false にすると、そのQRを読んだ既存Cookie保持者も次の見積からstandard価格になる
 * （キルスイッチ。ティア判定は毎回DBでactiveを照合しているため）。
 * QR画像の生成はここでは行わない（ポスター制作はa4-print側で実施）。
 */

export type EntryTokenRow = {
  token: string;
  active: boolean;
  label: string | null;
  created_at: string;
};

export default function AdminEntryTokenManager({
  venueId,
  initialTokens,
}: {
  venueId: string;
  initialTokens: EntryTokenRow[];
}) {
  const [tokens, setTokens] = useState<EntryTokenRow[]>(initialTokens);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  async function create() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/venue-entry-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create", venueId, label }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage({ kind: "error", text: json.error ?? "発行に失敗しました" });
      setBusy(false);
      return;
    }
    setTokens((prev) => [
      { token: json.token, active: true, label: label || null, created_at: new Date().toISOString() },
      ...prev,
    ]);
    setLabel("");
    setMessage({ kind: "info", text: "発行しました。URLをコピーしてQRポスターに使用してください" });
    setBusy(false);
  }

  async function setActive(token: string, active: boolean) {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/admin/venue-entry-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set_active", token, active }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage({ kind: "error", text: json.error ?? "更新に失敗しました" });
      setBusy(false);
      return;
    }
    setTokens((prev) => prev.map((t) => (t.token === token ? { ...t, active } : t)));
    setMessage({
      kind: "info",
      text: active
        ? "有効化しました"
        : "失効しました（発行済みCookieの利用者も次の見積からstandard価格になります）",
    });
    setBusy(false);
  }

  async function copyUrl(token: string) {
    try {
      await navigator.clipboard.writeText(`${origin}/r/${token}`);
      setMessage({ kind: "info", text: "URLをコピーしました" });
    } catch {
      setMessage({ kind: "error", text: "コピーに失敗しました（URLを手動で選択してください）" });
    }
  }

  return (
    <div className="admin-form-panel" style={{ marginTop: "1.5rem" }}>
      <h2>現地QR入口トークン（リピーター価格）</h2>
      <p className="policy">
        URL（/r/…）をQRポスターにして現地掲示します。「失効」で該当QRを即時停止できます
        （読み取り済みの利用者も次の見積からstandard価格）。
      </p>

      <div className="cancel-actions" style={{ marginBottom: "0.8rem" }}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="管理メモ（例: 室内POP 2026-09）"
          maxLength={100}
          disabled={busy}
          style={{ minWidth: "16em" }}
        />
        <button className="submit-btn" onClick={create} disabled={busy}>
          新規発行
        </button>
      </div>

      {message && (
        <div className={`notice ${message.kind === "error" ? "error" : ""}`}>{message.text}</div>
      )}

      {tokens.length === 0 ? (
        <p className="policy">発行済みのトークンはありません。</p>
      ) : (
        <table className="legal-table" style={{ fontSize: "0.9rem" }}>
          <thead>
            <tr>
              <th>状態</th>
              <th>URL</th>
              <th>メモ</th>
              <th>発行日</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tokens.map((t) => (
              <tr key={t.token}>
                <td>
                  <span className={`status-badge ${t.active ? "st-confirmed" : "st-cancelled"}`}>
                    {t.active ? "有効" : "失効"}
                  </span>
                </td>
                <td style={{ wordBreak: "break-all" }}>
                  <code>/r/{t.token}</code>
                </td>
                <td>{t.label ?? "—"}</td>
                <td>
                  {new Date(t.created_at).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </td>
                <td>
                  <button className="link-button" onClick={() => copyUrl(t.token)} disabled={busy}>
                    URLコピー
                  </button>
                  <button
                    className="link-button"
                    onClick={() => setActive(t.token, !t.active)}
                    disabled={busy}
                  >
                    {t.active ? "失効" : "再有効化"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
