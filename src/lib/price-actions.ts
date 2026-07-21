import { getDb } from "./supabase";
import { getHolidaySet, isHolidayDate } from "./holidays";
import { jstToUtc } from "./slots";

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

/**
 * 価格施策のガードレール検証。
 * - 土日祝は対象外（値下げは平日のみ、というオーナー方針を強制）
 * - 拠点別の下限価格を下回れない
 * - is_holdout=true（比較用に価格を据え置く指示）は下限チェックの対象外（値下げしない指示のため）
 */
export async function validatePriceAction(input: PriceActionInput): Promise<ValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.venueSlug || !(input.venueSlug in VENUE_PRICING_POLICY)) {
    errors.push("拠点が価格施策の対象外です（設定を確認してください）");
    return { blocked: true, errors, warnings };
  }
  if (input.endHour <= input.startHour) {
    errors.push("終了時刻は開始時刻より後にしてください");
  }
  if (input.plannedPrice < 0) {
    errors.push("価格は0円以上にしてください");
  }

  const holidaySet = await getHolidaySet([input.targetDate]);
  if (isHolidayDate(input.targetDate, holidaySet)) {
    errors.push("土日祝は値下げ対象外です（オーナー方針）");
  }

  const policy = VENUE_PRICING_POLICY[input.venueSlug];
  if (!input.isHoldout && policy && input.plannedPrice < policy.floorPrice) {
    errors.push(
      `${policy.label}の下限価格は${policy.floorPrice}円/hです（指定: ${input.plannedPrice}円/h）`
    );
  }
  if (policy?.requiresIsolatedSlot && !input.isHoldout) {
    warnings.push(
      `${policy.label}は人気拠点のため、曜日全体ではなく「既存予約に挟まれた孤立1時間枠」のみに値下げを絞ってください`
    );
  }

  return { blocked: errors.length > 0, errors, warnings };
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

/** 価格施策の実施結果を記録する（スタッフが実際に設定した後の更新） */
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
  const { error } = await db
    .from("price_actions")
    .update({
      status: input.status,
      applied_price: input.appliedPrice,
      applied_by: input.appliedBy,
      applied_at: new Date().toISOString(),
      result_note: input.resultNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw new Error(`価格施策の更新に失敗しました: ${error.message}`);
}

/**
 * 上野系（孤立1時間枠ルールの拠点）で、指定枠が本当に「予約と予約に挟まれた孤立1時間」かを判定する。
 * 定義: 対象枠の開始時刻ちょうどに終わる確定予約と、終了時刻ちょうどに始まる確定予約が同日に両方存在すること。
 * 参考情報であり、これ自体は保存をブロックしない（スタッフ・オーナーの目視確認を優先する）。
 */
export async function checkIsolatedGap(
  venueId: string,
  targetDate: string,
  startHour: number,
  endHour: number
): Promise<boolean> {
  const db = getDb();
  const dayStart = jstToUtc(targetDate, 0);
  const dayEnd = jstToUtc(targetDate, 24);
  const { data, error } = await db
    .from("bookings")
    .select("start_at, end_at")
    .eq("venue_id", venueId)
    .eq("booking_status", "confirmed")
    .gte("start_at", dayStart.toISOString())
    .lt("start_at", dayEnd.toISOString());
  if (error || !data) return false;

  const targetStart = jstToUtc(targetDate, startHour).getTime();
  const targetEnd = jstToUtc(targetDate, endHour).getTime();
  const hasBefore = data.some((b) => new Date(b.end_at).getTime() === targetStart);
  const hasAfter = data.some((b) => new Date(b.start_at).getTime() === targetEnd);
  return hasBefore && hasAfter;
}

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
