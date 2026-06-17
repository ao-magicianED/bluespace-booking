import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { sendMail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type SignupBody = {
  name?: string;
  phone?: string;
  email?: string;
  password?: string;
  customerType?: string; // individual | corporate
  companyName?: string;
  primaryUse?: string;
  discoverySource?: string;
};

/**
 * POST /api/signup
 * 会員登録。Supabase標準の英語確認メール（noreply@mail.app.supabase.io）の代わりに、
 * admin.generateLinkで確認リンクだけ作り、自社ドメイン（Resend）から日本語メールを送る。
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`signup:${ip}`)) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
      { status: 429 }
    );
  }

  let body: SignupBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const name = (body.name ?? "").trim();
  const phone = (body.phone ?? "").trim();
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  const customerType = body.customerType === "corporate" ? "corporate" : "individual";
  const companyName = (body.companyName ?? "").trim().slice(0, 120);
  const primaryUse = (body.primaryUse ?? "").trim().slice(0, 50);
  const discoverySource = (body.discoverySource ?? "").trim().slice(0, 50);

  if (!name || name.length > 100) {
    return NextResponse.json({ error: "お名前を入力してください" }, { status: 400 });
  }
  if (!/^[0-9+\-() ]{10,15}$/.test(phone)) {
    return NextResponse.json({ error: "電話番号の形式が正しくありません" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (password.length < 8 || password.length > 72) {
    return NextResponse.json({ error: "パスワードは8文字以上にしてください" }, { status: 400 });
  }
  if (customerType === "corporate" && !companyName) {
    return NextResponse.json({ error: "会社名を入力してください" }, { status: 400 });
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const db = getDb();

  // ユーザー作成＋確認リンク生成（この時点ではSupabaseからメールは送られない）
  const { data, error } = await db.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: {
      data: {
        full_name: name,
        phone,
        customer_type: customerType,
        company_name: customerType === "corporate" ? companyName : "",
        primary_use: primaryUse,
        discovery_source: discoverySource,
      },
      redirectTo: `${site}/login?verified=1`,
    },
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
      return NextResponse.json(
        { error: "このメールアドレスは登録済みです。ログインしてください" },
        { status: 409 }
      );
    }
    console.error("[signup] generateLink失敗:", error);
    return NextResponse.json(
      { error: "登録に失敗しました。時間をおいてお試しください" },
      { status: 500 }
    );
  }

  const actionLink = data.properties?.action_link;
  if (!actionLink) {
    console.error("[signup] action_linkが取得できませんでした");
    return NextResponse.json(
      { error: "登録に失敗しました。時間をおいてお試しください" },
      { status: 500 }
    );
  }

  const ok = await sendMail({
    to: email,
    subject: "【ブルーステージ】メールアドレスの確認（会員登録）",
    text: [
      `${name} 様`,
      ``,
      `ブルーステージ レンタルスペース予約への会員登録ありがとうございます。`,
      `以下のURLを開いて、メールアドレスの確認を完了してください。`,
      ``,
      actionLink,
      ``,
      `確認が完了すると、ログインして以下の機能がご利用いただけます。`,
      `・予約時の情報自動入力`,
      `・予約履歴の確認、キャンセル手続き`,
      `・領収書の発行（PDF保存）`,
      ``,
      `※URLの有効期限は約1時間です。期限が切れた場合は、お手数ですが再度ご登録ください。`,
      `※このメールに心当たりがない場合は、破棄してください。`,
      ``,
      `──────────────────`,
      `ブルーステージ合同会社`,
      `ブルースペース（レンタルスペース）`,
      `https://bluespacerental.com`,
      `お問い合わせ: bluespace@bluestage-lcc.com`,
    ].join("\n"),
  });

  if (!ok) {
    // メールを送れなかった場合はユーザーを削除して、再登録できる状態に戻す
    if (data.user?.id) {
      try {
        await db.auth.admin.deleteUser(data.user.id);
      } catch (e) {
        console.error("[signup] ロールバック失敗:", e);
      }
    }
    return NextResponse.json(
      { error: "確認メールの送信に失敗しました。時間をおいてお試しください" },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
