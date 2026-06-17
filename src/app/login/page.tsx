"use client";

import { useState } from "react";
import Link from "next/link";
import { getBrowserAuth } from "@/lib/auth-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // 確認メールのリンクから戻ってきた場合（?verified=1）にメッセージを出す
  const [verified] = useState(
    () => typeof window !== "undefined" && window.location.search.includes("verified=1")
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = getBrowserAuth();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(
        error.message.includes("Invalid login credentials")
          ? "メールアドレスまたはパスワードが正しくありません"
          : error.message.includes("Email not confirmed")
            ? "メールアドレスの確認が完了していません。確認メールのリンクを開いてください"
            : "ログインに失敗しました: " + error.message
      );
      setBusy(false);
      return;
    }
    window.location.href = "/my";
  }

  return (
    <div className="auth-box">
      <h1>ログイン</h1>
      {verified && (
        <div className="notice success">
          メールアドレスの確認が完了しました。登録したメールアドレスとパスワードでログインしてください。
        </div>
      )}
      <form onSubmit={submit}>
        <div className="form-field">
          <label>メールアドレス</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-field">
          <label>パスワード</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="submit-btn" disabled={busy}>
          {busy ? "ログイン中..." : "ログイン"}
        </button>
      </form>
      <p>
        <Link href="/reset-password">パスワードをお忘れの方はこちら</Link>
      </p>
      <p>
        アカウントをお持ちでない方は <Link href="/signup">新規登録</Link>
      </p>
      <p className="policy">※会員登録をしなくても予約はできます。登録すると予約履歴の確認と領収書の発行ができます。</p>
    </div>
  );
}
