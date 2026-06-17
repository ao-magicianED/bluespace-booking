"use client";

import { createBrowserClient } from "@supabase/ssr";

/** ブラウザ側の認証クライアント（公開キーのみ使用） */
export function getBrowserAuth() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
