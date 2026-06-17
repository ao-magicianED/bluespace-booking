"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * 領収書（宛名入力 → 発行 → 印刷/PDF保存）。
 * ブラウザの印刷機能で「PDFに保存」すればファイルとして渡せる。
 */
export default function ReceiptClient({
  bookingId,
  shortId,
  amount,
  period,
  venueName,
  defaultName,
  reissue,
  nameChangeUsed,
  paymentMethod,
  registrationNumber,
}: {
  bookingId: string;
  shortId: string;
  amount: number;
  period: string;
  venueName: string;
  defaultName: string;
  reissue: boolean;
  /** 宛名の変更（1回まで）をすでに使ったか */
  nameChangeUsed: boolean;
  paymentMethod: "card" | "invoice";
  registrationNumber: string;
}) {
  const [name, setName] = useState(defaultName);
  const [note, setNote] = useState("レンタルスペース利用料として");
  const [issued, setIssued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const tax = Math.floor((amount * 10) / 110); // 内消費税10%
  const today = new Date().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Tokyo",
  });

  async function issue() {
    if (!name.trim()) {
      setError("宛名を入力してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/receipt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, name: name.trim() }),
      });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error ?? "発行に失敗しました");
        setBusy(false);
        return;
      }
      setIssued(true);
    } catch {
      setError("通信エラーが発生しました");
    }
    setBusy(false);
  }

  if (!issued) {
    return (
      <div className="auth-box">
        <h1>領収書の発行</h1>
        <p>
          対象: {venueName} {period}（¥{amount.toLocaleString()}）
        </p>
        {reissue && <div className="notice">この予約の領収書は発行済みです（再発行になります）。</div>}
        <div className="form-field">
          <label>宛名（会社名・お名前）</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={reissue && nameChangeUsed}
          />
          {reissue && nameChangeUsed ? (
            <p className="red-note">※宛名の変更は1回までのため、これ以上変更できません。</p>
          ) : reissue ? (
            <p className="red-note">※宛名の変更は1回のみ可能です。お間違いのないようご確認ください。</p>
          ) : (
            <p className="red-note">
              ※発行後の宛名変更は1回のみ可能です。お間違いのないようご確認ください。
            </p>
          )}
        </div>
        <div className="form-field">
          <label>但し書き</label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <div className="notice error">{error}</div>}
        <button className="submit-btn" onClick={issue} disabled={busy}>
          {busy ? "発行中..." : "領収書を表示する"}
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="receipt-actions no-print">
        <button className="submit-btn" onClick={() => window.print()}>
          🖨 印刷 / PDFに保存
        </button>
        <p className="policy">
          印刷画面で送信先を「PDFに保存」にするとPDFファイルになります。
          <Link href={`/my/${bookingId}`}>予約詳細へ戻る</Link>
        </p>
      </div>

      <div className="receipt-paper">
        <h1>領収書</h1>
        <div className="receipt-meta">
          <span>No. {shortId}{reissue ? "（再発行）" : ""}</span>
          <span>発行日: {today}</span>
        </div>
        <p className="receipt-to">{name} 様</p>
        <p className="receipt-amount">¥{amount.toLocaleString()}-（税込）</p>
        <p className="receipt-note">但し {note}</p>
        <p className="receipt-note">上記正に領収いたしました。</p>
        <table className="receipt-detail">
          <tbody>
            <tr>
              <td>内訳</td>
              <td>
                {venueName} {period}
              </td>
            </tr>
            <tr>
              <td>内消費税（10%）</td>
              <td>¥{tax.toLocaleString()}</td>
            </tr>
            <tr>
              <td>支払方法</td>
              <td>{paymentMethod === "invoice" ? "銀行振込" : "クレジットカード"}</td>
            </tr>
          </tbody>
        </table>
        <div className="receipt-issuer">
          <strong>ブルーステージ合同会社</strong>
          <br />
          bluespace@bluestage-lcc.com
          {registrationNumber && (
            <>
              <br />
              登録番号: {registrationNumber}
            </>
          )}
        </div>
      </div>
    </>
  );
}
