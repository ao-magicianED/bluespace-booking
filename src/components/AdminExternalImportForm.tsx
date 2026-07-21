"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

const CHANNEL_OPTIONS = [
  { value: "instabase", label: "インスタベース（instabase-bookings.csv）" },
  { value: "spacemarket", label: "スペースマーケット（貸会議室管理表.csv）" },
  { value: "upnow", label: "UPNOW（UPNOW売上実績.csv・Shift_JIS）" },
];

export default function AdminExternalImportForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [channel, setChannel] = useState("instabase");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  async function submit() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setMessage({ kind: "error", text: "CSVファイルを選択してください" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.set("channel", channel);
      form.set("file", file);
      const res = await fetch("/api/admin/external-import", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ kind: "error", text: json.error ?? "取込に失敗しました" });
        return;
      }
      const unmatched =
        json.unmatchedVenueNames?.length > 0
          ? `　拠点マッチ不可: ${json.unmatchedVenueNames.join("、")}`
          : "";
      setMessage({
        kind: "info",
        text: `取込完了: 全${json.rowCount}件（新規${json.insertedCount}件・更新${json.updatedCount}件）${unmatched}`,
      });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-form-panel">
      <h3 style={{ marginTop: 0 }}>CSV取込</h3>
      <p className="policy" style={{ margin: "0.2rem 0 0.6rem" }}>
        各モールの管理画面から手動エクスポートしたCSVをそのままアップロードしてください。
        同じファイルを再アップロードしても、予約IDが同じ行は上書きされるだけで重複しません。
      </p>
      <label>
        チャネル
        <select value={channel} onChange={(e) => setChannel(e.target.value)} disabled={busy}>
          {CHANNEL_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        CSVファイル
        <input type="file" accept=".csv" ref={fileRef} disabled={busy} />
      </label>

      {message && <div className={`notice ${message.kind === "error" ? "error" : ""}`}>{message.text}</div>}

      <div className="cancel-actions" style={{ marginTop: "0.75rem" }}>
        <button className="submit-btn" onClick={submit} disabled={busy}>
          {busy ? "取込中..." : "アップロードして取込"}
        </button>
      </div>
    </div>
  );
}
