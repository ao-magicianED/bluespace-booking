"use client";

import { useState } from "react";

type Props = {
  bookingId: string;
  currentStartIso: string;
  currentEndIso: string;
  pricePerHour: number;
  minHours: number;
  maxHours: number;
  openHour: number;
  closeHour: number;
};

/** ISO文字列 → datetime-local用 'YYYY-MM-DDTHH:MM'（JST表記） */
function isoToJstInput(iso: string): string {
  const d = new Date(iso);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jst.getUTCDate()).padStart(2, "0");
  const hh = String(jst.getUTCHours()).padStart(2, "0");
  const mm = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

/** datetime-local（JST想定）→ UTC ISO */
function jstInputToIso(input: string): string {
  if (!input) return "";
  // 'YYYY-MM-DDTHH:MM' as JST → UTC
  const d = new Date(input + ":00+09:00");
  return d.toISOString();
}

export default function ChangeTimeForm({
  bookingId,
  currentStartIso,
  currentEndIso,
  pricePerHour,
  minHours,
  maxHours,
}: Props) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(isoToJstInput(currentStartIso));
  const [end, setEnd] = useState(isoToJstInput(currentEndIso));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const prevHours =
    (new Date(currentEndIso).getTime() - new Date(currentStartIso).getTime()) / (60 * 60 * 1000);
  const newStartMs = start ? new Date(start + ":00+09:00").getTime() : NaN;
  const newEndMs = end ? new Date(end + ":00+09:00").getTime() : NaN;
  const newHours = Number.isFinite(newStartMs) && Number.isFinite(newEndMs)
    ? (newEndMs - newStartMs) / (60 * 60 * 1000)
    : 0;
  const hoursDelta = newHours - prevHours;
  const estimatedExtra = hoursDelta > 0 ? Math.round(pricePerHour * hoursDelta) : 0;
  const isExtend = hoursDelta > 0;
  const isShorten = hoursDelta < 0;
  const sameStart =
    Number.isFinite(newStartMs) &&
    new Date(currentStartIso).getTime() === newStartMs;
  const isShift = !sameStart;

  async function submit() {
    setBusy(true);
    setError("");
    const res = await fetch("/api/booking/change-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId,
        startAt: jstInputToIso(start),
        endAt: jstInputToIso(end),
        reason,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error ?? "申請に失敗しました");
      setBusy(false);
      return;
    }
    if (json.type === "extend_pending_payment" && json.checkoutUrl) {
      // 決済ページへ遷移
      window.location.href = json.checkoutUrl;
      return;
    }
    // 短縮/時間ずらし: 申請受付完了
    alert("変更申請を受け付けました。管理者の承認後に確定します。メールでもご連絡します。");
    window.location.reload();
  }

  if (!open) {
    return (
      <p style={{ marginTop: "0.75rem" }}>
        <button className="link-button" onClick={() => setOpen(true)}>
          🕐 予約時間を変更する
        </button>
      </p>
    );
  }

  return (
    <div className="admin-form-panel" style={{ marginTop: "1rem" }}>
      <h3 style={{ marginTop: 0 }}>予約時間の変更</h3>
      <p className="policy">
        利用開始の2時間前まで変更できます。延長はその場でお支払い、短縮・時間ずらしは管理者承認制（メールでご連絡）です。
      </p>
      <label>
        新しい開始日時
        <input
          type="datetime-local"
          step={1800}
          value={start}
          onChange={(e) => setStart(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        新しい終了日時
        <input
          type="datetime-local"
          step={1800}
          value={end}
          onChange={(e) => setEnd(e.target.value)}
          disabled={busy}
        />
      </label>
      <label>
        変更理由（任意）
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          disabled={busy}
          placeholder="例: 開始時刻を1時間遅らせたい / 利用時間を1時間短縮したい"
        />
      </label>

      {Number.isFinite(newHours) && newHours > 0 && (
        <div className="notice" style={{ marginTop: "0.5rem" }}>
          {isExtend && (
            <>
              <strong>延長 {hoursDelta}時間</strong>
              <br />
              追加お支払い見込み: ¥{estimatedExtra.toLocaleString()}（次の画面で決済）
              <br />
              <span className="policy">最低{minHours}時間〜最大{maxHours}時間</span>
            </>
          )}
          {isShorten && (
            <>
              <strong>短縮 {Math.abs(hoursDelta)}時間</strong>
              <br />
              キャンセルポリシー上の無料区間内なら差額返金、有料区間に入っている場合は料金据え置きとなります。
              <br />
              管理者の承認が必要です。
            </>
          )}
          {isShift && !isExtend && !isShorten && (
            <>
              <strong>時間ずらし</strong>
              <br />
              管理者の承認が必要です。料金変動はありません。
            </>
          )}
        </div>
      )}

      {error && <div className="notice error">{error}</div>}

      <div className="cancel-actions" style={{ marginTop: "0.75rem" }}>
        {!confirming ? (
          <>
            <button
              className="submit-btn"
              onClick={() => setConfirming(true)}
              disabled={busy || !start || !end}
            >
              内容を確認する
            </button>
            <button className="cancel-back" onClick={() => setOpen(false)} disabled={busy}>
              閉じる
            </button>
          </>
        ) : (
          <>
            <button className="submit-btn" onClick={submit} disabled={busy}>
              {busy ? "送信中..." : isExtend ? "決済画面へ進む" : "申請する"}
            </button>
            <button className="cancel-back" onClick={() => setConfirming(false)} disabled={busy}>
              戻る
            </button>
          </>
        )}
      </div>
    </div>
  );
}
