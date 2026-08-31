/**
 * 用途カテゴリ正規化(docs/media-disclosure-strategy.md 付録B準拠)。
 *
 * `bookings.purpose`(自社サイト、自由記述)と`external_bookings.purpose`(外部モール、
 * 各モールの選択式ドロップダウン値。実データ確認の結果、自由記述ではなくカテゴリ的な
 * 固定値だった)の両方を、公開レポート向けの7分類に丸める。
 *
 * 実データ監査(docs/purpose-category-audit.md)で判明した通り、付録Bの7分類だけでは
 * 「作業・テレワーク」等の単独利用が拾えず、その他・未分類に集中する。無理な按分はせず、
 * 該当なしは全てその他・未分類に置く(付録Bの方針どおり)。
 */

export const PURPOSE_CATEGORIES = [
  "会議・打ち合わせ",
  "セミナー・勉強会",
  "パーティー・懇親会",
  "レッスン・教室",
  "撮影・収録",
  "ボードゲーム会",
  "その他・未分類",
] as const;

export type PurposeCategory = (typeof PURPOSE_CATEGORIES)[number];

/**
 * 外部モールの選択式`purpose`値 → 7分類への直接マッピング。
 * 実データで観測された値のみを列挙する(docs/purpose-category-audit.md参照)。
 * 未知の値はキーワード推定(categorizePurpose)にフォールバックする。
 */
const EXTERNAL_VALUE_MAP: Record<string, PurposeCategory> = {
  "会議・打ち合わせ": "会議・打ち合わせ",
  "会議・商談": "会議・打ち合わせ",
  商談: "会議・打ち合わせ",
  "面接・面談": "会議・打ち合わせ",
  "インタビュー・取材": "会議・打ち合わせ",
  "勉強会・セミナー": "セミナー・勉強会",
  "セミナー・研修": "セミナー・勉強会",
  研修: "セミナー・勉強会",
  オンラインセミナー: "セミナー・勉強会",
  "資格・試験対策教室": "セミナー・勉強会",
  "歓迎会・送別会": "パーティー・懇親会",
  "交流会・ミートアップ": "パーティー・懇親会",
  おしゃべり会: "パーティー・懇親会",
  "その他のパーティー・飲み会": "パーティー・懇親会",
  ワークショップ: "レッスン・教室",
  "その他のレッスン・講座": "レッスン・教室",
  ダンス: "レッスン・教室",
  稽古: "レッスン・教室",
  "演劇・芝居": "レッスン・教室",
  トレーニング: "レッスン・教室",
  美容レッスン: "レッスン・教室",
  "その他の美容・セラピー": "レッスン・教室",
  "マッサージ・施術": "レッスン・教室",
  整体: "レッスン・教室",
  動画撮影: "撮影・収録",
  "写真・ロケ撮影": "撮影・収録",
  動画配信: "撮影・収録",
  ボードゲーム: "ボードゲーム会",
  ゲーム: "ボードゲーム会",
  // 「作業・テレワーク」系は付録Bの7分類に該当がないため、按分せずその他・未分類に置く。
  作業: "その他・未分類",
  テレワーク: "その他・未分類",
  デスクワーク: "その他・未分類",
  その他: "その他・未分類",
  "その他の趣味・遊び": "その他・未分類",
  "その他のビジネス": "その他・未分類",
  映画鑑賞: "その他・未分類",
  スポーツ観戦: "その他・未分類",
  メイク: "その他・未分類",
};

/** 自社サイト(自由記述)向けのキーワード推定(付録Bのキーワード例に準拠)。 */
const KEYWORD_RULES: Array<{ category: PurposeCategory; keywords: string[] }> = [
  { category: "会議・打ち合わせ", keywords: ["会議", "打ち合わせ", "打合せ", "mtg", "商談", "面談", "面接"] },
  { category: "セミナー・勉強会", keywords: ["セミナー", "勉強会", "講座", "研修", "説明会"] },
  { category: "パーティー・懇親会", keywords: ["パーティー", "パーティ", "懇親会", "飲み会", "誕生日", "歓迎会", "送別会"] },
  { category: "レッスン・教室", keywords: ["レッスン", "教室", "ワークショップ", "ダンス", "稽古", "演技", "演劇"] },
  { category: "撮影・収録", keywords: ["撮影", "収録", "mv", "動画"] },
  { category: "ボードゲーム会", keywords: ["ボドゲ", "ボードゲーム"] },
];

/**
 * 任意の`purpose`文字列を7分類のいずれかに丸める。
 * 1. 外部モールの既知の固定値なら直接マッピング
 * 2. それ以外(自社サイトの自由記述、または未知の値)はキーワード推定
 * 3. 空文字・null・未一致は「その他・未分類」
 */
export function categorizePurpose(purpose: string | null | undefined): PurposeCategory {
  const text = (purpose ?? "").trim();
  if (!text) return "その他・未分類";

  const direct = EXTERNAL_VALUE_MAP[text];
  if (direct) return direct;

  const lower = text.toLowerCase();
  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return rule.category;
    }
  }
  return "その他・未分類";
}

/** `purpose`値の配列をカテゴリ別件数に集計する。 */
export function summarizePurposeCategories(
  purposes: Array<string | null | undefined>
): Record<PurposeCategory, number> {
  const counts = Object.fromEntries(PURPOSE_CATEGORIES.map((c) => [c, 0])) as Record<
    PurposeCategory,
    number
  >;
  for (const p of purposes) {
    counts[categorizePurpose(p)] += 1;
  }
  return counts;
}
