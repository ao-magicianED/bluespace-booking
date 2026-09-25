import { JST_OFFSET_MS, jstDayOfWeek, utcToJstDateStr } from "./slots";
import { parsePurpose, USAGE_CATEGORIES, type UsageCategory } from "./usage-categories";

/**
 * 新規（初回）とリピーターの特徴を比較する集計（純粋関数のみ・管理画面「分析」用）。
 * 環境変数・DB・現在時刻には触れない（除外メールや祝日は呼び出し側から渡す）。
 *
 * - 同一顧客: メールアドレスを trim + 小文字化して一致したもの
 * - 予約単位の区分: 顧客ごとに created_at（申込日時）順に並べ、1件目=初回 / 2件目以降=リピート
 * - 顧客単位のリピーター: 「別のJST日付」の予約が2つ以上ある顧客（同日の分割予約は1回と数える）
 */

/** 集計に使う予約1件分（実収額は呼び出し側で ledger.ts の realizedRevenue により計算して渡す） */
export type InsightBooking = {
  customer_email: string;
  user_id: string | null;
  customer_type: string;
  party_size: number | null;
  purpose: string | null;
  start_at: string;
  end_at: string;
  created_at: string;
  venue_name: string;
  revenue: number;
};

export const SEGMENTS = ["初回", "リピート"] as const;
export type Segment = (typeof SEGMENTS)[number];

export const LEAD_TIME_BUCKETS = ["当日（24時間以内）", "1〜2日前", "3〜13日前", "14日以上前"] as const;
export type LeadTimeBucket = (typeof LEAD_TIME_BUCKETS)[number];

export const DAY_TYPES = ["平日", "土日祝"] as const;
export type DayType = (typeof DAY_TYPES)[number];

export const START_HOUR_BUCKETS = ["〜8時", "9〜11時", "12〜16時", "17〜20時", "21時〜"] as const;
export type StartHourBucket = (typeof START_HOUR_BUCKETS)[number];

/** 目的の集計軸: カテゴリ＋「自由記述のみ」（カテゴリなしの文章）＋「未記入」 */
export const PURPOSE_BUCKETS = [...USAGE_CATEGORIES, "自由記述のみ", "未記入"] as const;
export type PurposeBucket = UsageCategory | "自由記述のみ" | "未記入";

/*
 * テスト予約の判定（カテゴリを除いた「詳細」で判定する）。
 * 「テスト撮影」「配信テスト」「Webテスト受験」「音響テスト」「カメラの動作確認」など、
 * 実際の利用目的にも「テスト」「動作確認」は現れるため部分一致では判定しない。
 * 除外は予約単位なので、実在の顧客の1件目を誤って落とすと2件目が「初回」に化けて集計が歪む。
 * 次のどれかに当たるものだけをテスト予約とする。
 */
/** E2E を含む（実際の利用目的には現れない語） */
const E2E_RE = /\be2e\b/i;
/** 詳細全体がテストの目印だけ（「テスト」「TEST」「動作確認」「テスト予約」「Test booking」など） */
const TEST_ONLY_RE = /^(?:テスト|test|動作確認)(?:\s*(?:予約|用|中|です|booking|run))*[\s。.!]*$/i;
/** 決済・予約まわりのテスト（「決済テスト」「予約システムの動作確認」「checkout test」など） */
const SYSTEM_TEST_RE = /(?:決済|予約|stripe|webhook|checkout)(?:システム)?\s*の?\s*(?:テスト|test|動作確認)/i;

/** 目的がテスト予約か（全角英数・半角カナは NFKC で揃えてから判定する） */
export function isTestPurpose(purpose: string | null | undefined): boolean {
  const { detail } = parsePurpose((purpose ?? "").normalize("NFKC"));
  return E2E_RE.test(detail) || TEST_ONLY_RE.test(detail) || SYSTEM_TEST_RE.test(detail);
}

