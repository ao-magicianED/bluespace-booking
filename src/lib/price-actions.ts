import { getDb } from "./supabase";
import { getHolidaySetStrict, isHolidayDate } from "./holidays";
import { isValidDateStr } from "./slots";

/**
 * 価格施策の台帳（STEP 0）。
 * 2026-07-19のCSV分析（インスタベース・スペースマーケット・UPNOW）を受けて、
 * 「週次の価格指示 → スタッフが設定 → 効果測定 → 翌週の指示」ループを回すための記録基盤。
 * 拠点別の下限価格・土日祝除外はオーナー方針（メモリ project_pricing-optimization 参照）どおりコードで強制する。
 */

export type Channel = "instabase" | "spacemarket" | "upnow" | "own";
export type PriceActionStatus = "draft" | "applied" | "reverted" | "expired";

export type PriceAction = {
  id: string;
  venue_id: string;
  target_date: string;
  start_hour: number;
  end_hour: number;
  channel: Channel;
  previous_price: number | null;
  planned_price: number;
  is_holdout: boolean;
  reason: string;
  status: PriceActionStatus;
  applied_price: number | null;
  applied_at: string | null;
  applied_by: string | null;
  result_note: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * 拠点別の下限価格（ゲスト表示価格・円/h）。2026-07-19のオーナー方針に基づく。
 * requiresIsolatedSlot=true の拠点（上野3拠点）は人気拠点のため、曜日単位の値下げは禁止で
 * 「既存予約に挟まれた孤立1時間枠」のみ対象という運用ルール（コードでは警告のみ、強制はしない）。
 */
export const VENUE_PRICING_POLICY: Record<
  string,
  { floorPrice: number; requiresIsolatedSlot: boolean; label: string }
> = {
  "shirokane-takanawa": { floorPrice: 700, requiresIsolatedSlot: false, label: "白金高輪" },
  kanda: { floorPrice: 800, requiresIsolatedSlot: false, label: "神田" },
  "nishi-shinjuku": { floorPrice: 500, requiresIsolatedSlot: false, label: "西新宿403" },
  "ueno-okachimachi": { floorPrice: 1000, requiresIsolatedSlot: true, label: "上野御徒町" },
  "ueno-4a": { floorPrice: 1000, requiresIsolatedSlot: true, label: "上野駅前4A" },
  "ueno-4b": { floorPrice: 1000, requiresIsolatedSlot: true, label: "上野駅前4B" },
  "keisei-koiwa": { floorPrice: 1000, requiresIsolatedSlot: false, label: "京成小岩" },
};

/** 価格ラダー: 1週目15%引き→2週目25%引き→3週目は拠点の下限価格まで */
export const PRICE_LADDER_STEPS = [0.15, 0.25] as const;

/** ラダーのn段階目の価格（0=1週目, 1=2週目, 2以降=下限）。基準価格(掲載価格)から計算し、下限を下回らない */
export function ladderPrice(referencePrice: number, step: number, floorPrice: number): number {
  if (step < 0) return referencePrice;
  const discount = PRICE_LADDER_STEPS[step];
  if (discount == null) return floorPrice;
  return Math.max(floorPrice, Math.round((referencePrice * (1 - discount)) / 10) * 10);
}

export type PriceActionInput = {
  venueSlug: string;
  targetDate: string;
  startHour: number;
  endHour: number;
  channel: Channel;
  previousPrice: number | null;
  plannedPrice: number;
  isHoldout: boolean;
  reason: string;
};

export type ValidationResult = {
  /** trueなら保存不可（ガードレール違反） */
  blocked: boolean;
  errors: string[];
  /** 保存はできるが確認を促す注意（例: 上野系の孤立枠ルール） */
  warnings: string[];
};

/** 0.5刻みの有効な時刻値かチェック */
function isHalfHourGrid(v: number): boolean {
  return Number.isFinite(v) && (v * 2) % 1 === 0;
}

/**
 * 価格施策のガードレール検証（祝日Setを引数に取る純粋部分。単体テストはこちらを対象にする）。
 * - 土日祝は対象外（値下げは平日のみ、というオーナー方針を強制）
 * - 拠点別の下限価格を下回れない。保護枠（is_holdout=true）も対象:
 *   保護枠の正しい入力は「現在の掲載価格（定価）」で、全拠点の定価は下限以上のため正当な入力は必ず通る。
 *   下限未満を許すと、効果測定の対照群データに0円などのゴミが混ざる
 * - 時刻は0〜24の0.5刻み（予約システムのスロット粒度と一致させる）
 */
export function validatePriceActionWithHolidays(
  input: PriceActionInput,
  holidaySet: Set<string>
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.venueSlug || !(input.venueSlug in VENUE_PRICING_POLICY)) {
    errors.push("拠点が価格施策の対象外です（設定を確認してください）");
    return { blocked: true, errors, warnings };
  }
  if (!isValidDateStr(input.targetDate)) {
    errors.push("対象日の形式が正しくありません");
    return { blocked: true, errors, warnings };
  }
  if (
    !isHalfHourGrid(input.startHour) ||
    !isHalfHourGrid(input.endHour) ||
    input.startHour < 0 ||
    input.endHour > 24
  ) {
    errors.push("時刻は0〜24時の30分刻みで指定してください");
  }
  if (input.endHour <= input.startHour) {
    errors.push("終了時刻は開始時刻より後にしてください");
  }
  if (!Number.isInteger(input.plannedPrice) || input.plannedPrice < 0) {
    errors.push("価格は0円以上の整数で指定してください");
  }

  if (isHolidayDate(input.targetDate, holidaySet)) {
    errors.push("土日祝は値下げ対象外です（オーナー方針）");
  }

  const policy = VENUE_PRICING_POLICY[input.venueSlug];
  if (policy && input.plannedPrice < policy.floorPrice) {
    errors.push(
      input.isHoldout
        ? `保護枠には現在の掲載価格（定価）を入力してください（${policy.label}の下限${policy.floorPrice}円/h以上）`
        : `${policy.label}の下限価格は${policy.floorPrice}円/hです（指定: ${input.plannedPrice}円/h）`
    );
  }
  if (policy?.requiresIsolatedSlot && !input.isHoldout) {
    warnings.push(
      `${policy.label}は人気拠点のため、曜日全体ではなく「既存予約に挟まれた孤立1時間枠」のみに値下げを絞ってください`
    );
  }

  return { blocked: errors.length > 0, errors, warnings };
}

