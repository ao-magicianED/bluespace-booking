import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * ログインセッションの自動更新（@supabase/ssr標準パターン）。
 * APIルート（特にStripe Webhook）と静的ファイルには触らない。
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // トークンの更新を発火させる（結果は使わない）
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // /r/（QR入口の302＋価格ティアCookie発行）は除外する。middlewareのSet-Cookieと
  // route handlerの302レスポンスを混在させないため（入口はセッション更新不要。
  // リダイレクト先の拠点ページで通常どおりmiddlewareが走る）。
  matcher: ["/((?!api|r/|_next/static|_next/image|favicon.ico|.*\\.).*)"],
};
