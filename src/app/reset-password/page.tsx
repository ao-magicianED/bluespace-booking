"use client";

import { useState } from "react";
import Link from "next/link";
import { getBrowserAuth } from "@/lib/auth-browser";

/** パスワードを忘れた方向けの再設定（メール→6桁コード→新パスワード） */
export default function ResetPasswordPage() {
  const [step, setStep] = useState<"email" | "code" | "done">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "送信に失敗しました");
        setBusy(false);
        return;
      }
      setStep("code");
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください");
    }
    setBusy(false);
  }

  async function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      return;
    }
    if (password !== password2) {
      setError("確認用パスワードが一致しません");
      return;
    }
    setBusy(true);
    setError("");
    const supabase = getBrowserAuth();
    const { error: otpError } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "recovery",
    });
    if (otpError) {
      setError("コードが正しくないか、有効期限が切れています。再度お試しください");
      setBusy(false);
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("パスワードの変更に失敗しました: " + updateError.message);
      setBusy(false);
      return;
    }
    setStep("done");
    setBusy(false);
  }

  if (step === "done") {
    return (
      <div className="auth-box">
        <h1>パスワードを変更しました</h1>
        <p>新しいパスワードでのログインが完了しています。</p>
        <p>
          <Link href="/my">マイページへ</Link>
        </p>
      </div>
    );
  }

  if (step === "code") {
    return (
      <div className="auth-box">
        <h1>新しいパスワードの設定</h1>
        <p className="policy">
          {email} 宛てに再設定コードを送りました（登録済みのアドレスの場合のみ届きます）。
        </p>
        <form onSubmit={resetPassword}>
          <div className="form-field">
            <label>再設定コード</label>
            <input
              type="text"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              required
            />
          </div>
          <div className="form-field">
            <label>新しいパスワード（8文字以上）</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
            />
          </div>
          <div className="form-field">
            <label>新しいパスワード（確認）</label>
            <input
              type="password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
              minLength={8}
            />
          </div>
          {error && <div className="notice error">{error}</div>}
          <button className="submit-btn" disabled={busy}>
            {busy ? "変更中..." : "パスワードを変更する"}
          </button>
        </form>
        <p>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setStep("email");
              setError("");
            }}
          >
            ← メールアドレスを入力し直す
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="auth-box">
      <h1>パスワードをお忘れの方</h1>
      <p className="policy">
        会員登録時のメールアドレスを入力してください。パスワード再設定用のコードをお送りします。
      </p>
      <form onSubmit={sendCode}>
        <div className="form-field">
          <label>メールアドレス</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="submit-btn" disabled={busy}>
          {busy ? "送信中..." : "再設定コードを送る"}
        </button>
      </form>
      <p>
        <Link href="/login">← ログインへ戻る</Link>
      </p>
    </div>
  );
}
