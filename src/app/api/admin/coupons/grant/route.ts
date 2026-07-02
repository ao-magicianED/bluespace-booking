import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { sendMail } from "@/lib/mail";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/coupons/grant
 * 管理者が手動でクーポンを発行する（アンケート回答確認後の特典付与など）。
 * coupon_grants.unique(email, kind) を「同一メール・同一kindは1回だけ」の台帳として使う
 * （kind は自由記述: review_reward, survey_reward 等の運用ラベル）。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { email?: string; kind?: string; percentOff?: number; validDays?: number; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const kind = (body.kind ?? "review_reward").trim().slice(0, 50);
  const percentOff = Number.isInteger(body.percentOff) && body.percentOff! > 0 && body.percentOff! <= 100
    ? body.percentOff!
    : 10;
  const validDays = Number.isInteger(body.validDays) && body.validDays! > 0 && body.validDays! <= 365
    ? body.validDays!
    : 30;
  const note = (body.note ?? "").trim().slice(0, 300);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }

  const db = getDb();
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const code = `THX-${Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")}`;

  const { error: grantError } = await db.from("coupon_grants").insert({ email, kind, coupon_code: code });
  if (grantError) {
    if (grantError.code === "23505") {
      return NextResponse.json(
        { error: `このメールアドレスには既に「${kind}」のクーポンを発行済みです` },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: `発行記録の作成に失敗しました: ${grantError.message}` }, { status: 500 });
  }

  const endsAt = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000);
  const { error: couponError } = await db.from("coupons").insert({
    code,
    description: `手動発行 ${kind}: ${email}${note ? `（${note}）` : ""}`,
    percent_off: percentOff,
    max_uses: 1,
    min_amount: 0,
    ends_at: endsAt.toISOString(),
    active: true,
    restrict_email: email,
  });
  if (couponError) {
    await db.from("coupon_grants").delete().eq("email", email).eq("kind", kind);
    return NextResponse.json({ error: `クーポン作成に失敗しました: ${couponError.message}` }, { status: 500 });
  }

  const mailOk = await sendMail({
    to: email,
    subject: `【ブルーステージ】次回使える${percentOff}%OFFクーポンのお届け`,
    text: [
      `いつもありがとうございます。`,
      ``,
      `ご協力への感謝を込めて、次回のご予約で使えるクーポンをお届けします。`,
      ``,
      `▼クーポンコード`,
      code,
      ``,
      `・割引: ご利用料金の${percentOff}%OFF`,
      `・有効期限: ${endsAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}まで`,
      `・ご利用条件: お1人さま1回限り / このメールアドレスでのご予約専用`,
      ``,
      `▼ご予約はこちら`,
      siteUrl(),
      ``,
      `ブルーステージ合同会社`,
    ].join("\n"),
  });

  return NextResponse.json({ ok: true, code, mailSent: mailOk });
}
