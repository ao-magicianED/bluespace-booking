"use client";

import { useState } from "react";
import type { PriceBand } from "@/lib/pricing";

/**
 * 管理画面: 時間帯別料金エディタ（tier × day_type × 帯のグリッド編集）。
 * 保存は /api/admin/venue-price-bands 経由で replace_venue_price_bands RPC を呼ぶ。
 * ここでの検証（0-24被覆・10円単位・standard>=repeat・下限警告）は補助で、
 * 最終防衛はRPC内の検証。
 */

type Row = {
  startHour: number;
  endHour: number;
  standard: number | "";
  repeat: number | "";
};

type DayTypeKey = "weekday" | "holiday";

const DAY_LABEL: Record<DayTypeKey, string> = { weekday: "平日", holiday: "土日祝" };

/** 既存の帯（両tier）から編集行を組み立てる（境界の和集合で区切る） */
function buildRows(standard: PriceBand[], repeat: PriceBand[]): Row[] {
  if (standard.length === 0 && repeat.length === 0) return [];
  const boundaries = new Set<number>();
  for (const b of [...standard, ...repeat]) {
    boundaries.add(b.startHour);
    boundaries.add(b.endHour);
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const rows: Row[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const s = sorted[i];
    const e = sorted[i + 1];
    const std = standard.find((b) => b.startHour <= s && e <= b.endHour);
    const rep = repeat.find((b) => b.startHour <= s && e <= b.endHour);
    rows.push({
      startHour: s,
      endHour: e,
      standard: std?.hourlyPrice ?? "",
      repeat: rep?.hourlyPrice ?? "",
    });
  }
  return rows;
}

/** 初期テンプレート（4帯: 深夜0-6 / 朝6-12 / 昼12-18 / 夜18-24）。価格は現行フラットで埋める */
function templateRows(flatPrice: number): Row[] {
  return [0, 6, 12, 18].map((s) => ({
    startHour: s,
    endHour: s + 6,
    standard: flatPrice,
    repeat: flatPrice,
  }));
}

function validateRows(rows: Row[], floorPrice: number | null): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (rows.length === 0) {
    errors.push("帯がありません");
    return { errors, warnings };
  }
  if (rows[0].startHour !== 0) errors.push("最初の帯は0時から始めてください");
  if (rows[rows.length - 1].endHour !== 24) errors.push("最後の帯は24時で終えてください");
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Number.isInteger(r.startHour) || !Number.isInteger(r.endHour) || r.endHour <= r.startHour) {
      errors.push(`${i + 1}行目: 時刻は整数時・開始<終了にしてください`);
    }
    if (i > 0 && rows[i - 1].endHour !== r.startHour) {
      errors.push(`${i + 1}行目: 前の帯と隙間・重複があります`);
    }
    for (const key of ["standard", "repeat"] as const) {
      const v = r[key];
      if (v === "" || !Number.isInteger(v) || v < 0) {
        errors.push(`${i + 1}行目: ${key === "standard" ? "通常" : "リピート"}価格を入力してください`);
      } else {
        if (v % 10 !== 0) errors.push(`${i + 1}行目: 価格は10円単位にしてください（¥${v}）`);
        if (floorPrice != null && v < floorPrice) {
          warnings.push(`${i + 1}行目: ¥${v} は拠点下限（¥${floorPrice}）を下回っています`);
        }
      }
    }
    if (r.standard !== "" && r.repeat !== "" && r.standard < r.repeat) {
      errors.push(`${i + 1}行目: 通常価格はリピート価格以上にしてください`);
    }
  }
  return { errors, warnings };
}

