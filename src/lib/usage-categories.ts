/**
 * ご利用目的のカテゴリ（予約フォームの選択肢・管理画面の分析の集計軸）。
 * 純粋関数のみ。クライアントコンポーネント（BookingGrid）からもimportされるため、
 * DBアクセスやサーバー専用モジュールを置かないこと。
 *
 * 保存先は既存の bookings.purpose（text列・マイグレーション不要）。形式:
 *   "[カテゴリ] 詳細"  … 詳細が空なら "[カテゴリ]"
 *   "詳細"            … カテゴリ未選択（旧来の自由記述と同じ形）
 * 先頭の[...]が USAGE_CATEGORIES に無いラベルなら、カテゴリなし（全体を詳細）として扱う。
 */

/** 表示順どおりのカテゴリ一覧（ラベルを変えると過去データの集計が分かれるので注意） */
export const USAGE_CATEGORIES = [
  "会議・打ち合わせ",
  "商談・面接",
  "セミナー・研修・勉強会",
  "ダンス・ヨガ・トレーニング",
  "演劇・音楽の練習",
  "撮影・配信",
  "テレワーク・作業・自習",
  "パーティー・懇親会",
  "ボードゲーム・上映会・趣味",
  "美容・サロン・施術",
  "教室・レッスン・ワークショップ",
  "控室・荷物置き・イベント準備",
  "その他",
] as const;

export type UsageCategory = (typeof USAGE_CATEGORIES)[number];

/** bookings.purpose の最大長（/api/checkout の slice(0, 500) と同じ値） */
export const PURPOSE_MAX_LENGTH = 500;

const CATEGORY_SET: ReadonlySet<string> = new Set(USAGE_CATEGORIES);

export function isUsageCategory(v: unknown): v is UsageCategory {
  return typeof v === "string" && CATEGORY_SET.has(v);
}

/** 最大長で切り詰める（末尾にサロゲートペアの片割れが残らないようにする） */
function clampLength(s: string): string {
  if (s.length <= PURPOSE_MAX_LENGTH) return s;
  const cut = s.slice(0, PURPOSE_MAX_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * カテゴリと詳細から保存用の文字列を組み立てる。
 * 前後の空白（全角スペース含む）は除去し、全体を PURPOSE_MAX_LENGTH 文字以内に収める。
 * カテゴリがnull（未選択）なら詳細だけを返す（旧来の自由記述と同じ形）。
 */
export function formatPurpose(category: UsageCategory | null, detail: string): string {
  const d = (detail ?? "").trim();
  if (!isUsageCategory(category)) return clampLength(d);
  return clampLength(d ? `[${category}] ${d}` : `[${category}]`);
}

/** 先頭の [ラベル] と残り（区切りの空白は半角・全角とも許容）。全角の［］も受け付ける */
const PREFIX_RE = /^[[［]\s*([^\]］]*?)\s*[\]］]\s*([\s\S]*)$/;

/**
 * 保存済みの purpose をカテゴリと詳細に分解する。
 * - "[会議・打ち合わせ] 定例" → { category: "会議・打ち合わせ", detail: "定例" }
 * - 旧来の自由記述・未知のラベル → { category: null, detail: 全体（trim済み） }
 * - 空・null → { category: null, detail: "" }
 */
export function parsePurpose(
  purpose: string | null | undefined
): { category: UsageCategory | null; detail: string } {
  const s = (purpose ?? "").trim();
  const m = PREFIX_RE.exec(s);
  if (m && isUsageCategory(m[1])) {
    return { category: m[1], detail: m[2].trim() };
  }
  return { category: null, detail: s };
}
