import { createHash } from "node:crypto";
import { getDb } from "./supabase";
import { QuoteError } from "./quote";
import { JST_OFFSET_MS } from "./slots";
import {
  bandsCoverFullDay,
  buildBandLines,
  calcBandAmount,
  type DayType,
  type PriceBand,
  type PriceBreakdown,
  type PriceTier,
  type ResolvedPricing,
} from "./pricing";
import { breakdownAfterDayTypeChange, type BandChargeContext, type ChangeDayTypes } from "./change-request";
import type { Booking, Venue } from "./types";

/**
 * 時間帯別料金の解決チェーン（DB層）。純粋な帯計算は pricing.ts 側。
 *
 * resolvePricing(venue, tier, dayType) の解決順:
 *   1)（将来）顧客ごと固定価格 … 別セッションの実装がここに割り込む余地を残す
 *   2) venue_price_bands から (venue_id, day_type) の全帯を取得（両ティア分）
 *   3) その (venue, day_type) に帯が1件も無い → venues.hourly_price /
 *      holiday_hourly_price を 0-24 の単一帯として返す（＝レガシー拠点）
 *   4) 帯がある場合:
 *      - 指定ティアの帯が完全被覆(0-24隙間なし) → それを使う
 *      - repeat指定なのにrepeat帯が無い/不完全 → standard帯へフォールバック（高い方）
 *      - standard帯が不完全（穴がある） → QuoteError(503) で見積・決済を停止
 *
 * 「穴を旧フラット価格で埋める」と、シード失敗・管理ミスのとき高額枠が旧価格で
 * 売れてしまう（fail-cheap）ため、帯を導入した拠点では穴＝設定エラーとして止める。
 * DB読取エラーも同様に停止する（安値で売らない = fail-expensive）。
 */

type BandRow = {
  tier: string;
  start_hour: number;
  end_hour: number;
  hourly_price: number;
};

type FlatPricedVenue = Pick<Venue, "id" | "hourly_price" | "holiday_hourly_price">;

function flatPriceFor(venue: Pick<Venue, "hourly_price" | "holiday_hourly_price">, dayType: DayType): number {
  return dayType === "holiday" && venue.holiday_hourly_price != null
    ? venue.holiday_hourly_price
    : venue.hourly_price;
}

function toBands(rows: BandRow[], tier: PriceTier): PriceBand[] {
  return rows
    .filter((r) => r.tier === tier)
    .map((r) => ({ startHour: r.start_hour, endHour: r.end_hour, hourlyPrice: r.hourly_price }))
    .sort((a, b) => a.startHour - b.startHour);
}

/** 帯セットの識別子。管理画面で価格を変えると自動的に別versionになる */
function bandsVersion(bands: PriceBand[]): string {
  const canonical = JSON.stringify(
    [...bands]
      .sort((a, b) => a.startHour - b.startHour)
      .map((b) => [b.startHour, b.endHour, b.hourlyPrice])
  );
  return `bands:${createHash("sha256").update(canonical).digest("hex").slice(0, 12)}`;
}

const BANDS_BROKEN_ERROR =
  "現在この拠点の料金設定を更新中のため、ご予約を一時停止しています。時間をおいてお試しください";

/**
 * 取得済みの帯行から適用料金を解決する（純粋関数・単体テスト対象）。
 * @throws QuoteError(503) standard帯が存在するのに不完全なとき
 */
export function resolvePricingFromRows(
  rows: BandRow[],
  tier: PriceTier,
  flatPrice: number
): ResolvedPricing {
  if (rows.length === 0) {
    return {
      bands: [{ startHour: 0, endHour: 24, hourlyPrice: flatPrice }],
      source: "flat",
      tierUsed: "standard",
      priceVersion: `flat:${flatPrice}`,
    };
  }

  const standardBands = toBands(rows, "standard");
  if (!bandsCoverFullDay(standardBands)) {
    // 帯が入っているのにstandardが不完全 → 設定エラーとして停止（旧フラットに落とさない）
    throw new QuoteError(BANDS_BROKEN_ERROR, 503);
  }

  if (tier === "repeat") {
    const repeatBands = toBands(rows, "repeat");
    if (bandsCoverFullDay(repeatBands)) {
      return {
        bands: repeatBands,
        source: "bands",
        tierUsed: "repeat",
        priceVersion: bandsVersion(repeatBands),
      };
    }
    // repeat帯が無い/不完全 → standard（高い方）へフォールバック
  }

  return {
    bands: standardBands,
    source: "bands",
    tierUsed: "standard",
    priceVersion: bandsVersion(standardBands),
  };
}

