"use client";

import { useState } from "react";

type Faq = { q: string; a: string };

/** 管理画面: 拠点FAQエディタ。保存するとサイトのFAQ表示を上書きする */
export default function FaqEditor({
  venueId,
  initial,
  isCustom,
}: {
  venueId: string;
  /** 現在表示されているFAQ（DB上書き or デフォルト） */
  initial: Faq[];
  /** DBに上書きFAQが保存されているか */
  isCustom: boolean;
}) {
  const [faqs, setFaqs] = useState<Faq[]>(initial.length ? initial : [{ q: "", a: "" }]);
  const [custom, setCustom] = useState(isCustom);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function update(i: number, key: keyof Faq, value: string) {
    setFaqs((prev) => prev.map((f, idx) => (idx === i ? { ...f, [key]: value } : f)));
  }

  async function send(payload: Faq[] | null) {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/venue-faqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ venueId, faqs: payload }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: json.error ?? "保存に失敗しました" });
      } else if (payload === null) {
        setCustom(false);
        setMessage({ ok: true, text: "デフォルトFAQに戻しました（ページを再読み込みすると初期内容が表示されます）" });
      } else {
        setCustom(true);
        setMessage({ ok: true, text: "保存しました。拠点ページのFAQに反映されます。" });
      }
    } catch {
      setMessage({ ok: false, text: "通信エラーが発生しました" });
    }
    setBusy(false);
  }

  return (
    <div className="access-editor">
      <h2>よくある質問（FAQ）</h2>
      <p className="policy">
        {custom
          ? "この拠点はカスタムFAQを表示中です。"
          : "現在は全拠点共通のデフォルトFAQを表示中です。保存するとこの拠点だけ内容を上書きできます。"}
      </p>
      {faqs.map((f, i) => (
        <div key={i} className="faq-edit-row">
          <div className="form-field">
            <label>質問 {i + 1}</label>
            <input
              type="text"
              value={f.q}
              onChange={(e) => update(i, "q", e.target.value)}
              placeholder="例: 駐車場はありますか？"
            />
          </div>
          <div className="form-field">
            <label>回答 {i + 1}</label>
            <textarea
              value={f.a}
              onChange={(e) => update(i, "a", e.target.value)}
              rows={2}
              placeholder="回答を入力"
            />
          </div>
          <button
            type="button"
            className="faq-remove-btn"
            onClick={() => setFaqs((prev) => prev.filter((_, idx) => idx !== i))}
            disabled={faqs.length <= 1}
          >
            ✕ この質問を削除
          </button>
        </div>
      ))}
      <p>
        <button
          type="button"
          className="faq-add-btn"
          onClick={() => setFaqs((prev) => [...prev, { q: "", a: "" }])}
          disabled={faqs.length >= 30}
        >
          ＋ 質問を追加
        </button>
      </p>
      <div className="access-editor-foot">
        <button
          type="button"
          className="faq-reset-btn"
          onClick={() => {
            if (confirm("カスタムFAQを削除して、全拠点共通のデフォルトFAQ表示に戻しますか？")) {
              send(null);
            }
          }}
          disabled={busy || !custom}
        >
          デフォルトに戻す
        </button>
        <button className="submit-btn" onClick={() => send(faqs)} disabled={busy}>
          {busy ? "保存中..." : "FAQを保存する"}
        </button>
      </div>
      {message && <div className={`notice ${message.ok ? "success" : "error"}`}>{message.text}</div>}
    </div>
  );
}
