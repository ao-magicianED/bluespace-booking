"use client";

import { useState } from "react";

const CATEGORIES = [
  { value: "a", label: "(a) スペース・物件はあるが活用できていない" },
  { value: "b", label: "(b) 運営中だが予約が入らない・稼働率が伸びない" },
  { value: "c", label: "(c) これから一人で立ち上げるのが不安" },
  { value: "other", label: "当てはまらない・まだわからない" },
];

const MENUS = [
  "ライト相談（単発・60〜90分）",
  "集客改善伴走（月次）",
  "立ち上げフルサポート",
  "どれが合うか含めて相談したい",
];

/**
 * コンサル問い合わせフォーム（/consulting 専用）。
 * 既存 /api/contact エンドポイントを type:"consulting" で流用。
 * 価格はヒアリング後の個別見積りのため、フォーム上には一切表示しない。
 */
export default function ConsultingInquiryForm() {
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState(CATEGORIES[0].value);
  const [menu, setMenu] = useState(MENUS[0]);
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
      const categoryLabel = CATEGORIES.find((c) => c.value === category)?.label ?? category;
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "consulting",
          name,
          email,
          phone,
          company,
          consultingCategory: categoryLabel,
          consultingMenu: menu,
          message,
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
        <h3>ご相談を受け付けました</h3>
        <p>
          {email} 宛てに受付確認メールをお送りしました。
          <br />
          担当者より<strong>通常1〜2営業日以内</strong>にご返信いたします。
        </p>
        <p className="policy">
          料金・支援範囲は個別のヒアリング後にご案内します。しつこい営業や無料相談後の即断のお願いはいたしません。
        </p>
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
        <label>運営中/検討中のスペース名・屋号（任意）</label>
        <input
          type="text"
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization"
          placeholder="例: ○○レンタルスペース / まだ未定"
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
      <div className="form-field">
        <label>今の状況に近いものを選んでください</label>
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>
      <div className="form-field">
        <label>ご興味のあるメニュー</label>
        <select value={menu} onChange={(e) => setMenu(e.target.value)}>
          {MENUS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="policy" style={{ marginTop: "0.4rem" }}>
          料金は状況により異なるため、ヒアリング後に個別でご案内します。
        </p>
      </div>
      <div className="form-field">
        <label>
          現在の状況・ご相談内容 <span className="req">*</span>
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="例: 空きテナントがあるが何から手をつければよいか分からない / 掲載はしているが予約が増えない / 半年以内に1拠点目を立ち上げたい　など"
          required
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
        {busy ? "送信中..." : "この内容でご相談する"}
      </button>
      <p className="policy" style={{ marginTop: "0.6rem" }}>
        通常1〜2営業日以内にメールでご返信。しつこい営業のお電話は一切いたしません。
      </p>
    </form>
  );
}
