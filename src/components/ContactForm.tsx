"use client";

import { useState } from "react";
import Link from "next/link";

const FREQUENCY_OPTIONS = [
  "週2回以上",
  "週1回",
  "月2〜3回",
  "月1回",
  "単発・スポット利用",
  "まだ決まっていない",
];

/** お問い合わせフォーム（一般＋長期・定期利用の相談） */
export default function ContactForm({
  venues,
  presetType,
  presetVenue,
}: {
  venues: { slug: string; name: string }[];
  presetType: "general" | "longterm";
  presetVenue: string;
}) {
  const [type, setType] = useState<"general" | "longterm">(presetType);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedVenues, setSelectedVenues] = useState<string[]>(
    venues.some((v) => v.slug === presetVenue) ? [presetVenue] : []
  );
  const [undecided, setUndecided] = useState(false);
  const [frequency, setFrequency] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot（人間は入力しない隠しフィールド）
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function toggleVenue(slug: string) {
    setSelectedVenues((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
    setUndecided(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (type === "longterm" && !frequency) {
      setError("ご利用の頻度を選択してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          name,
          email,
          phone,
          venues: selectedVenues,
          undecided,
          frequency,
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
      <div className="auth-box">
        <h1>お問い合わせを受け付けました</h1>
        <p>
          {email} 宛てに受付確認メールをお送りしました。担当者より通常1〜2営業日以内にご返信します。
        </p>
        <p>
          <Link href="/">← トップへ戻る</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="contact-box">
      <h1>お問い合わせ</h1>
      <p className="policy">
        ご質問、長期利用・定期利用のお見積もり依頼はこちらからどうぞ。
        空き状況の確認とご予約は各スペースのページから直接行えます。
      </p>
      <form onSubmit={submit}>
        <div className="customer-type-row">
          <label className="option-item">
            <input
              type="radio"
              name="contactType"
              checked={type === "general"}
              onChange={() => setType("general")}
            />
            一般のお問い合わせ
          </label>
          <label className="option-item">
            <input
              type="radio"
              name="contactType"
              checked={type === "longterm"}
              onChange={() => setType("longterm")}
            />
            長期・定期利用の相談（お見積もり）
          </label>
        </div>
        {type === "longterm" && (
          <div className="notice success">
            毎週・毎月などの定期利用は<strong>常時10%OFF</strong>でご提供しています。
            ご希望の頻度と内容をお知らせください。お見積もりをお送りします。
          </div>
        )}

        <div className="form-field">
          <label>
            お名前 <span className="req">*</span>
          </label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="form-field">
          <label>
            メールアドレス <span className="req">*</span>
          </label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div className="form-field">
          <label>電話番号（任意）</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>

        <div className="form-field">
          <label>ご希望のスペース（複数選択可）</label>
          <div className="venue-check-list">
            {venues.map((v) => (
              <label key={v.slug} className="option-item">
                <input
                  type="checkbox"
                  checked={selectedVenues.includes(v.slug)}
                  onChange={() => toggleVenue(v.slug)}
                />
                {v.name}
              </label>
            ))}
            <label className="option-item">
              <input
                type="checkbox"
                checked={undecided}
                onChange={() => {
                  setUndecided(!undecided);
                  if (!undecided) setSelectedVenues([]);
                }}
              />
              まだ決まっていない（相談したい）
            </label>
          </div>
        </div>

        {type === "longterm" && (
          <div className="form-field">
            <label>
              ご利用の頻度 <span className="req">*</span>
            </label>
            <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
              <option value="">選択してください</option>
              {FREQUENCY_OPTIONS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="form-field">
          <label>
            お問い合わせ内容 <span className="req">*</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={5}
            placeholder={
              type === "longterm"
                ? "例: 月に3回、平日の夜にミーティングで利用したいので、お見積もりをお願いします。"
                : "ご質問・ご相談の内容をご記入ください"
            }
            required
          />
        </div>

        {/* honeypot: ボットだけが埋める隠しフィールド */}
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
        <button className="submit-btn" disabled={busy}>
          {busy ? "送信中..." : "送信する"}
        </button>
      </form>
    </div>
  );
}
