import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

/**
 * サーバー側（ページ・APIルート）でログイン状態を読むためのクライアント。
 * 公開キー（publishable）を使う。データの読み書きは従来どおりservice_role側（supabase.ts）。
 */
export async function getAuthClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Componentからは書き込めない（middlewareが更新を担当）
          }
        },
      },
    }
  );
}

/** ログイン中のユーザーを返す（未ログインならnull）。JWTはSupabaseサーバーで検証される */
export async function getSessionUser(): Promise<User | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null;
  }
  try {
    const supabase = await getAuthClient();
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  } catch {
    return null;
  }
}