export type SegmentStats = {
  bookings: number;
  /** 集計対象の全予約に占める割合（0〜1） */
  share: number;
  /** 実収額の合計 */
  revenue: number;
  /** 1予約あたり実収額（予約0件なら0） */
  avgRevenue: number;
  /** 平均人数（人数未入力の予約は除く。対象0件ならnull） */
  avgPartySize: number | null;
  /** 平均人数の母数（人数入力ありの予約数） */
  partySizeN: number;
  /** 平均利用時間（時間。予約0件ならnull） */
  avgHours: number | null;
  /** 会員（user_idあり）の予約数 */
  members: number;
  /** 法人予約（customer_type=corporate）の予約数 */
  corporate: number;
  leadTime: Record<LeadTimeBucket, number>;
  dayType: Record<DayType, number>;
  startHour: Record<StartHourBucket, number>;
  purpose: Record<PurposeBucket, number>;
  /** 拠点別の予約数（多い順・同数は名前順） */
  venues: { name: string; count: number }[];
};

export type CustomerInsights = {
  /** 集計対象の予約数（除外後） */
  totalBookings: number;
  excluded: {
    /** 除外した予約数（重複なし） */
    total: number;
    /** 社内メール（INTERNAL_EMAILS）に一致して除外した数 */
    internalEmail: number;
    /** 目的がテスト予約の文言に一致して除外した数（社内メール分を除く） */
    testPurpose: number;
  };
  segments: Record<Segment, SegmentStats>;
  customers: {
    unique: number;
    /** 別日に2回以上予約している顧客数 */
    repeaters: number;
    /** repeaters / unique（顧客0人ならnull） */
    repeatRate: number | null;
    /** 1回目と2回目（別日）の利用日の間隔の中央値（日）。リピーター0人ならnull */
    medianDaysToSecondVisit: number | null;
  };
};

/**
 * カンマ区切りのメールアドレス一覧（環境変数の値）を、比較用に正規化したSetにする。
 * 空要素は無視する。未設定（undefined）なら空Set。
 */
export function parseEmailList(raw: string | null | undefined): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s !== "")
  );
}

function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

function jstDateOf(iso: string): string {
  return utcToJstDateStr(new Date(iso));
}

function jstHourOf(iso: string): number {
  return new Date(Date.parse(iso) + JST_OFFSET_MS).getUTCHours();
}

/** 申込日時（created_at）から利用開始（start_at）までの長さで分類する。負値（後から登録した予約等）は当日扱い */
export function leadTimeBucket(createdAt: string, startAt: string): LeadTimeBucket {
  const hours = (Date.parse(startAt) - Date.parse(createdAt)) / 3600000;
  if (hours < 24) return "当日（24時間以内）";
  if (hours < 72) return "1〜2日前";
  if (hours < 14 * 24) return "3〜13日前";
  return "14日以上前";
}

/** 利用開始のJST時刻（時）で分類する（8:30開始は「〜8時」） */
export function startHourBucket(startAt: string): StartHourBucket {
  const h = jstHourOf(startAt);
  if (h <= 8) return "〜8時";
  if (h <= 11) return "9〜11時";
  if (h <= 16) return "12〜16時";
  if (h <= 20) return "17〜20時";
  return "21時〜";
}

/** 利用開始日のJST曜日と祝日Setで平日/土日祝を判定する（holidays.ts の isHolidayDate と同じ基準） */
export function dayTypeOf(startAt: string, holidaySet: ReadonlySet<string>): DayType {
  const date = jstDateOf(startAt);
  const dow = jstDayOfWeek(date);
  return dow === 0 || dow === 6 || holidaySet.has(date) ? "土日祝" : "平日";
}

export function purposeBucket(purpose: string | null | undefined): PurposeBucket {
  const { category, detail } = parsePurpose(purpose);
  if (category) return category;
  return detail ? "自由記述のみ" : "未記入";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 'YYYY-MM-DD' 同士の日数差（b - a） */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}

