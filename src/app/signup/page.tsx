"use client";

import { useState } from "react";
import Link from "next/link";

// 主な利用用途（マーケティング分析用。user_metadataに保存）
const USE_OPTIONS = [
  "会議・打ち合わせ",
  "セミナー・教室",
  "施術・サロン",
  "撮影・配信",
  "テレワーク・作業",
  "趣味・パーティー",
  "その他",
];

// 当サイトを知ったきっかけ（流入チャネル分析用）
const SOURCE_OPTIONS = [
  "Googleマップ",
  "Google検索",
  "他の予約サイト（インスタベース等）",
  "公式サイト・直接アクセス",
  "AIのおすすめ（ChatGPT等）",
  "SNS",
  "知人の紹介",
  "その他",
];

export default function SignupPage() {
  const [form, setForm] = useState({ name: "", phone: "", email: "", password: "" });
  const [customerType, setCustomerType] = useState<"individual" | "corporate">("individual");
  const [companyName, setCompanyName] = useState("");
  const [primaryUse, setPrimaryUse] = useState("");
  const [discoverySource, setDiscoverySource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"confirmed" | "needs_email" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (form.password.length < 8) {
      setError("パスワードは8文字以上にしてください");
      return;
    }
    if (customerType === "corporate" && !companyName.trim()) {
      setError("会社名を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // 自社APIで登録（確認メールは自社ドメインから日本語で届く）
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          phone: form.phone,
          email: form.email,
          password: form.password,
          customerType,
          companyName,
          primaryUse,
          discoverySource,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "登録に失敗しました");
        setBusy(false);
        return;
      }
      setDone("needs_email");
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください");
    }
    setBusy(false);
  }

  if (done === "confirmed") {
    return (
      <div className="auth-box">
        <h1>登録が完了しました</h1>
        <p>マイページへ移動します...</p>
      </div>
    );
  }
  if (done === "needs_email") {
    return (
      <div className="auth-box">
        <h1>確認メールを送信しました</h1>
        <p>
          {form.email} 宛てに確認メールを送りました。メール内のリンクを開くと登録が完了し、
          ログインできるようになります。
        </p>
      </div>
    );
  }

  return (
    <div className="auth-box">
      <h1>新規会員登録</h1>
      <p className="policy">登録すると、予約時の情報自動入力・予約履歴の確認・領収書の発行ができます。</p>
      <form onSubmit={submit}>
        <div className="customer-type-row">
          <label className="option-item">
            <input
              type="radio"
              name="signupCustomerType"
              checked={customerType === "individual"}
              onChange={() => setCustomerType("individual")}
            />
            個人
          </label>
          <label className="option-item">
            <input
              type="radio"
              name="signupCustomerType"
              checked={customerType === "corporate"}
              onChange={() => setCustomerType("corporate")}
            />
            法人
          </label>
        </div>
        {customerType === "corporate" && (
          <div className="form-field">
            <label>会社名</label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="株式会社〇〇"
              required
            />
            <p className="policy">
              ※法人登録すると、予約時に会社名が自動入力され、請求書払い（銀行振込）も選びやすくなります
            </p>
          </div>
        )}
        <div className="form-field">
          <label>お名前{customerType === "corporate" ? "（ご担当者）" : ""}</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="山田 太郎"
            required
          />
        </div>
        <div className="form-field">
          <label>電話番号</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            placeholder="09012345678"
            required
          />
        </div>
        <div className="form-field">
          <label>主な利用用途</label>
          <select value={primaryUse} onChange={(e) => setPrimaryUse(e.target.value)} required>
            <option value="">選択してください</option>
            {USE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>当サイトを知ったきっかけ</label>
          <select
            value={discoverySource}
            onChange={(e) => setDiscoverySource(e.target.value)}
            required
          >
            <option value="">選択してください</option>
            {SOURCE_OPTIONS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>メールアドレス</label>
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
        </div>
        <div className="form-field">
          <label>パスワード（8文字以上）</label>
          <input
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
            minLength={8}
          />
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="submit-btn" disabled={busy}>
          {busy ? "登録中..." : "登録する"}
        </button>
      </form>
      <p>
        すでにアカウントをお持ちの方は <Link href="/login">ログイン</Link>
      </p>
    </div>
  );
}
