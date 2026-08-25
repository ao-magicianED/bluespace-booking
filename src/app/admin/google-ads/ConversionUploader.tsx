"use client";

import { useCallback, useState } from "react";

type Row = {
  bookingId: string;
  clickId: string;
  conversionTime: string;
  conversionValue: number;
  currency: string;
  venueSlug: string;
};

type Loaded = { actionName: string; total: number; rows: Row[] };

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/** CSVフィールドのエスケープ（カンマ・改行・引用符対応） */
function esc(v: string | number): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/**
 * ダウンロードしたCSVと、送信済みにする予約を必ず一致させたいので、
 * サーバーから受け取った同じデータからCSVを組み立てる。
 * サーバーで引き直すと、その間に確定した予約まで巻き込んでしまう。
 */
function buildCsv(loaded: Loaded): string {
  const lines = [
    "Parameters:TimeZone=Asia/Tokyo",
    [
      "Google Click ID",
      "Conversion Name",
      "Conversion Time",
      "Conversion Value",
      "Conversion Currency",
    ].join(","),
  ];
  for (const r of loaded.rows) {
    lines.push(
      [
        esc(r.clickId),
        esc(loaded.actionName),
        esc(r.conversionTime),
        esc(r.conversionValue),
        esc(r.currency),
      ].join(",")
    );
  }
  return lines.join("\r\n") + "\r\n";
}

export default function ConversionUploader() {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    setDownloaded(false);
    try {
      const res = await fetch("/api/admin/google-ads-conversions?format=json", {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "取得に失敗しました");
      setLoaded(json as Loaded);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const download = useCallback(() => {
    if (!loaded) return;
    const blob = new Blob([buildCsv(loaded)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    const a = document.createElement("a");
    a.href = url;
    a.download = `google-ads-conversions-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setDownloaded(true);
  }, [loaded]);

  const mark = useCallback(async () => {
    if (!loaded || loaded.rows.length === 0) return;
    if (
      !window.confirm(
        `${loaded.rows.length}件を送信済みにします。Google広告への取り込みは完了していますか？`
      )
    )
      return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/google-ads-conversions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingIds: loaded.rows.map((r) => r.bookingId) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "記録に失敗しました");
      setMsg(`${json.marked}件を送信済みにしました。`);
      setLoaded(null);
      setDownloaded(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [loaded]);

  const box: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 12,
    padding: "1.25rem",
    marginBottom: "1rem",
  };
  const btn: React.CSSProperties = {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid #d1d5db",
    background: "#fff",
    cursor: "pointer",
    fontSize: 14,
  };
  const primary: React.CSSProperties = {
    ...btn,
    background: "#2563eb",
    borderColor: "#2563eb",
    color: "#fff",
  };

  return (
    <div>
      {err && (
        <div style={{ ...box, background: "#fef2f2", borderColor: "#fecaca", color: "#991b1b" }}>
          {err}
        </div>
      )}
      {msg && (
        <div style={{ ...box, background: "#ecfdf5", borderColor: "#a7f3d0", color: "#065f46" }}>
          {msg}
        </div>
      )}

      <section style={box}>
        <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>① 未送信のコンバージョンを読み込む</h2>
        <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 12px" }}>
          決済が確定していて、まだGoogle広告へ送っていない予約を取り出します。
        </p>
        <button type="button" style={primary} onClick={load} disabled={busy}>
          {busy ? "読み込み中…" : "読み込む"}
        </button>
      </section>

      {loaded && (
        <>
          <section style={box}>
            <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>② CSVをダウンロードして取り込む</h2>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 12px" }}>
              対象 <strong>{loaded.rows.length}件</strong>
              {loaded.total !== loaded.rows.length && (
                <>（うちクリックIDが無く送れない {loaded.total - loaded.rows.length}件は除外）</>
              )}
              。ダウンロードしたら Google広告 → 目標 → コンバージョン → アップロード から取り込んでください。
            </p>
            <button
              type="button"
              style={primary}
              onClick={download}
              disabled={loaded.rows.length === 0}
            >
              CSVをダウンロード
            </button>
          </section>

          <section style={box}>
            <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>③ 送信済みにする</h2>
            <p style={{ fontSize: 13, color: "#6b7280", margin: "0 0 12px" }}>
              <strong>Google広告側で取り込みが成功したことを確認してから</strong>押してください。
              押すと同じ予約は二度と出力されません。
            </p>
            <button
              type="button"
              style={btn}
              onClick={mark}
              disabled={busy || !downloaded || loaded.rows.length === 0}
            >
              {downloaded ? "送信済みにする" : "先にCSVをダウンロードしてください"}
            </button>
          </section>

          {loaded.rows.length > 0 && (
            <section style={box}>
              <h2 style={{ fontSize: 15, margin: "0 0 12px" }}>内訳</h2>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ textAlign: "left", color: "#6b7280" }}>
                      <th style={{ padding: "4px 8px" }}>日時</th>
                      <th style={{ padding: "4px 8px" }}>拠点</th>
                      <th style={{ padding: "4px 8px", textAlign: "right" }}>金額</th>
                      <th style={{ padding: "4px 8px" }}>クリックID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.rows.map((r) => (
                      <tr key={r.bookingId} style={{ borderTop: "1px solid #f3f4f6" }}>
                        <td style={{ padding: "4px 8px", whiteSpace: "nowrap" }}>
                          {r.conversionTime}
                        </td>
                        <td style={{ padding: "4px 8px" }}>{r.venueSlug}</td>
                        <td style={{ padding: "4px 8px", textAlign: "right" }}>
                          {yen(r.conversionValue)}
                        </td>
                        <td
                          style={{
                            padding: "4px 8px",
                            fontFamily: "monospace",
                            fontSize: 11,
                            color: "#6b7280",
                          }}
                        >
                          {r.clickId.slice(0, 24)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
