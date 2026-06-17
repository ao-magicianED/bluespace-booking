import { getDb } from "./supabase";
import { sendMail } from "./mail";
import { utcToJstDateStr } from "./slots";

/**
 * 自動クーポン配布キャンペーン（毎日のCronから呼ぶ・冪等）。
 * ① thanks_next_day: 初回利用の翌日に10%OFF（有効期限2週間）
 * ② winback_30: 最後の利用から30日後、その後の予約がなければ10%OFF（有効期限1ヶ月）
 * ③ winback_90: 同90日後（有効期限1ヶ月）
 * 共通条件: 1回限り・最低利用金額¥2,000・本人のメールアドレス専用
 */

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bluespacerental.com";
const MIN_AMOUNT = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Kind = "thanks_next_day" | "winback_30" | "winback_90";

function genCode(prefix: string): string {
  // 紛らわしい文字（I/O/0/1）を除いたランダムコード
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `${prefix}-${s}`;
}

function jstDate(d: Date): string {
  return d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "long", day: "numeric" });
}

/** クーポン作成→メール送信→配布記録（メール失敗時はクーポンを取り消して次回再試行） */
async function grantAndSend(opts: {
  email: string;
  name: string;
  kind: Kind;
  prefix: string;
  validDays: number;
  intro: string[];
  now: Date;
}): Promise<boolean> {
  const db = getDb();
  const code = genCode(opts.prefix);

  // 二重配布防止: まず配布記録を確保（unique(email,kind)）。
  // Cronの重複実行や複数インスタンスでも、ここで勝てた1回だけがクーポンを作成・送信する。
  const { error: grantError } = await db
    .from("coupon_grants")
    .insert({ email: opts.email, kind: opts.kind, coupon_code: code });
  if (grantError) {
    // 23505 = unique制約違反（=既に配布済み）。それ以外はログのみ
    if (grantError.code !== "23505") {
      console.error("[campaigns] 配布記録の作成失敗:", grantError);
    }
    return false;
  }

  const endsAt = new Date(opts.now.getTime() + opts.validDays * DAY_MS);
  const { error: couponError } = await db.from("coupons").insert({
    code,
    description: `自動配布 ${opts.kind}: ${opts.email}`,
    percent_off: 10,
    max_uses: 1,
    min_amount: MIN_AMOUNT,
    ends_at: endsAt.toISOString(),
    active: true,
    restrict_email: opts.email,
  });
  if (couponError) {
    console.error("[campaigns] クーポン作成失敗:", couponError);
    // 配布記録を戻して次回再試行できるようにする
    await db.from("coupon_grants").delete().eq("email", opts.email).eq("kind", opts.kind);
    return false;
  }

  const ok = await sendMail({
    to: opts.email,
    subject: "【ブルーステージ】次回使える10%OFFクーポンのお届け",
    text: [
      `${opts.name} 様`,
      ``,
      ...opts.intro,
      ``,
      `▼クーポンコード`,
      `${code}`,
      ``,
      `・割引: ご利用料金の10%OFF（直前割・早割とも併用できます）`,
      `・有効期限: ${jstDate(endsAt)}まで`,
      `・ご利用条件: お1人さま1回限り / ¥${MIN_AMOUNT.toLocaleString()}以上のご予約 / 全拠点対象`,
      `・このクーポンは ${opts.email} でのご予約専用です`,
      ``,
      `▼ご予約はこちら（予約時にクーポンコードを入力してください）`,
      SITE,
      ``,
      `毎週・毎月の定期利用は常時10%OFFでご提供しています。`,
      `お見積もりは ${SITE}/contact からお気軽にご相談ください。`,
      ``,
      `──────────────────`,
      `ブルーステージ合同会社`,
      `ブルースペース（レンタルスペース）`,
      SITE,
    ].join("\n"),
  });
  if (!ok) {
    // 送信失敗: クーポンと配布記録を戻して次回のCronで再試行
    await db.from("coupons").delete().eq("code", code);
    await db.from("coupon_grants").delete().eq("email", opts.email).eq("kind", opts.kind);
    return false;
  }

  return true;
}

export async function runCouponCampaigns(
  now: Date = new Date()
): Promise<{ thanks: number; winback30: number; winback90: number }> {
  const db = getDb();
  const { data } = await db
    .from("bookings")
    .select("customer_email, customer_name, end_at")
    .eq("booking_status", "confirmed")
    .limit(10000);

  // 顧客（メール小文字）ごとに 初回終了・最終終了 を集計
  const byEmail = new Map<string, { name: string; first: string; last: string }>();
  for (const r of data ?? []) {
    const email = r.customer_email.trim().toLowerCase();
    const cur = byEmail.get(email);
    if (!cur) {
      byEmail.set(email, { name: r.customer_name, first: r.end_at, last: r.end_at });
    } else {
      if (r.end_at < cur.first) cur.first = r.end_at;
      if (r.end_at > cur.last) {
        cur.last = r.end_at;
        cur.name = r.customer_name;
      }
    }
  }

  // JSTの日単位ウィンドウ（毎日1回のCronで各顧客がちょうど1度だけ該当する）
  const todayStart = new Date(`${utcToJstDateStr(now)}T00:00:00+09:00`);
  const win = (daysAgo: number): [Date, Date] => [
    new Date(todayStart.getTime() - daysAgo * DAY_MS),
    new Date(todayStart.getTime() - (daysAgo - 1) * DAY_MS),
  ];
  const [y0, y1] = win(1); // 昨日
  const [a30, b30] = win(30);
  const [a90, b90] = win(90);

  const result = { thanks: 0, winback30: 0, winback90: 0 };
  for (const [email, info] of byEmail) {
    const first = new Date(info.first);
    const last = new Date(info.last);

    // ① 初回利用が昨日終了 → サンクスクーポン（2週間有効）
    if (first >= y0 && first < y1) {
      const ok = await grantAndSend({
        email,
        name: info.name,
        kind: "thanks_next_day",
        prefix: "THANKS",
        validDays: 14,
        intro: [
          `先日はブルースペースをご利用いただき、誠にありがとうございました。`,
          `感謝の気持ちを込めて、次回のご予約で使える10%OFFクーポンをお届けします。`,
        ],
        now,
      });
      if (ok) result.thanks++;
    }

    // ② 最後の利用から30日経過（その後の予約なし） → 掘り起こし（1ヶ月有効）
    if (last >= a30 && last < b30) {
      const ok = await grantAndSend({
        email,
        name: info.name,
        kind: "winback_30",
        prefix: "BACK30",
        validDays: 30,
        intro: [
          `その後いかがお過ごしでしょうか。前回のご利用から1ヶ月が経ちました。`,
          `またのご利用をお待ちして、10%OFFクーポン（1ヶ月有効）をお届けします。`,
        ],
        now,
      });
      if (ok) result.winback30++;
    }

    // ③ 最後の利用から90日経過 → 掘り起こし第2弾（1ヶ月有効）
    if (last >= a90 && last < b90) {
      const ok = await grantAndSend({
        email,
        name: info.name,
        kind: "winback_90",
        prefix: "BACK90",
        validDays: 30,
        intro: [
          `ご無沙汰しております。ブルースペースです。`,
          `またお会いできることを楽しみに、10%OFFクーポン（1ヶ月有効）をお届けします。`,
        ],
        now,
      });
      if (ok) result.winback90++;
    }
  }
  return result;
}
