"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type VenueOption = { slug: string; name: string; floorPrice: number; requiresIsolatedSlot: boolean };

const CHANNEL_OPTIONS = [
  { value: "instabase", label: "インスタベース" },
  { value: "spacemarket", label: "スペースマーケット" },
  { value: "upnow", label: "UPNOW" },
  { value: "own", label: "自社サイト" },
];

export default function AdminPriceActionForm({ venues }: { venues: VenueOption[] }) {
  const router = useRouter();
  const [venueSlug, setVenueSlug] = useState(venues[0]?.slug ?? "");
  const [targetDate, setTargetDate] = useState("");
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(13);
  const [channel, setChannel] = useState("instabase");
  const [previousPrice, setPreviousPrice] = useState<string>("");
  const [plannedPrice, setPlannedPrice] = useState<number>(0);
  const [isHoldout, setIsHoldout] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const selectedVenue = venues.find((v) => v.slug === venueSlug);

  async function submit() {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/price-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          venueSlug,
          targetDate,
          startHour,
          endHour,
          channel,
          previousPrice: previousPrice === "" ? null : Number(previousPrice),
          plannedPrice,
          isHoldout,
          reason,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ kind: "error", text: json.error ?? "作成に失敗しました" });
        return;
      }
      const warn = (json.warnings ?? []).join(" / ");
      setMessage({ kind: "info", text: warn ? `作成しました。注意: ${warn}` : "作成しました" });
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-form-panel">
      <h3 style={{ marginTop: 0 }}>価格指示の作成</h3>
      {selectedVenue && (
        <p className="policy" style={{ margin: "0.2rem 0 0.6rem" }}>
          {selectedVenue.name}の下限価格: <strong>{selectedVenue.floorPrice}円/h</strong>
          {selectedVenue.requiresIsolatedSlot &&
            "　※人気拠点のため、既存予約に挟まれた孤立1時間枠のみに絞ってください"}
        </p>
      )}
      <label>
        拠点
        <select value={venueSlug} onChange={(e) => setVenueSlug(e.target.value)} disabled={busy}>
          {venues.map((v) => (
            <option key={v.slug} value={v.slug}>
              {v.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        対象日（平日のみ・祝日は保存時にブロックされます）
        <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} disabled={busy} />
      </label>
      <label>
        開始時刻（0〜24・0.5刻み）
        <input
          type="number"
          min={0}
          max={24}
          step={0.5}
          value={startHour}
          onChange={(e) => setStartHour(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <label>
        終了時刻（0〜24・0.5刻み）
        <input
          type="number"
          min={0}
          max={24}
          step={0.5}
          value={endHour}
          onChange={(e) => setEndHour(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <label>
        設定先チャネル
        <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={busy}>
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        変更前の掲載価格（円/h・スタッフが確認できたら入力。未確認なら空欄でOK）
        <input
          type="number"
          min={0}
          value={previousPrice}
          onChange={(e) => setPreviousPrice(e.target.value)}
          disabled={busy}
          placeholder="未確認"
        />
      </label>
      <label>
        指示する特価（円/h）
        <input
          type="number"
          min={0}
          value={plannedPrice}
          onChange={(e) => setPlannedPrice(Number(e.target.value))}
          disabled={busy}
        />
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
        <input
          type="checkbox"
          checked={isHoldout}
          onChange={(e) => {
            setIsHoldout(e.target.checked);
            // 保護枠=「現在の掲載価格のまま」の指示なので、掲載価格が入力済みならそれを自動転記する
            // （0円のまま保存→効果測定データが汚れる事故を防ぐ）
            if (e.target.checked && previousPrice !== "") {
              setPlannedPrice(Number(previousPrice));
            }
          }}
          disabled={busy}
        />
        比較用の保護枠（値下げせず定価のまま。効果測定の対照群にする）
      </label>
      {isHoldout && (
        <p className="policy" style={{ margin: "0.2rem 0 0" }}>
          保護枠の「指示する特価」には現在の掲載価格（定価）をそのまま入力してください。
        </p>
      )}
      <label>
        理由・根拠（曜日×時間帯の稼働率など）
        <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={500} />
      </label>

      {message && <div className={`notice ${message.kind === "error" ? "error" : ""}`}>{message.text}</div>}

      <div className="cancel-actions" style={{ marginTop: "0.75rem" }}>
        <button className="submit-btn" onClick={submit} disabled={busy || !venueSlug || !targetDate}>
          {busy ? "作成中..." : "価格指示を作成"}
        </button>
      </div>
    </div>
  );
}
