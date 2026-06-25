"use client";

import { useMemo, useState } from "react";

type Change = {
  field: string;
  label: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

type Preview = {
  title: string;
  target: string;
  summary: string;
  changes: Change[];
  warnings: string[];
  safeToApply: boolean;
  operationType: string;
};

type LogRow = {
  id: string;
  request_text: string;
  operation_type: string;
  status: string;
  created_at: string;
  applied_at: string | null;
  error_message: string | null;
};

type VenueChoice = { slug: string; name: string };

type PreviewState = {
  operationId: string;
  preview: Preview;
} | null;

const EXAMPLES = [
  "神田の土日祝料金を2500円にして",
  "上野4Aの平日料金を1800円に変更",
  "京成小岩の営業時間を9時から22時にして",
  "白金高輪を受付停止にして",
  "クーポン REPEAT10 10% 上限100回 最低2000円",
];

function formatDate(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

function statusLabel(status: string): string {
  switch (status) {
    case "previewed":
      return "承認待ち";
    case "applied":
      return "適用済み";
    case "failed":
      return "失敗";
    case "cancelled":
      return "取消";
    default:
      return status;
  }
}

export default function AiOpsConsole({ venues, logs }: { venues: VenueChoice[]; logs: LogRow[] }) {
  const [text, setText] = useState(EXAMPLES[0]);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const venueHelp = useMemo(() => venues.map((v) => v.name.replace("ブルースペース", "")).join(" / "), [venues]);

  async function preview() {
    setBusy("preview");
    setMessage(null);
    setPreviewState(null);
    try {
      const res = await fetch("/api/admin/ai-ops/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, source: "admin_console" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "プレビューに失敗しました");
      setPreviewState({ operationId: json.operationId, preview: json.preview });
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "プレビューに失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    if (!previewState) return;
    setBusy("apply");
    setMessage(null);
    try {
      const res = await fetch("/api/admin/ai-ops/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: previewState.operationId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "適用に失敗しました");
      setMessage({ ok: true, text: "変更を適用しました。ページを再読み込みすると履歴に反映されます。" });
      setPreviewState(null);
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "適用に失敗しました" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ai-ops-layout">
      <section className="ai-ops-panel">
        <div className="ai-ops-panel-head">
          <div>
            <h2>自然言語で設定変更</h2>
            <p className="policy">対応拠点: {venueHelp}</p>
          </div>
        </div>

        <label className="ai-ops-label" htmlFor="ai-ops-command">
          指示
        </label>
        <textarea
          id="ai-ops-command"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="例: 神田の土日祝料金を2500円にして"
        />

        <div className="ai-ops-examples" aria-label="入力例">
          {EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => setText(example)}>
              {example}
            </button>
          ))}
        </div>

        <div className="form-actions">
          <button className="submit-btn" type="button" onClick={preview} disabled={busy !== null || !text.trim()}>
            {busy === "preview" ? "解析中..." : "差分を確認"}
          </button>
        </div>

        {message && <div className={`notice ${message.ok ? "success" : "error"}`}>{message.text}</div>}
      </section>

      {previewState && (
        <section className="ai-ops-panel ai-ops-preview">
          <div className="ai-ops-panel-head">
            <div>
              <h2>{previewState.preview.title}</h2>
              <p className="policy">{previewState.preview.summary}</p>
            </div>
            <span className="status-badge st-pending">承認待ち</span>
          </div>

          <div className="grid-wrapper">
            <table className="admin-table ai-ops-table">
              <thead>
                <tr>
                  <th>項目</th>
                  <th>変更前</th>
                  <th>変更後</th>
                </tr>
              </thead>
              <tbody>
                {previewState.preview.changes.map((change) => (
                  <tr key={change.field}>
                    <td>{change.label}</td>
                    <td>{String(change.before ?? "未設定")}</td>
                    <td>{String(change.after ?? "未設定")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {previewState.preview.warnings.length > 0 && (
            <div className="notice">
              <strong>確認事項</strong>
              <ul>
                {previewState.preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="form-actions">
            <button
              className="submit-btn"
              type="button"
              onClick={apply}
              disabled={busy !== null || !previewState.preview.safeToApply}
            >
              {busy === "apply" ? "適用中..." : "この内容で適用"}
            </button>
            <button className="link-button" type="button" onClick={() => setPreviewState(null)} disabled={busy !== null}>
              取り消す
            </button>
          </div>
        </section>
      )}

      <section className="ai-ops-panel">
        <h2>最近のAI操作ログ</h2>
        <div className="grid-wrapper">
          <table className="admin-table ai-ops-log-table">
            <thead>
              <tr>
                <th>日時</th>
                <th>状態</th>
                <th>操作</th>
                <th>指示</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td>
                    {formatDate(log.created_at)}
                    {log.applied_at && (
                      <>
                        <br />
                        <span className="policy">適用: {formatDate(log.applied_at)}</span>
                      </>
                    )}
                  </td>
                  <td>
                    <span className={`status-badge ${log.status === "applied" ? "st-confirmed" : log.status === "failed" ? "st-cancelled" : "st-pending"}`}>
                      {statusLabel(log.status)}
                    </span>
                  </td>
                  <td>{log.operation_type}</td>
                  <td>
                    {log.request_text}
                    {log.error_message && (
                      <>
                        <br />
                        <span className="policy">{log.error_message}</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ textAlign: "center", color: "var(--gray-text)" }}>
                    操作ログはまだありません
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
