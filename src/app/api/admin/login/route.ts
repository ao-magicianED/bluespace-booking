import { NextRequest, NextResponse } from "next/server";
import { createAdminSessionValue, verifyAdminPassword } from "@/lib/admin-auth";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** POST /api/admin/login — パスワード照合してセッションCookieを発行 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`admin-login:${ip}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "試行回数が多すぎます。しばらく待ってください" }, { status: 429 });
  }

  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  if (!verifyAdminPassword(body.password ?? "")) {
    return NextResponse.json({ error: "パスワードが違います" }, { status: 401 });
  }

  const session = createAdminSessionValue();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(session.name, session.value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: session.maxAge,
  });
  return res;
}