function DayTypeEditor({
  venueId,
  dayType,
  initialRows,
  flatPrice,
  floorPrice,
}: {
  venueId: string;
  dayType: DayTypeKey;
  initialRows: Row[];
  flatPrice: number;
  floorPrice: number | null;
}) {
  const [rows, setRows] = useState<Row[]>(initialRows);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  const { errors, warnings } = validateRows(rows, floorPrice);

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setMessage(null);
  }

  function splitRow(i: number) {
    setRows((prev) => {
      const r = prev[i];
      if (r.endHour - r.startHour < 2) return prev;
      const mid = Math.floor((r.startHour + r.endHour) / 2);
      const next = [...prev];
      next.splice(i, 1, { ...r, endHour: mid }, { ...r, startHour: mid });
      return next;
    });
  }

  function mergeRow(i: number) {
    setRows((prev) => {
      if (i >= prev.length - 1) return prev;
      const next = [...prev];
      next.splice(i, 2, { ...prev[i], endHour: prev[i + 1].endHour });
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    const bands = rows.flatMap((r) => [
      { tier: "standard", startHour: r.startHour, endHour: r.endHour, hourlyPrice: r.standard },
      { tier: "repeat", startHour: r.startHour, endHour: r.endHour, hourlyPrice: r.repeat },
    ]);
    const res = await fetch("/api/admin/venue-price-bands", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ venueId, dayType, bands }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage({ kind: "error", text: json.error ?? "保存に失敗しました" });
      setBusy(false);
      return;
    }
    setMessage({ kind: "info", text: "保存しました（置換前の帯は監査ログに退避済み）" });
    setBusy(false);
  }

  if (rows.length === 0) {
    return (
      <div style={{ marginBottom: "1rem" }}>
        <strong>{DAY_LABEL[dayType]}</strong>: 帯なし（現在はフラット価格 ¥
        {flatPrice.toLocaleString()}/h）
        <button
          className="link-button"
          style={{ marginLeft: "0.6rem" }}
          onClick={() => setRows(templateRows(flatPrice))}
        >
          時間帯別料金を初期化（4帯テンプレート）
        </button>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: "1.2rem" }}>
      <strong>{DAY_LABEL[dayType]}</strong>
      <table className="legal-table band-price-table" style={{ marginTop: "0.4rem" }}>
        <thead>
          <tr>
            <th>開始</th>
            <th>終了</th>
            <th>通常（standard）</th>
            <th>リピート（repeat）</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${i}-${r.startHour}`}>
              <td>
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={r.startHour}
                  onChange={(e) => updateRow(i, { startHour: Number(e.target.value) })}
                  style={{ width: "4em" }}
                  disabled={busy}
                />
                時
              </td>
              <td>
                <input
                  type="number"
                  min={1}
                  max={24}
                  value={r.endHour}
                  onChange={(e) => updateRow(i, { endHour: Number(e.target.value) })}
                  style={{ width: "4em" }}
                  disabled={busy}
                />
                時
              </td>
              <td>
                ¥
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={r.standard}
                  onChange={(e) =>
                    updateRow(i, { standard: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                  style={{ width: "6em" }}
                  disabled={busy}
                />
              </td>
              <td>
                ¥
                <input
                  type="number"
                  min={0}
                  step={10}
                  value={r.repeat}
                  onChange={(e) =>
                    updateRow(i, { repeat: e.target.value === "" ? "" : Number(e.target.value) })
                  }
                  style={{ width: "6em" }}
                  disabled={busy}
                />
              </td>
              <td>
                <button className="link-button" onClick={() => splitRow(i)} disabled={busy}>
                  分割
                </button>
                {i < rows.length - 1 && (
                  <button className="link-button" onClick={() => mergeRow(i)} disabled={busy}>
                    結合
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {errors.length > 0 && (
        <div className="notice error" style={{ marginTop: "0.4rem" }}>
          {errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      {warnings.length > 0 && (
        <div className="notice" style={{ marginTop: "0.4rem" }}>
          {warnings.map((w) => (
            <div key={w}>⚠️ {w}</div>
          ))}
        </div>
      )}
      {message && (
        <div className={`notice ${message.kind === "error" ? "error" : ""}`} style={{ marginTop: "0.4rem" }}>
          {message.text}
        </div>
      )}
      <button
        className="submit-btn"
        style={{ marginTop: "0.5rem" }}
        onClick={save}
        disabled={busy || errors.length > 0}
      >
        {busy ? "保存中..." : `${DAY_LABEL[dayType]}の帯を保存する`}
      </button>
    </div>
  );
}

export default function AdminPriceBandEditor({
  venueId,
  weekdayStandard,
  weekdayRepeat,
  holidayStandard,
  holidayRepeat,
  weekdayFlatPrice,
  holidayFlatPrice,
  floorPrice,
}: {
  venueId: string;
  weekdayStandard: PriceBand[];
  weekdayRepeat: PriceBand[];
  holidayStandard: PriceBand[];
  holidayRepeat: PriceBand[];
  weekdayFlatPrice: number;
  holidayFlatPrice: number;
  floorPrice: number | null;
}) {
  return (
    <div className="admin-form-panel" style={{ marginTop: "1.5rem" }}>
      <h2>時間帯別料金（1時間・税込）</h2>
      <p className="policy">
        0〜24時を隙間なく覆うこと・両ティアの入力・10円単位・通常≥リピートが保存条件です
        （サーバー側でも検証されます）。保存は日種ごとの全置換で、置換前の帯は監査ログに残ります。
        帯を削除している間、該当拠点は現行フラット価格に戻ります（帯の全削除はSQLでのみ実行可）。
      </p>
      <DayTypeEditor
        venueId={venueId}
        dayType="weekday"
        initialRows={buildRows(weekdayStandard, weekdayRepeat)}
        flatPrice={weekdayFlatPrice}
        floorPrice={floorPrice}
      />
      <DayTypeEditor
        venueId={venueId}
        dayType="holiday"
        initialRows={buildRows(holidayStandard, holidayRepeat)}
        flatPrice={holidayFlatPrice}
        floorPrice={floorPrice}
      />
    </div>
  );
}
