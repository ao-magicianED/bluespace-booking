import type { PriceBand } from "./pricing";

/**
 * 拠点の「スペース基本情報」表・比較表で使う表示用の純粋関数。
 * 料金は予約計算と同じ帯データ（resolveDayPricing の結果）から作り、手書きの料金は持たない。
 */

const yen = (n: number): string => `¥${n.toLocaleString()}`;

const fmtHour = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${String(mm).padStart(2, "0")}`;
};

/** 時間数の表示（1 → 1時間 / 1.5 → 1時間30分 / 0.5 → 30分） */
export function formatHours(hours: number): string {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}分`;
  return m === 0 ? `${h}時間` : `${h}時間${m}分`;
}

/**
 * 1日分の帯から「¥最低〜¥最高（最低額の時間帯）」の表記を作る。
 * titleの{price}は最も低い帯（深夜帯）の額のため、AIや利用者が「1時間◯円」と一律の値段だと
 * 受け取らないよう、最低額がどの時間帯の料金かを必ず併記する。
 */
export function describeDayBands(bands: PriceBand[]): string {
  if (bands.length === 0) return "";
  const prices = bands.map((b) => b.hourlyPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) return yen(min);
  const cheapest = [...bands]
    .filter((b) => b.hourlyPrice === min)
    .sort((a, b) => a.startHour - b.startHour)
    .map((b) => `${fmtHour(b.startHour)}〜${fmtHour(b.endHour)}`)
    .join("・");
  return `${yen(min)}〜${yen(max)}（${cheapest}は${yen(min)}）`;
}

/** 平日・土日祝の料金行（帯あり拠点は帯から、帯なし拠点は平日/土日祝の単一価格から作る） */
export function describeHourlyPrice(
  pricing: { weekday: PriceBand[]; holiday: PriceBand[] } | null,
  flat: { hourly_price: number; holiday_hourly_price: number | null }
): string {
  if (pricing) {
    return `平日 ${describeDayBands(pricing.weekday)} ／ 土日祝 ${describeDayBands(pricing.holiday)}`;
  }
  const holiday = flat.holiday_hourly_price ?? flat.hourly_price;
  return holiday === flat.hourly_price
    ? `${yen(flat.hourly_price)}（平日・土日祝とも）`
    : `平日 ${yen(flat.hourly_price)} ／ 土日祝 ${yen(holiday)}`;
}

/**
 * 拠点に常設されている設備か（オプション・有償・持ち込み前提のものは除く）。
 * 「主な設備」や構造化データの amenityFeature（value:true＝備え付けあり）に、
 * 追加料金や持ち込みが必要なものを「備え付け」として載せないために使う。
 */
export function isStandardAmenity(a: { label: string; note: string }): boolean {
  return !/(オプション|有償|持ち込み|持込)/.test(`${a.label} ${a.note}`);
}

/** 営業時間の表記（0〜24時は24時間営業） */
export function describeOpeningHours(openHour: number, closeHour: number): string {
  if (openHour === 0 && closeHour === 24) return "24時間営業（0:00〜24:00）";
  return `${fmtHour(openHour)}〜${fmtHour(closeHour)}`;
}
