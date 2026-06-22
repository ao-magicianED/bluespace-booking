import { NextRequest, NextResponse } from "next/server";
import { getDb, isDbConfigured } from "@/lib/supabase";
import { sendAdminAlert, sendMail } from "@/lib/mail";
import { checkRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type ContactBody = {
  type?: string; // general | longterm | storage
  name?: string;
  email?: string;
  phone?: string;
  company?: string; // 法人/事業者名（storage型で使用）
  venues?: string[]; // slug配列
  undecided?: boolean;
  frequency?: string;
  message?: string;
  storageProduct?: string; // 例: "ブルーストレージ白金高輪"
  storagePlan?: string; // 例: "月額178,000円（標準）" / "月額158,000円（6ヶ月以上）"
  storageStart?: string; // 利用開始希望（自由記述）
  website?: string; // honeypot
};

/** POST /api/contact — お問い合わせ受付（管理者通知＋自動返信） */
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!checkRateLimit(`contact:${ip}`)) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらく待ってからお試しください" },
      { status: 429 }
    );
  }

  let body: ContactBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  // honeypot: ボットは黙って成功扱いにする（通知は出さない）
  if ((body.website ?? "").trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const type =
    body.type === "longterm" ? "longterm" : body.type === "storage" ? "storage" : "general";
  const name = (body.name ?? "").trim();
  const email = (body.email ?? "").trim();
  const phone = (body.phone ?? "").trim().slice(0, 20);
  const company = (body.company ?? "").trim().slice(0, 200);
  const frequency = (body.frequency ?? "").trim().slice(0, 30);
  const message = (body.message ?? "").trim();
  const undecided = Boolean(body.undecided);
  const storageProduct = (body.storageProduct ?? "").trim().slice(0, 100);
  const storagePlan = (body.storagePlan ?? "").trim().slice(0, 100);
  const storageStart = (body.storageStart ?? "").trim().slice(0, 100);

  if (!name || name.length > 100) {
    return NextResponse.json({ error: "お名前を入力してください" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "メールアドレスの形式が正しくありません" }, { status: 400 });
  }
  if (!message || message.length > 3000) {
    return NextResponse.json({ error: "お問い合わせ内容を入力してください" }, { status: 400 });
  }

  // 拠点slugを正式名称に変換（不正なslugは無視）
  let venueNames: string[] = [];
  const slugs = Array.isArray(body.venues) ? body.venues.slice(0, 10) : [];
  if (slugs.length > 0 && isDbConfigured()) {
    const { data } = await getDb().from("venues").select("slug, name").in("slug", slugs);
    venueNames = (data ?? []).map((v) => v.name);
  }
  const venueLine =
    venueNames.length > 0 ? venueNames.join("、") : undecided ? "未定（相談したい）" : "（未選択）";

  const typeLabel =
    type === "longterm"
      ? "長期・定期利用の相談"
      : type === "storage"
        ? "ブルーストレージ（法人向けミニ倉庫）のお問い合わせ"
        : "一般のお問い合わせ";

  // --- 管理者通知（Discord＋メール） ---
  await sendAdminAlert(
    `お問い合わせ（${typeLabel}） ${name}様`,
    [
      `お問い合わせフォームから連絡がありました。${email} へ返信してください。`,
      ``,
      `種別: ${typeLabel}`,
      `お名前: ${name}`,
      ...(type === "storage" && company ? [`会社/屋号: ${company}`] : []),
      `メール: ${email}`,
      `電話: ${phone || "（未記入）"}`,
      ...(type === "storage"
        ? [
            `対象: ${storageProduct || "（未指定）"}`,
            `プラン: ${storagePlan || "（未指定）"}`,
            `利用開始希望: ${storageStart || "（未指定）"}`,
          ]
        : [`希望スペース: ${venueLine}`]),
      ...(type === "longterm" ? [`利用頻度: ${frequency || "（未選択）"}`] : []),
      ``,
      `▼内容`,
      message,
    ].join("\n")
  );

  // --- お客様への自動返信（失敗しても受付自体は成立） ---
  const isStorage = type === "storage";
  await sendMail({
    to: email,
    subject: isStorage
      ? "【ブルーストレージ】お問い合わせを受け付けました"
      : "【ブルーステージ】お問い合わせを受け付けました",
    text: [
      `${name} 様`,
      ``,
      isStorage
        ? `ブルーストレージへのお問い合わせありがとうございます。`
        : `ブルースペースへのお問い合わせありがとうございます。`,
      `以下の内容で受け付けました。担当者より通常1〜2営業日以内にご返信します。`,
      ``,
      `▼お問い合わせ内容`,
      `種別: ${typeLabel}`,
      ...(isStorage
        ? [
            `対象: ${storageProduct || "（未指定）"}`,
            ...(storagePlan ? [`プラン: ${storagePlan}`] : []),
            ...(storageStart ? [`利用開始希望: ${storageStart}`] : []),
          ]
        : [`希望スペース: ${venueLine}`]),
      ...(type === "longterm" && frequency ? [`利用頻度: ${frequency}`] : []),
      ``,
      message,
      ``,
      `※このメールに返信いただいてもお問い合わせを追加できます。`,
      ``,
      `──────────────────`,
      `ブルーステージ合同会社`,
      isStorage
        ? `ブルーストレージ（法人向けミニ倉庫）`
        : `ブルースペース（レンタルスペース）`,
      `https://bluespacerental.com`,
    ].join("\n"),
  });

  return NextResponse.json({ ok: true });
}
