import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { createPriceTierCookie } from "@/lib/entry-tier";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 302レスポンス共通ヘッダ（Route Handlerはmetadataを持てないためヘッダで検索除外） */
function withEntryHeaders(res: NextResponse): NextResponse {
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}

/**
 * GET /r/[token] — 現地QRの入口。
 * venue_entry_tokens をDB照合（active=trueのみ）し、成立時のみ署名Cookieを発行して
 * 拠点ページへ302。不成立時はCookieを発行せずトップへ302（エラーは見せない）。
 * utm付与によりGA4（および今後の広告計測基盤）で入口分析ができる。
 * utm_campaignで「現地QR経由」の流入全体を、utm_contentで拠点ごとの内訳を追える
 * （venue_idがnullの全拠点共通トークンは"shared"）。
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const fallback = () =>
    withEntryHeaders(NextResponse.redirect(new URL("/", req.url), 302));

  if (!UUID_RE.test(token)) return fallback();

  try {
    const db = getDb();
    const { data: row, error } = await db
      .from("venue_entry_tokens")
      .select("token, venue_id, active")
      .eq("token", token.toLowerCase())
      .maybeSingle<{ token: string; venue_id: string | null; active: boolean }>();
    if (error || !row || row.active !== true) return fallback();

    // venue_idがnullなら全拠点共通トークン → トップへ
    let dest = "/";
    let utmContent = "shared";
    if (row.venue_id) {
      const { data: venue } = await db
        .from("venues")
        .select("slug, active")
        .eq("id", row.venue_id)
        .maybeSingle<{ slug: string; active: boolean }>();
      if (venue?.active && venue.slug) {
        dest = `/${venue.slug}`;
        utmContent = venue.slug;
      }
    }

    const url = new URL(dest, req.url);
    url.searchParams.set("utm_source", "qr");
    url.searchParams.set("utm_medium", "onsite");
    url.searchParams.set("utm_campaign", "repeat-pricing");
    url.searchParams.set("utm_content", utmContent);
    const res = withEntryHeaders(NextResponse.redirect(url, 302));

    const cookie = createPriceTierCookie(row.token, new Date());
    if (cookie) {
      res.cookies.set(cookie.name, cookie.value, {
        httpOnly: true,
        secure: cookie.secure,
        sameSite: "lax",
        path: "/",
        maxAge: cookie.maxAge,
      });
    }
    return res;
  } catch (e) {
    console.error("[entry] 入口トークン照合失敗:", e);
    return fallback();
  }
}
