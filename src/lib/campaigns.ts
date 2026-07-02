import { getDb } from "./supabase";
import { sendMail } from "./mail";
import { utcToJstDateStr } from "./slots";
import { mapSearchUrl, siteUrl } from "./site-url";

/**
 * 自動クーポン配布キャンペーン（毎日のCronから呼ぶ・冪等）。
 * ① thanks_next_day: 初回利用の翌日に10%OFF（有効期限2週間）
 * ② second_visit_thanks: 2回目利用の翌日に10%OFF（有効期限2週間）
 * ③ winback_30: 最後の利用から30日後、その後の予約がなければ10%OFF（有効期限1ヶ月）
 * ④ winback_90: 同90日後（有効期限1ヶ月）
 * 共通条件: 1回限り・最低利用金額¥2,000・本人のメールアドレス専用
 *
 * ①②には、Googleクチコミの任意のお願いと、アンケート回答特典クーポンの案内を添える
 * （「レビュー投稿でクーポン」はGoogleのクチコミポリシー違反リスクがあるため、
 *   クーポンの対価は必ずアンケート回答にひも付け、クチコミは無償の任意依頼として分離すること）。
 */

const SITE = siteUrl();
const MIN_AMOUNT = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

type Kind = "thanks_next_day" | "second_visit_thanks" | "winback_30" | "winback_90";

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

/**
 * 直近利用拠点の住所からGoogleクチコミ依頼＋アンケート特典の案内ブロックを作る。
 * SURVEY_FORM_URL 未設定の場合はアンケート特典の案内を省略する（壊れたリンクを送らないため）。
 */
function reviewAndSurveyBlock(venueAddress: string | null): string[] {
  const surveyUrl = process.env.SURVEY_FORM_URL?.trim();
  const lines: string[] = [];
  if (venueAddress) {
    lines.push(
      ``,
      `▼クチコミのお願い（任意）`,
      `もしよろしければ、Googleマップから当スペースへのクチコミ投稿にご協力いただけると励みになります。`,
      mapSearchUrl(venueAddress)
    );
  }
  if (surveyUrl) {
    lines.push(
      ``,
      `▼アンケートにご協力ください（回答特典あり）`,
      `サービス改善のため、1分ほどのアンケートにご協力いただけますでしょうか。`,
      `ご回答いただいた方には、次回のご利用で使える10%OFFクーポンをお送りする場合があります。`,
      surveyUrl
    );
  }
  return lines;
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
  venueAddress?: string | null;
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
      ...reviewAndSurveyBlock(opts.venueAddress ?? null),
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

/** 指定メール・終了時刻に一致する直近予約の拠点住所を引く（クチコミ案内のリンク生成用。失敗しても致命的でないのでnull許容） */
async function lookupVenueAddress(
  db: ReturnType<typeof getDb>,
  email: string,
  endAtIso: string
): Promise<string | null> {
  const { data } = await db
    .from("bookings")
    .select("venue_id")
    .ilike("customer_email", email)
    .eq("booking_status", "confirmed")
    .eq("end_at", endAtIso)
    .limit(1)
    .maybeSingle<{ venue_id: string }>();
  if (!data?.venue_id) return null;
  const { data: venue } = await db
    .from("venues")
    .select("address")
    .eq("id", data.venue_id)
    .maybeSingle<{ address: string }>();
  return venue?.address ?? null;
}

export async function runCouponCampaigns(
  now: Date = new Date()
): Promise<{ thanks: number; secondVisit: number; winback30: number; winback90: number }> {
  const db = getDb();
  const { data } = await db
    .from("bookings")
    .select("customer_email, customer_name, end_at")
    .eq("booking_status", "confirmed")
    .limit(10000);

  // 顧客（メール小文字）ごとに、利用終了時刻を全件集めて時系列に並べる
  // （1回目=first / 2回目=second / 最新=last の各終了時刻を判定するため）
  const byEmail = new Map<string, { end_at: string; name: string }[]>();
  for (const r of data ?? []) {
    const email = r.customer_email.trim().toLowerCase();
    const arr = byEmail.get(email) ?? [];
    arr.push({ end_at: r.end_at, name: r.customer_name });
    byEmail.set(email, arr);
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

  const result = { thanks: 0, secondVisit: 0, winback30: 0, winback90: 0 };
  for (const [email, rows] of byEmail) {
    const sorted = [...rows].sort((a, b) => (a.end_at < b.end_at ? -1 : a.end_at > b.end_at ? 1 : 0));
    const first = new Date(sorted[0].end_at);
    const second = sorted.length >= 2 ? new Date(sorted[1].end_at) : null;
    const last = new Date(sorted[sorted.length - 1].end_at);
    const latestName = sorted[sorted.length - 1].name;

    // ① 初回利用が昨日終了 → サンクスクーポン（2週間有効）
    if (first >= y0 && first < y1) {
      const venueAddress = await lookupVenueAddress(db, email, sorted[0].end_at);
      const ok = await grantAndSend({
        email,
        name: latestName,
        kind: "thanks_next_day",
        prefix: "THANKS",
        validDays: 14,
        venueAddress,
        intro: [
          `先日はブルースペースをご利用いただき、誠にありがとうございました。`,
          `感謝の気持ちを込めて、次回のご予約で使える10%OFFクーポンをお届けします。`,
        ],
        now,
      });
      if (ok) result.thanks++;
    }

    // ①' 2回目利用が昨日終了 → 2回目サンクスクーポン（2週間有効）
    if (second && second >= y0 && second < y1) {
      const venueAddress = await lookupVenueAddress(db, email, sorted[1].end_at);
      const ok = await grantAndSend({
        email,
        name: latestName,
        kind: "second_visit_thanks",
        prefix: "THANKS2",
        validDays: 14,
        venueAddress,
        intro: [
          `2回目のご利用、誠にありがとうございました。`,
          `いつもご利用いただき感謝しております。次回のご予約で使える10%OFFクーポンをお届けします。`,
        ],
        now,
      });
      if (ok) result.secondVisit++;
    }

    // ② 最後の利用から30日経過（その後の予約なし） → 掘り起こし（1ヶ月有効）
    if (last >= a30 && last < b30) {
      const ok = await grantAndSend({
        email,
        name: latestName,
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
        name: latestName,
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