function buildSegmentStats(
  rows: InsightBooking[],
  totalBookings: number,
  holidaySet: ReadonlySet<string>
): SegmentStats {
  const leadTime = zeroCounts(LEAD_TIME_BUCKETS);
  const dayType = zeroCounts(DAY_TYPES);
  const startHour = zeroCounts(START_HOUR_BUCKETS);
  const purpose = zeroCounts<PurposeBucket>(PURPOSE_BUCKETS);
  const venueCounts = new Map<string, number>();
  let revenue = 0;
  let hours = 0;
  let partySum = 0;
  let partyN = 0;
  let members = 0;
  let corporate = 0;

  for (const b of rows) {
    revenue += b.revenue;
    hours += (Date.parse(b.end_at) - Date.parse(b.start_at)) / 3600000;
    if (b.party_size != null) {
      partySum += b.party_size;
      partyN++;
    }
    if (b.user_id != null) members++;
    if (b.customer_type === "corporate") corporate++;
    leadTime[leadTimeBucket(b.created_at, b.start_at)]++;
    dayType[dayTypeOf(b.start_at, holidaySet)]++;
    startHour[startHourBucket(b.start_at)]++;
    purpose[purposeBucket(b.purpose)]++;
    const venue = b.venue_name || "(不明)";
    venueCounts.set(venue, (venueCounts.get(venue) ?? 0) + 1);
  }

  const n = rows.length;
  return {
    bookings: n,
    share: totalBookings ? n / totalBookings : 0,
    revenue,
    avgRevenue: n ? revenue / n : 0,
    avgPartySize: partyN ? partySum / partyN : null,
    partySizeN: partyN,
    avgHours: n ? hours / n : null,
    members,
    corporate,
    leadTime,
    dayType,
    startHour,
    purpose,
    venues: [...venueCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/**
 * 確定予約から「初回」と「リピート」の特徴を集計する。
 * @param rows 確定予約（キャンセル・未決済は呼び出し側で除いておく）
 * @param opts.excludedEmails 集計から除く社内メール（parseEmailList の結果など）
 * @param opts.holidaySet 祝日（JSTの 'YYYY-MM-DD'）。未指定なら土日のみで判定
 */
export function computeCustomerInsights(
  rows: InsightBooking[],
  opts: { excludedEmails?: ReadonlySet<string>; holidaySet?: ReadonlySet<string> } = {}
): CustomerInsights {
  const excludedEmails = new Set([...(opts.excludedEmails ?? [])].map(normalizeEmail));
  const holidaySet = opts.holidaySet ?? new Set<string>();

  // ── 除外（社内メール → テスト目的の順に判定し、重複して数えない） ──
  let internalEmail = 0;
  let testPurpose = 0;
  const included: InsightBooking[] = [];
  for (const b of rows) {
    if (excludedEmails.has(normalizeEmail(b.customer_email))) {
      internalEmail++;
    } else if (isTestPurpose(b.purpose)) {
      testPurpose++;
    } else {
      included.push(b);
    }
  }

  // ── 顧客ごとに申込日時順へ並べて初回/リピートを振り分ける ──
  const byCustomer = new Map<string, InsightBooking[]>();
  for (const b of included) {
    const key = normalizeEmail(b.customer_email);
    const list = byCustomer.get(key) ?? [];
    list.push(b);
    byCustomer.set(key, list);
  }

  const first: InsightBooking[] = [];
  const repeat: InsightBooking[] = [];
  let repeaters = 0;
  const daysToSecond: number[] = [];
  for (const list of byCustomer.values()) {
    // 同時刻の予約は利用開始順（決定的な並びにするため）。表記ゆれ（Z / +00:00 等）に備えて数値で比較
    list.sort(
      (a, b) =>
        Date.parse(a.created_at) - Date.parse(b.created_at) ||
        Date.parse(a.start_at) - Date.parse(b.start_at)
    );
    first.push(list[0]);
    repeat.push(...list.slice(1));

    const dates = [...new Set(list.map((b) => jstDateOf(b.start_at)))].sort();
    if (dates.length >= 2) {
      repeaters++;
      daysToSecond.push(daysBetween(dates[0], dates[1]));
    }
  }

  const totalBookings = included.length;
  const unique = byCustomer.size;
  return {
    totalBookings,
    excluded: { total: internalEmail + testPurpose, internalEmail, testPurpose },
    segments: {
      初回: buildSegmentStats(first, totalBookings, holidaySet),
      リピート: buildSegmentStats(repeat, totalBookings, holidaySet),
    },
    customers: {
      unique,
      repeaters,
      repeatRate: unique ? repeaters / unique : null,
      medianDaysToSecondVisit: median(daysToSecond),
    },
  };
}
