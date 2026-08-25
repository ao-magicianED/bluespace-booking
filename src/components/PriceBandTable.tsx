import type { PriceBand } from "@/lib/pricing";

/**
 * 時間帯別料金の帯表（サーバー/クライアント両用の純粋表示コンポーネント）。
 * 平日と土日祝の帯境界が同じなら1つの表に、違うなら日種ごとに分けて表示する。
 * R9: 取消線・「通常価格」・%OFF等の比較表現は絶対に併記しない（単独価格表示のみ）。
 */

const fmtHour = (h: number): string => {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return mm === 0 ? `${hh}:00` : `${hh}:${String(mm).padStart(2, "0")}`;
};

function sorted(bands: PriceBand[]): PriceBand[] {
  return [...bands].sort((a, b) => a.startHour - b.startHour);
}

function sameBoundaries(a: PriceBand[], b: PriceBand[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((band, i) => band.startHour === b[i].startHour && band.endHour === b[i].endHour);
}

export default function PriceBandTable({
  weekday,
  holiday,
}: {
  weekday: PriceBand[];
  holiday: PriceBand[];
}) {
  const wk = sorted(weekday);
  const hd = sorted(holiday);

  if (sameBoundaries(wk, hd)) {
    return (
      <table className="legal-table band-price-table">
        <thead>
          <tr>
            <th>時間帯</th>
            <th>平日</th>
            <th>土日祝</th>
          </tr>
        </thead>
        <tbody>
          {wk.map((b, i) => (
            <tr key={b.startHour}>
              <td>
                {fmtHour(b.startHour)}〜{fmtHour(b.endHour)}
              </td>
              <td>¥{b.hourlyPrice.toLocaleString()}/h</td>
              <td>¥{hd[i].hourlyPrice.toLocaleString()}/h</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  return (
    <>
      {[
        { label: "平日", bands: wk },
        { label: "土日祝", bands: hd },
      ].map(({ label, bands }) => (
        <table className="legal-table band-price-table" key={label}>
          <thead>
            <tr>
              <th>{label}</th>
              <th>料金</th>
            </tr>
          </thead>
          <tbody>
            {bands.map((b) => (
              <tr key={b.startHour}>
                <td>
                  {fmtHour(b.startHour)}〜{fmtHour(b.endHour)}
                </td>
                <td>¥{b.hourlyPrice.toLocaleString()}/h</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </>
  );
}
