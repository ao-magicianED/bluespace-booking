import type { VenueContent } from "@/content/venues";
import type { PriceBand } from "@/lib/pricing";
import type { Venue } from "@/lib/types";
import { describePolicy } from "@/lib/cancellation";
import { describeHourlyPrice, describeOpeningHours, formatHours, isStandardAmenity } from "@/lib/venue-facts";

/**
 * 「スペース基本情報」表（サーバーコンポーネント）。
 * 定員・広さ・料金・予約条件などの要点を1つの表にまとめ、利用者が比較しやすく、
 * 検索エンジンやAIも要点を抜き出しやすい形にする。値はすべて既存の拠点コンテンツ・DB・
 * 予約システムの仕様から作り、この表のためだけの手書きの事実は持たない。
 */
export default function VenueFacts({
  venue,
  content,
  pricing,
}: {
  venue: Venue;
  content: VenueContent;
  /** 表示中のティアの帯（帯なし拠点は null → venues の平日/土日祝価格） */
  pricing: { weekday: PriceBand[]; holiday: PriceBand[] } | null;
}) {
  const access = content.accessRows.filter((r) => r.label !== "住所");
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: "所在地", value: `〒${content.postalCode} ${content.address}` },
    {
      label: "アクセス",
      value: access.map((r, i) => (
        <span key={r.label}>
          {i > 0 && <br />}
          {r.main} {r.sub}
        </span>
      )),
    },
    { label: "定員・広さ", value: content.capacityShort },
    { label: "料金（1時間・税込）", value: describeHourlyPrice(pricing, venue) },
    {
      label: "予約単位",
      value: `30分単位（最短${formatHours(Number(venue.min_hours))}・最長${formatHours(Number(venue.max_hours))}）`,
    },
    { label: "営業時間", value: `${describeOpeningHours(venue.open_hour, venue.close_hour)}・無人運営` },
    { label: "予約の受付", value: "空きがあれば利用開始の直前まで（60日先まで予約可）" },
    {
      label: "お支払い",
      value:
        "クレジットカード（Visa・Mastercard・JCB・AMEX等）。法人は利用日時の3日前までのご予約で請求書払い（銀行振込）も選べます",
    },
    { label: "キャンセル", value: describePolicy(venue.cancellation_policy ?? null).join(" ／ ") },
    { label: "飲食", value: "持ち込み可" },
    {
      // オプション（有料）・持ち込み前提の設備は備え付けと誤解されないよう「主な設備」には載せない
      label: "主な設備",
      value: content.amenities.filter(isStandardAmenity).slice(0, 6).map((a) => a.label).join("・"),
    },
    { label: "入室方法", value: "予約確定メールでご案内（スタッフの立ち会いなし）" },
  ];

  return (
    <section className="venue-section" id="facts">
      <h2>スペース基本情報</h2>
      <table className="legal-table venue-facts-table">
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{r.label}</th>
              <td>{r.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
