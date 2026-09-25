import type { SupabaseClient } from "@supabase/supabase-js";
import { SCHEMA_MANIFEST, type MigrationManifestEntry } from "./schema-manifest";

/**
 * DBスキーマのドリフト検知: schema-manifest.ts の台帳を本番DBに照合する（毎日のcronから呼ぶ）。
 *
 * information_schema / to_regprocedure で調べるにはDB側に検査用の関数を足す＝新しいマイグレーションが
 * 必要になり、検知したい「マイグレーションの適用漏れ」そのものに依存してしまう。
 * そこでアプリと同じ経路（PostgREST）で各オブジェクトを軽く叩き、「見つかるか」だけを見る。
 *   - テーブル/列: select(列).limit(0) … 0行を読むだけ
 *   - RPC: GETで呼ぶ … PostgRESTはGETのRPCを必ず READ ONLY トランザクションで実行するため、
 *     関数本体が書き込もうとしても 25006 で拒否され、DBは一切変わらない。
 *     さらに全引数にダミー文字列を渡すので、uuid/int/jsonb 等の引数を持つ関数は型変換エラーで本体に入る前に止まる。
 *     「関数名＋引数名」で関数が見つからなければ PGRST202 ＝ 未適用（実際の事故で出たのと同じエラー）。
 * 確認しているのは「マイグレーション履歴の完全一致」ではなく「アプリが必須とするオブジェクトの存在」。
 */

/** RPC探査で全引数に渡すダミー値 */
export const PROBE_ARG_VALUE = "schema-probe";
/** 同時に投げる探査数（DB接続プールを食い潰さない程度に） */
const PROBE_CONCURRENCY = 8;
/** 1探査あたり／検査全体の時間上限（DB障害時に後続のメンテナンス処理を長く待たせない） */
const DEFAULT_TIMEOUTS = { probeMs: 5_000, totalMs: 20_000 };

export type ProbeOutcome = "ok" | "missing" | "inconclusive";

export type ProbeResult = {
  migration: string;
  /** 例: "列 bookings(review_token)" / "関数 increment_refunded_amount(p_booking_id, p_delta)" */
  target: string;
  outcome: ProbeOutcome;
  /** ok以外のときのエラーコードとメッセージ */
  detail?: string;
};

export type SchemaCheckResult = {
  probed: number;
  missing: ProbeResult[];
  inconclusive: ProbeResult[];
};

type ProbeError = { code?: string | null; message?: string | null } | null | undefined;

/** 「オブジェクトが無い」ことを示すエラー（PostgRESTのスキーマキャッシュ／Postgres本体） */
const MISSING_CODES = new Set([
  "PGRST202", // 関数が見つからない（関数名 or 引数名の不一致）
  "PGRST204", // 列が見つからない
  "PGRST205", // テーブルが見つからない
  "42P01", // undefined_table
  "42703", // undefined_column
  "42883", // undefined_function
]);

export function classifyProbeError(error: ProbeError): ProbeOutcome {
  if (!error) return "ok";
  const code = error.code ?? "";
  if (MISSING_CODES.has(code)) return "missing";
  // 「関数が見つかり、実行まで進んだ」とわかるエラーだけを存在の証拠にする:
  //   25006 = READ ONLYでの書き込み拒否 / 22xxx = ダミー引数の型変換エラー（uuid・int・jsonb・日時など）
  if (code === "25006" || /^22[0-9A-Z]{3}$/.test(code)) return "ok";
  // それ以外（通信断・タイムアウト＝コードなし、PGRST0xx＝DB接続不可、PGRST203＝曖昧なオーバーロード、
  // PGRST3xx・28xxx＝認証、42501＝権限不足、P0001＝raise など）は有無を断定できない。
  // ただしアプリも同じく失敗しうるので、アラートでは「確認できなかった項目」として報告する
  return "inconclusive";
}

type Probe = {
  migration: string;
  target: string;
  run: (signal: AbortSignal) => PromiseLike<{ error: ProbeError }>;
};