/**
 * 価格施策のガードレール検証（DBの祝日データを参照する外側）。
 * 祝日データが取得できない・対象年が未登録のときはfail-closed（保存をブロック）にする。
 * 「土日祝の値下げ指示が保存できたら重大バグ」というオーナー方針のため、安全側に倒す。
 */
export async function validatePriceAction(input: PriceActionInput): Promise<ValidationResult> {
  let holidaySet: Set<string>;
  try {
    holidaySet = await getHolidaySetStrict([input.targetDate]);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      blocked: true,
      errors: [`祝日データを確認できないため保存できません（${detail}）。時間をおいて再試行してください`],
      warnings: [],
    };
  }
  return validatePriceActionWithHolidays(input, holidaySet);
}

/** 価格施策を作成する（作成前に validatePriceAction を必ず呼ぶこと） */
export async function createPriceAction(
  input: PriceActionInput & { venueId: string }
): Promise<PriceAction> {
  const db = getDb();
  const { data, error } = await db
    .from("price_actions")
    .insert({
      venue_id: input.venueId,
      target_date: input.targetDate,
      start_hour: input.startHour,
      end_hour: input.endHour,
      channel: input.channel,
      previous_price: input.previousPrice,
      planned_price: input.plannedPrice,
      is_holdout: input.isHoldout,
      reason: input.reason,
    })
    .select()
    .single();
  if (error) throw new Error(`価格施策の作成に失敗しました: ${error.message}`);
  return data as PriceAction;
}

/**
 * 価格施策の実施結果を記録する（スタッフが実際に設定した後の更新）。
 * applied_price/applied_at/applied_byは「実際に設定した」記録なので status=applied のときだけ入れる。
 * reverted（定価に戻した）・expired（未実施のまま終了）で実施日時を刻印すると台帳の意味が濁るため。
 */
export async function recordPriceActionResult(
  id: string,
  input: {
    status: PriceActionStatus;
    appliedPrice: number | null;
    appliedBy: string;
    resultNote: string | null;
  }
): Promise<void> {
  const db = getDb();
  const isApplied = input.status === "applied";
  const { data, error } = await db
    .from("price_actions")
    .update({
      status: input.status,
      applied_price: isApplied ? input.appliedPrice : null,
      applied_by: isApplied ? input.appliedBy : null,
      applied_at: isApplied ? new Date().toISOString() : null,
      result_note: input.resultNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`価格施策の更新に失敗しました: ${error.message}`);
  if (!data || data.length === 0) throw new Error("対象の価格施策が見つかりません");
}

// 補足: 上野系の「孤立1時間枠」の自動判定は、自社予約だけでなくGoogleカレンダーのbusy
// （外部モール予約が大半）を見ないと実運用で機能しないため、STEP 1（効果測定ループ）で
// getBusyRanges併用の形で実装する。STEP 0では管理画面の注意書きテキストで運用カバーする。

export type PriceActionListFilter = {
  venueId?: string;
  status?: PriceActionStatus;
  fromDate?: string;
  toDate?: string;
};

export async function listPriceActions(
  filter: PriceActionListFilter = {}
): Promise<(PriceAction & { venues: { name: string; slug: string } | null })[]> {
  const db = getDb();
  let query = db
    .from("price_actions")
    .select("*, venues(name, slug)")
    .order("target_date", { ascending: false })
    .limit(200);
  if (filter.venueId) query = query.eq("venue_id", filter.venueId);
  if (filter.status) query = query.eq("status", filter.status);
  if (filter.fromDate) query = query.gte("target_date", filter.fromDate);
  if (filter.toDate) query = query.lte("target_date", filter.toDate);
  const { data, error } = await query;
  if (error) throw new Error(`価格施策の取得に失敗しました: ${error.message}`);
  return data as (PriceAction & { venues: { name: string; slug: string } | null })[];
}
