"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const STATUS_OPTIONS = [
  { value: "applied", label: "設定済み" },
  { value: "reverted", label: "定価に戻した" },
  { value: "expired", label: "対象日が過ぎた（未実施）" },
];

/** 価格施策1件の実施結果を記録する小さなインラインフォーム（一覧の行の中で使う） */
export default function AdminPriceActionResultForm({
  id,
  defaultPrice,
}: {
  id: string;
  defaultPrice: number;
}) {
  const router = useRouter();
  const [status, setStatus] = useState("applied");
  const [appliedPrice, setAppliedPrice] = useState<number>(defaultPrice);
  const [appliedBy, setAppliedBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/price-actions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          appliedPrice: status === "applied" ? appliedPrice : null,
          appliedBy,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "更新に失敗しました");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: "0.3rem", alignItems: "center", flexWrap: "wrap" }}>
      <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={busy} style={{ fontSize: "0.8rem" }}>
        {STATUS_OPTIONS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
      {status === "applied" && (
        <input
          type="number"
          min={0}
          value={appliedPrice}
          onChange={(e) => setAppliedPrice(Number(e.target.value))}
          disabled={busy}
          style={{ width: "5.5rem", fontSize: "0.8rem" }}
        />
      )}
      <input
        type="text"
        placeholder="記入者"
        value={appliedBy}
        onChange={(e) => setAppliedBy(e.target.value)}
        disabled={busy}
        style={{ width: "5.5rem", fontSize: "0.8rem" }}
      />
      <button className="link-button" onClick={submit} disabled={busy}>
        {busy ? "..." : "記録"}
      </button>
      {error && <span style={{ color: "var(--red-text, #b91c1c)", fontSize: "0.8rem" }}>{error}</span>}
    </div>
  );
}
