"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      const j = await res.json();
      setError(j.error ?? "ログインに失敗しました");
      setBusy(false);
      return;
    }
    window.location.href = "/admin";
  }

  return (
    <div className="auth-box">
      <h1>管理者ログイン</h1>
      <form onSubmit={submit}>
        <div className="form-field">
          <label>管理者パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoFocus
          />
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="submit-btn" disabled={busy}>
          {busy ? "確認中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
