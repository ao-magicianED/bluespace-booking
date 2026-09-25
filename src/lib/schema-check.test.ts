import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { SCHEMA_MANIFEST } from "./schema-manifest";
import {
  PROBE_ARG_VALUE,
  checkSchema,
  classifyProbeError,
  formatSchemaDriftAlert,
} from "./schema-check";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");
const migrationNames = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""));
const sqlOf = (migration: string) =>
  readFileSync(path.join(MIGRATIONS_DIR, `${migration}.sql`), "utf8").toLowerCase();

/**
 * src配下のコードが db.rpc("名前", { p_xxx: ... }) で渡している引数名を関数ごとに集める（全呼び出しの和集合）。
 * 簡易パーサなので、RPCの引数は「p_ で始まるキーを直接書いたオブジェクトリテラル」で渡すこと
 * （変数・スプレッド・省略記法で渡すとキーを拾えずテストが落ちる＝気づける）。
 */
function collectRpcCallsInSource(): Map<string, Set<string>> {
  const calls = new Map<string, Set<string>>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(name) || name.endsWith(".test.ts")) continue;
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(/\.rpc\(\s*["'`]([A-Za-z0-9_]+)["'`]\s*(,\s*\{)?/g)) {
        const keys = calls.get(m[1]) ?? new Set<string>();
        calls.set(m[1], keys);
        if (!m[2]) continue;
        // 引数オブジェクトの { から対応する } までを取り出してキーを拾う
        let depth = 0;
        let end = m.index + m[0].length - 1;
        for (; end < src.length; end++) {
          if (src[end] === "{") depth++;
          if (src[end] === "}" && --depth === 0) break;
        }
        const body = src.slice(m.index + m[0].length, end);
        for (const k of body.matchAll(/\b(p_[a-z0-9_]+)\s*:/g)) keys.add(k[1]);
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
  return calls;
}

describe("台帳（schema-manifest.ts）の整合性", () => {
  it("supabase/migrations の全ファイルに台帳エントリがある（マイグレーション追加時の登録漏れ防止）", () => {
    const registered = SCHEMA_MANIFEST.map((e) => e.migration);
    expect(new Set(registered).size, "同じマイグレーションが2回登録されている").toBe(registered.length);
    expect([...registered].sort()).toEqual([...migrationNames].sort());
  });

  it("各エントリは確認用の目印（tables/rpcs）か、確認できない理由（unverifiable）のどちらかを持つ", () => {
    for (const e of SCHEMA_MANIFEST) {
      const probeCount = Object.keys(e.tables ?? {}).length + Object.keys(e.rpcs ?? {}).length;
      expect(probeCount > 0 || Boolean(e.unverifiable?.trim()), e.migration).toBe(true);
    }
  });

  it("台帳の名前はそのマイグレーションSQLで実際に作られている（typo・登録先の取り違え防止）", () => {
    for (const e of SCHEMA_MANIFEST) {
      const sql = sqlOf(e.migration);
      for (const [table, columns] of Object.entries(e.tables ?? {})) {
        expect(new RegExp(`\\b${table}\\b`).test(sql), `${e.migration}: テーブル ${table}`).toBe(true);
        if (columns.length === 0) {
          const created = new RegExp(`create\\s+table\\s+(if\\s+not\\s+exists\\s+)?(public\\.)?${table}\\b`);
          expect(created.test(sql), `${e.migration}: create table ${table} が無い`).toBe(true);
        }
        for (const col of columns) {
          const added = new RegExp(`add\\s+column\\s+(if\\s+not\\s+exists\\s+)?${col}\\b`);
          expect(added.test(sql), `${e.migration}: add column ${col} が無い`).toBe(true);
        }
      }
      for (const [fn, args] of Object.entries(e.rpcs ?? {})) {
        const created = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+(public\\.)?${fn}\\s*\\(`);
        expect(created.test(sql), `${e.migration}: create function ${fn} が無い`).toBe(true);
        for (const a of args) {
          expect(new RegExp(`\\b${a}\\b`).test(sql), `${e.migration}: ${fn} の引数 ${a}`).toBe(true);
        }
      }
    }
  });

  it("コードが呼ぶRPCは全て台帳にあり、台帳の引数名＝コードが渡す引数名（全呼び出しの和集合）", () => {
    const registered = new Map<string, string[]>();
    for (const e of SCHEMA_MANIFEST) {
      for (const [fn, args] of Object.entries(e.rpcs ?? {})) {
        expect(registered.has(fn), `${fn} が2つのエントリに登録されている`).toBe(false);
        registered.set(fn, args);
      }
    }
    const calls = collectRpcCallsInSource();
    expect(calls.size).toBeGreaterThan(0); // 走査自体が壊れていないこと
    for (const [fn, keys] of calls) {
      expect(registered.has(fn), `コードが呼ぶ ${fn} が台帳に未登録`).toBe(true);
      expect([...(registered.get(fn) ?? [])].sort(), `${fn} の引数名`).toEqual([...keys].sort());
    }
    for (const fn of registered.keys()) {
      expect(calls.has(fn), `台帳の ${fn} はもうコードから呼ばれていない`).toBe(true);
    }
  });
});

describe("classifyProbeError", () => {
  it.each([
    [null, "ok"],
    [{ code: "25006", message: "cannot execute UPDATE in a read-only transaction" }, "ok"],
    [{ code: "22P02", message: "invalid input syntax for type uuid" }, "ok"],
    [{ code: "22007", message: "invalid input syntax for type timestamp with time zone" }, "ok"],
    [{ code: "P0001", message: "raise（pre-requestフック等の可能性もあり断定しない）" }, "inconclusive"],
    [{ code: "28P01", message: "password authentication failed" }, "inconclusive"],
    [{ code: "PGRST202", message: "Could not find the function" }, "missing"],
    [{ code: "PGRST205", message: "Could not find the table" }, "missing"],
    [{ code: "42P01", message: "relation does not exist" }, "missing"],
    [{ code: "42703", message: "column does not exist" }, "missing"],
    [{ code: "42883", message: "function does not exist" }, "missing"],
    [{ code: "", message: "TypeError: fetch failed" }, "inconclusive"],
    [{ code: "PGRST000", message: "Database connection failed" }, "inconclusive"],
    [{ code: "PGRST301", message: "JWT" }, "inconclusive"],
    [{ code: "PGRST203", message: "ambiguous overload" }, "inconclusive"],
    [{ code: "57014", message: "statement timeout" }, "inconclusive"],
    [{ code: "42501", message: "permission denied" }, "inconclusive"],
  ] as const)("%j → %s", (error, expected) => {
    expect(classifyProbeError(error)).toBe(expected);
  });
});

type FakeError = { code: string; message: string } | null;

/** PostgRESTの代わり。テーブル/RPCごとに返すエラーを差し替え、呼ばれ方を記録する */
function fakeDb(opts: {
  tableError?: (table: string, columns: string) => FakeError;
  rpcError?: (fn: string) => FakeError | "throw";
  /** テーブル探査が応答せず、タイムアウト（abort）まで待たされる状況を再現する */
  hangTables?: boolean;
}) {
  const selects: { table: string; columns: string; limit: number }[] = [];
  const rpcCalls: { fn: string; args: Record<string, unknown>; options: unknown }[] = [];
  const db = {
    from: (table: string) => ({
      select: (columns: string) => ({
        limit: (limit: number) => {
          selects.push({ table, columns, limit });
          return {
            abortSignal: async (signal: AbortSignal) => {
              if (opts.hangTables) {
                await new Promise((resolve) => signal.addEventListener("abort", resolve));
                return { error: { code: "", message: "AbortError: This operation was aborted" } };
              }
              return { error: opts.tableError?.(table, columns) ?? null };
            },
          };
        },
      }),
    }),
    rpc: (fn: string, args: Record<string, unknown>, options: unknown) => {
      rpcCalls.push({ fn, args, options });
      return {
        abortSignal: async () => {
          const e = opts.rpcError?.(fn) ?? null;
          if (e === "throw") throw new Error("network down");
          return { error: e };
        },
      };
    },
  };
  return { db: db as unknown as SupabaseClient, selects, rpcCalls };
}

describe("checkSchema", () => {
  it("全て揃っていれば missing/inconclusive なし・アラートも出さない", async () => {
    // 実際の本番と同様、書き込みを伴う関数はREAD ONLYで25006になる（=存在する）
    const { db } = fakeDb({ rpcError: () => ({ code: "25006", message: "read-only transaction" }) });
    const result = await checkSchema(db);
    expect(result.missing).toEqual([]);
    expect(result.inconclusive).toEqual([]);
    expect(result.probed).toBeGreaterThan(20);
    expect(formatSchemaDriftAlert(result)).toBeNull();
  });

  it("探査は読むだけ: テーブルは limit(0)、RPCは必ず GET（READ ONLY）でダミー引数", async () => {
    const { db, selects, rpcCalls } = fakeDb({});
    await checkSchema(db);
    expect(selects.length).toBeGreaterThan(0);
    for (const s of selects) expect(s.limit).toBe(0);
    expect(rpcCalls.length).toBeGreaterThan(0);
    for (const c of rpcCalls) {
      expect(c.options, `${c.fn} がGETで呼ばれていない`).toEqual({ get: true });
      for (const v of Object.values(c.args)) expect(v).toBe(PROBE_ARG_VALUE);
    }
  });

  it("0016/0017未適用（2026-09の実事故）を検出し、マイグレーション名入りでアラートする", async () => {
    const { db } = fakeDb({
      tableError: (table, columns) => {
        if (table === "booking_reviews") return { code: "PGRST205", message: "Could not find the table" };
        if (table === "bookings" && columns.includes("review_token")) {
          return { code: "42703", message: "column bookings.review_token does not exist" };
        }
        return null;
      },
      rpcError: (fn) =>
        fn.startsWith("increment_") && fn.endsWith("_amount")
          ? { code: "PGRST202", message: `Could not find the function public.${fn}` }
          : { code: "25006", message: "read-only transaction" },
    });
    const result = await checkSchema(db);
    expect(new Set(result.missing.map((r) => r.migration))).toEqual(
      new Set(["0016_reviews", "0017_atomic_amount_increments"])
    );
    expect(result.missing).toHaveLength(4);
    expect(result.inconclusive).toEqual([]);

    const alert = formatSchemaDriftAlert(result);
    expect(alert?.subject).toContain("0016_reviews");
    expect(alert?.subject).toContain("0017_atomic_amount_increments");
    expect(alert?.text).toContain("increment_refunded_amount(p_booking_id, p_delta)");
    expect(alert?.text).toContain("PGRST202");
  });

  it("通信エラーは「未適用」と断定せず inconclusive として報告する", async () => {
    const { db } = fakeDb({
      tableError: (table) => (table === "venues" ? { code: "", message: "TypeError: fetch failed" } : null),
      rpcError: (fn) => (fn === "get_license_status" ? "throw" : null),
    });
    const result = await checkSchema(db);
    expect(result.missing).toEqual([]);
    expect(result.inconclusive.length).toBeGreaterThanOrEqual(2);
    expect(result.inconclusive.some((r) => r.detail?.includes("network down"))).toBe(true);

    const alert = formatSchemaDriftAlert(result);
    expect(alert?.subject).toBe("⚠️ DBスキーマ検査で確認できない項目あり");
    expect(alert?.text).not.toContain("未適用の疑い");
  });

  it("DBが応答しなくても全体の時間上限で打ち切り、残りは inconclusive にする", async () => {
    const { db } = fakeDb({ hangTables: true });
    const started = Date.now();
    const result = await checkSchema(db, undefined, { probeMs: 30, totalMs: 60 });
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(result.missing).toEqual([]);
    expect(result.inconclusive.length).toBeGreaterThan(0);
    expect(result.inconclusive.some((r) => r.detail === "検査全体の時間上限のため未検査")).toBe(true);
  });
});
