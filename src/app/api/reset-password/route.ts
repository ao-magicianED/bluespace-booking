import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { sendMail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";
import { formatMemberNo } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/**
 * POST /api/reset-password — パスワード再設定コードの送信。
 * リンクではなく6桁コード方式（リダイレクトURL設定に依存しない）。
 * アカウントの有無は外部から判別できないよう、常に成功を返す。
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`reset:${ip}`)) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
      { status: 429 }
    );
  }

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }

  const db = getDb();
  const { data, error } = await db.auth.admin.generateLink({ type: "recovery", email });

  // 未登録メールでもエラーを返さない（メールアドレスの存在を漏らさない）
  if (error || !data.properties?.email_otp) {
    if (error && !error.message.toLowerCase().includes("not found")) {
      console.error("[reset-password] generateLink失敗:", error);
    }
    return NextResponse.json({ ok: true });
  }

  // 会員番号（本人確認の安心材料としてメールに記載）
  let memberLine: string[] = [];
  if (data.user?.id) {
    const { data: member } = await db
      .from("member_profiles")
      .select("member_no")
      .eq("user_id", data.user.id)
      .maybeSingle();
    if (member?.member_no != null) {
      memberLine = [`会員番号: ${formatMemberNo(member.member_no)}（ご登録済みの会員です）`, ``];
    }
  }

  await sendMail({
    to: email,
    subject: "【ブルーステージ】パスワード再設定コード",
    text: [
      `ブルースペース会員のパスワード再設定を受け付けました。`,
      ...memberLine,
      `以下のコードを、パスワード再設定画面に入力してください。`,
      ``,
      `再設定コード: ${data.properties.email_otp}`,
      ``,
      `※コードの有効期限は約1時間です。`,
      `※このメールに心当たりがない場合は、破棄してください（パスワードは変更されません）。`,
      ``,
      `──────────────────`,
      `ブルーステージ合同会社`,
      `ブルースペース（レンタルスペース）`,
      `https://bluespacerental.com`,
    ].join("\n"),
  });

  return NextResponse.json({ ok: true });
}