/** 指定拠点・ティア・日種の適用料金をDBから解決する */
export async function resolvePricing(
  venue: FlatPricedVenue,
  tier: PriceTier,
  dayType: DayType
): Promise<ResolvedPricing> {
  const db = getDb();
  const { data, error } = await db
    .from("venue_price_bands")
    .select("tier, start_hour, end_hour, hourly_price")
    .eq("venue_id", venue.id)
    .eq("day_type", dayType);
  if (error) {
    // 読取エラー時にフラットへ落とすと安値で売ってしまうため停止（fail-expensive）
    throw new QuoteError("料金情報の取得に失敗しました。時間をおいてお試しください", 503);
  }
  return resolvePricingFromRows((data ?? []) as BandRow[], tier, flatPriceFor(venue, dayType));
}

export type DayPricing = { weekday: ResolvedPricing; holiday: ResolvedPricing };

/** 平日・土日祝の両方を1クエリで解決する（空き状況・拠点ページの表示用） */
export async function resolveDayPricing(venue: FlatPricedVenue, tier: PriceTier): Promise<DayPricing> {
  const db = getDb();
  const { data, error } = await db
    .from("venue_price_bands")
    .select("tier, day_type, start_hour, end_hour, hourly_price")
    .eq("venue_id", venue.id);
  if (error) {
    throw new QuoteError("料金情報の取得に失敗しました。時間をおいてお試しください", 503);
  }
  const rows = (data ?? []) as (BandRow & { day_type: string })[];
  return {
    weekday: resolvePricingFromRows(
      rows.filter((r) => r.day_type === "weekday"),
      tier,
      flatPriceFor(venue, "weekday")
    ),
    holiday: resolvePricingFromRows(
      rows.filter((r) => r.day_type === "holiday"),
      tier,
      flatPriceFor(venue, "holiday")
    ),
  };
}

/** 複数拠点の適用料金を1クエリでまとめて解決する（トップページの拠点カード用） */
export async function resolveDayPricingBatch(
  venues: FlatPricedVenue[],
  tier: PriceTier
): Promise<Map<string, DayPricing>> {
  const result = new Map<string, DayPricing>();
  if (venues.length === 0) return result;
  const db = getDb();
  const { data, error } = await db
    .from("venue_price_bands")
    .select("venue_id, tier, day_type, start_hour, end_hour, hourly_price")
    .in(
      "venue_id",
      venues.map((v) => v.id)
    );
  if (error) {
    throw new QuoteError("料金情報の取得に失敗しました。時間をおいてお試しください", 503);
  }
  const rows = (data ?? []) as (BandRow & { venue_id: string; day_type: string })[];
  for (const venue of venues) {
    const own = rows.filter((r) => r.venue_id === venue.id);
    result.set(venue.id, {
      weekday: resolvePricingFromRows(
        own.filter((r) => r.day_type === "weekday"),
        tier,
        flatPriceFor(venue, "weekday")
      ),
      holiday: resolvePricingFromRows(
        own.filter((r) => r.day_type === "holiday"),
        tier,
        flatPriceFor(venue, "holiday")
      ),
    });
  }
  return result;
}

// ─── 予約時間変更（v3対応） ─────────────────────────────────────

/** UTC Date → JSTの時刻（小数時。終端0:00は24として返す用の補正は呼び出し側で行う） */
function jstHourOfDay(d: Date): number {
  const j = new Date(d.getTime() + JST_OFFSET_MS);
  return j.getUTCHours() + j.getUTCMinutes() / 60;
}

function jstRangeHours(range: { start: Date; end: Date }): { startHour: number; endHour: number } {
  const startHour = jstHourOfDay(range.start);
  const endRaw = jstHourOfDay(range.end);
  // 同日内利用前提（validateTimeRangeが保証）。終了0:00は同日の24時として扱う
  const endHour = endRaw === 0 ? 24 : endRaw;
  if (endHour <= startHour) {
    // 日またぎの範囲を時刻だけで計算すると空範囲＝基本料金0円になり無料利用・過大返金の
    // 事故になるため、防御的に停止する（入口はvalidateTimeRangeの同日チェックが防ぐ）
    throw new Error(`日をまたぐ時間範囲は帯計算できません (start=${startHour}, end=${endHour})`);
  }
  return { startHour, endHour };
}

