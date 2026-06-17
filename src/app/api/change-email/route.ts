import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDb } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth-server";
import { sendMail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * POST /api/change-email — メールアドレス変更の確認コード送信。
 * 本人確認（現在のパスワード）→ 新旧両方のアドレスに6桁コードを日本語メールで送る。
 * （Supabase標準の英語メールは使わない）
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`change-email:${ip}`)) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
      { status: 429 }
    );
  }

  const user = await getSessionUser();
  if (!user?.email) {
    return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
  }

  let body: { newEmail?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const newEmail = (body.newEmail ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) || newEmail.length > 200) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (newEmail === user.email.toLowerCase()) {
    return NextResponse.json({ error: "現在と同じメールアドレスです" }, { status: 400 });
  }

  // 本人確認: 現在のパスワードでサインインできるか（匿名キーの使い捨てクライアントで検証）
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { error: pwError } = await anon.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (pwError) {
    return NextResponse.json({ error: "現在のパスワードが正しくありません" }, { status: 401 });
  }

  const db = getDb();

  // 新しいアドレス宛のコード
  const { data: newLink, error: newError } = await db.auth.admin.generateLink({
    type: "email_change_new",
    email: user.email,
    newEmail,
  });
  if (newError || !newLink.properties?.email_otp) {
    const msg = (newError?.message ?? "").toLowerCase();
    if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
      return NextResponse.json(
        { error: "このメールアドレスは別のアカウントで使用されています" },
        { status: 409 }
      );
    }
    console.error("[change-email] generateLink(new)失敗:", newError);
    return NextResponse.json(
      { error: "確認コードの発行に失敗しました。時間をおいてお試しください" },
      { status: 500 }
    );
  }

  // 現在のアドレス宛のコード（セキュア変更が無効な環境では発行されない場合がある）
  let currentOtp: string | null = null;
  try {
    const { data: curLink, error: curError } = await db.auth.admin.generateLink({
      type: "email_change_current",
      email: user.email,
      newEmail,
    });
    if (!curError && curLink.properties?.email_otp) {
      currentOtp = curLink.properties.email_otp;
    }
  } catch (e) {
    console.warn("[change-email] generateLink(current)スキップ:", e);
  }

  const footer = [
    ``,
    `※コードの有効期限は約1時間です。`,
    `※このメールに心当たりがない場合は、破棄してください（メールアドレスは変更されません）。`,
    ``,
    `──────────────────`,
    `ブルーステージ合同会社`,
    `ブルースペース（レンタルスペース）`,
    `https://bluespacerental.com`,
  ];

  const sentNew = await sendMail({
    to: newEmail,
    subject: "【ブルーステージ】メールアドレス変更の確認コード（新しいアドレス）",
    text: [
      `ブルースペース会員のメールアドレス変更を受け付けました。`,
      `「新しいメールアドレス宛のコード」欄に、以下のコードを入力してください。`,
      ``,
      `確認コード: ${newLink.properties.email_otp}`,
      ...footer,
    ].join("\n"),
  });
  if (!sentNew) {
    return NextResponse.json(
      { error: "確認メールの送信に失敗しました。時間をおいてお試しください" },
      { status: 500 }
    );
  }

  if (currentOtp) {
    await sendMail({
      to: user.email,
      subject: "【ブルーステージ】メールアドレス変更の確認コード（現在のアドレス）",
      text: [
        `ブルースペース会員のメールアドレス変更を受け付けました。`,
        `なりすまし防止のため、現在のアドレスにも確認コードをお送りしています。`,
        `「現在のメールアドレス宛のコード」欄に、以下のコードを入力してください。`,
        ``,
        `確認コード: ${currentOtp}`,
        ...footer,
      ].join("\n"),
    });
  }

  return NextResponse.json({ ok: true, needsBoth: Boolean(currentOtp) });
}
