"use client";

import { useState } from "react";

type Props = {
  /** 対象施設名（例: "ブルーストレージ白金高輪"） */
  storageProduct: string;
  /** 選べるプラン名（先頭が初期値） */
  plans: string[];
};

/**
 * 法人向けミニ倉庫の問い合わせフォーム（最小項目・CVR最適化）。
 * - 入力は5項目以内（名前・会社/屋号・メール・電話・メッセージ）に絞る
 * - プランと利用開始希望をプリセットしておくことで返信→契約までの摩擦を減らす
 * - 既存 /api/contact エンドポイントを type:"storage" で流用
 */
export default function StorageInquiryForm({ storageProduct, plans }: Props) {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [plan, setPlan] = useState(plans[0] ?? "");
  const [start, setStart] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "storage",
          name,
          email,
          phone,
          company,
          storageProduct,
          storagePlan: plan,
          storageStart: start,
          message:
            message || `${storageProduct} の見学・契約について検討しています。`,
          website,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "送信に失敗しました");
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください");
    }
    setBusy(false);
  }

  if (done) {
    return (
      <div className="storage-form-done">
        <h3>お問い合わせを受け付けました</h3>
        <p>
          {email} 宛てに受付確認メールをお送りしました。
          <br />
          担当者より<strong>通常1〜2営業日以内</strong>にご返信いたします。
        </p>
        <p className="policy">先着順となりますので、複数件のご相談がある場合は順次ご案内いたします。</p>
      </div>
    );
  }

  return (
    <form className="storage-form" onSubmit={submit}>
      <div className="form-field">
        <label>
          お名前 <span className="req">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoComplete="name"
        />
      </div>
      <div className="form-field">
        <label>会社名・屋号（任意）</label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization"
          placeholder="例: 株式会社○○ / ○○サロン"
        />
      </div>
      <div className="form-grid-2">
        <div className="form-field">
          <label>
            メールアドレス <span className="req">*</span>
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div className="form-field">
          <label>電話番号（任意）</label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </div>
      </div>
      <div className="form-grid-2">
        <div className="form-field">
          <label>ご希望のプラン</label>
          <select value={plan} onChange={(e) => setPlan(e.target.value)}>
            {plans.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label>利用開始希望</label>
          <input
            type="text"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="例: できるだけ早く / ○月○日頃"
          />
        </div>
      </div>
      <div className="form-field">
        <label>ご質問・ご相談（任意）</label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          placeholder="例: 棚を持ち込みたいです / 自社商材の置き場として使えますか？"
        />
      </div>

      <div style={{ display: "none" }} aria-hidden="true">
        <label>
          Website
          <input
            type="text"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </label>
      </div>

      {error && <div className="notice error">{error}</div>}
      <button className="storage-cta-btn" disabled={busy}>
        {busy ? "送信中..." : "見学・お問い合わせを送る"}
      </button>
      <p className="policy" style={{ marginTop: "0.6rem" }}>
        通常1〜2営業日以内にメールでご返信。電話のしつこい営業は一切いたしません。
      </p>
    </form>
  );
}