/**
 * v3予約（時間帯別料金）の時間変更用に、変更前後の時間比例額を解決する。
 * v2予約（フラット）は null を返し、従来のスナップショット単価ロジックに委ねる。
 *
 * ポリシー: 変更後の時間帯全体を「元予約と同じtier・現在の帯表」で再計算し、
 * 変更前はスナップショット（実際に請求した基本料金）を基準に差額を取る。
 * 帯が変わっていなければ差額は「追加/削除されたスロットの現在価格」に一致する。
 *
 * @throws QuoteError(503) 帯設定が壊れている・DB読取失敗のとき（安値で変更させない）
 */
export async function resolveBandChargeContext(
  booking: Booking,
  venue: Venue,
  next: { start: Date; end: Date },
  dayTypes: ChangeDayTypes
): Promise<BandChargeContext | null> {
  const bd = (booking.price_breakdown ?? null) as Partial<PriceBreakdown> | null;
  if (bd?.rule !== "v3") return null;

  const tier: PriceTier = bd.tier === "repeat" ? "repeat" : "standard";
  const resolved = await resolvePricing(venue, tier, dayTypes.next);
  const { startHour, endHour } = jstRangeHours(next);
  const nextBase = calcBandAmount(resolved.bands, startHour, endHour);
  const prevBase =
    typeof bd.baseSubtotal === "number"
      ? bd.baseSubtotal
      : (bd.bandLines ?? []).reduce((s, l) => s + l.amount, 0);
  return { prevBase, nextBase };
}

/**
 * 時間変更確定時に適用するprice_breakdownスナップショット更新値を作る。
 * 【重要】この関数は「変更申請の作成時点」で呼び、結果を
 * booking_change_requests.new_price_breakdown に保存すること。確定（Webhook/承認）時に
 * 再解決すると、決済待ちの間に帯が変更された場合「請求した額」と「保存される内訳」が
 * 食い違い、次回変更で誤った差額を計算してしまう。
 * - v3予約: 帯構成が変わるため毎回、新しい時間帯の帯内訳で再構築する
 * - v2予約: 従来どおり dayType が変わったときだけ単価区分・単価・日付を更新
 * @returns 更新不要なら null
 */
export async function buildBreakdownAfterChange(
  booking: Booking,
  venue: Venue,
  dayTypes: ChangeDayTypes,
  nextStart: Date,
  nextEnd: Date
): Promise<Record<string, unknown> | null> {
  const bd = (booking.price_breakdown ?? null) as Partial<PriceBreakdown> | null;
  if (bd?.rule !== "v3") {
    return breakdownAfterDayTypeChange(booking, venue, dayTypes, nextStart);
  }

  const tier: PriceTier = bd.tier === "repeat" ? "repeat" : "standard";
  const resolved = await resolvePricing(venue, tier, dayTypes.next);
  const { startHour, endHour } = jstRangeHours({ start: nextStart, end: nextEnd });
  const bandLines = buildBandLines(resolved.bands, startHour, endHour);
  const baseSubtotal = bandLines.reduce((s, l) => s + l.amount, 0);
  const hours = Math.round((endHour - startHour) * 2) / 2;
  const jstDate = new Date(nextStart.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  // per_hourオプションの金額も新しい時間数で再計算する（据え置くと明細の合計が合わなくなる）
  const options = (bd.options ?? []).map((o) =>
    o.priceUnit === "per_hour" && typeof o.unitPrice === "number"
      ? { ...o, amount: Math.round(o.unitPrice * hours) }
      : o
  );
  const optionsSubtotal = options.reduce((s, o) => s + o.amount, 0);
  // totalも内訳整合のため再構成する（割引・クーポン額は原予約時の確定額を据え置き）。
  // 実際の請求額の正は bookings.adjusted_total / realizedRevenue 側であり、これは監査表示用
  const total = Math.max(
    0,
    baseSubtotal - (bd.discount?.amount ?? 0) + optionsSubtotal - (bd.coupon?.amount ?? 0)
  );
  return {
    ...(booking.price_breakdown as Record<string, unknown>),
    dayType: dayTypes.next,
    date: jstDate,
    hours,
    bandLines,
    baseSubtotal,
    options,
    optionsSubtotal,
    total,
    // 互換用の加重平均（表示専用）
    pricePerHour: hours > 0 ? Math.round(baseSubtotal / hours) : 0,
    priceVersion: resolved.priceVersion,
  };
}