function buildProbes(db: SupabaseClient, manifest: MigrationManifestEntry[]): Probe[] {
  const probes: Probe[] = [];
  for (const entry of manifest) {
    for (const [table, columns] of Object.entries(entry.tables ?? {})) {
      probes.push({
        migration: entry.migration,
        target: columns.length > 0 ? `列 ${table}(${columns.join(", ")})` : `テーブル ${table}`,
        run: (signal) =>
          db
            .from(table)
            .select(columns.length > 0 ? columns.join(",") : "*")
            .limit(0)
            .abortSignal(signal),
      });
    }
    for (const [fn, argNames] of Object.entries(entry.rpcs ?? {})) {
      const args = Object.fromEntries(argNames.map((name) => [name, PROBE_ARG_VALUE]));
      probes.push({
        migration: entry.migration,
        target: `関数 ${fn}(${argNames.join(", ")})`,
        // get: true が安全性の要（READ ONLYトランザクションで実行される）。POSTに変えないこと
        run: (signal) => db.rpc(fn, args, { get: true }).abortSignal(signal),
      });
    }
  }
  return probes;
}

async function runProbe(probe: Probe, timeoutMs: number): Promise<ProbeResult> {
  const base = { migration: probe.migration, target: probe.target };
  try {
    const { error } = await probe.run(AbortSignal.timeout(timeoutMs));
    const outcome = classifyProbeError(error);
    if (outcome === "ok") return { ...base, outcome };
    const message = (error?.message ?? "").slice(0, 200);
    return { ...base, outcome, detail: `${error?.code || "コードなし"}: ${message}` };
  } catch (e) {
    return { ...base, outcome: "inconclusive", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function checkSchema(
  db: SupabaseClient,
  manifest: MigrationManifestEntry[] = SCHEMA_MANIFEST,
  timeouts: { probeMs: number; totalMs: number } = DEFAULT_TIMEOUTS
): Promise<SchemaCheckResult> {
  const probes = buildProbes(db, manifest);
  const deadline = Date.now() + timeouts.totalMs;
  const results: ProbeResult[] = [];
  for (let i = 0; i < probes.length; i += PROBE_CONCURRENCY) {
    const batch = probes.slice(i, i + PROBE_CONCURRENCY);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      for (const p of batch) {
        results.push({
          migration: p.migration,
          target: p.target,
          outcome: "inconclusive",
          detail: "検査全体の時間上限のため未検査",
        });
      }
      continue;
    }
    const timeoutMs = Math.min(timeouts.probeMs, remainingMs);
    results.push(...(await Promise.all(batch.map((p) => runProbe(p, timeoutMs)))));
  }
  return {
    probed: results.length,
    missing: results.filter((r) => r.outcome === "missing"),
    inconclusive: results.filter((r) => r.outcome === "inconclusive"),
  };
}

function groupByMigration(results: ProbeResult[]): string[] {
  const lines: string[] = [];
  const migrations = [...new Set(results.map((r) => r.migration))];
  for (const m of migrations) {
    lines.push(`- ${m}`);
    for (const r of results.filter((x) => x.migration === m)) {
      lines.push(`    ・${r.target} … ${r.detail ?? ""}`);
    }
  }
  return lines;
}

/** 管理者アラートの件名・本文。問題がなければ null（アラートを送らない） */
export function formatSchemaDriftAlert(
  result: SchemaCheckResult
): { subject: string; text: string } | null {
  if (result.missing.length === 0 && result.inconclusive.length === 0) return null;

  const lines: string[] = [];
  if (result.missing.length > 0) {
    lines.push(
      "コードが前提とするDBオブジェクトが本番DBに見つかりません。",
      "下記のマイグレーションが本番に適用されていない可能性があります。",
      "supabase/migrations/<名前>.sql を本番に適用し（Supabase MCP の apply_migration）、",
      "list_migrations とこのアラートが止まることで適用を確認してください。",
      "",
      "■ 未適用の疑い",
      ...groupByMigration(result.missing)
    );
  }
  if (result.inconclusive.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push(
      "■ 確認できなかった項目（通信エラー・権限等。翌日も続く場合は要調査）",
      ...groupByMigration(result.inconclusive)
    );
  }
  lines.push("", `検査数: ${result.probed}（/api/cron/maintenance で毎日自動実行）`);

  const missingMigrations = [...new Set(result.missing.map((r) => r.migration))];
  const subject =
    missingMigrations.length > 0
      ? `⚠️ DBマイグレーション未適用の疑い（${missingMigrations.join(", ")}）`
      : "⚠️ DBスキーマ検査で確認できない項目あり";
  return { subject, text: lines.join("\n") };
}
