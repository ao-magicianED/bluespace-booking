import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** 環境変数が設定済みかどうか（未設定でもトップページが落ちないようにする） */
export function isDbConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * サーバー専用のSupabaseクライアント（service_roleキー使用）。
 * クライアントコンポーネントから絶対にimportしないこと。
 */
export function getDb(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です");
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
