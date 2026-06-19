"use client";

import { useMemo, useState } from "react";

export type MonthlyData = {
  /** 'YYYY/MM' */
  month: string;
  /** 拠点別の集計（venue名 → {件数, 売上}） */
  byVenue: Record<string, { count: number; sales: number }>;
};

type Props = {
  /** 古い月→新しい月の順 */
  months: MonthlyData[];
  /** 拠点名の一覧（プルダウン用） */
  venues: string[];
};

const ALL = "(全体)";

/**
 * 月別予約数・売上のシンプルなSVGバーチャート。
 * 全体 / 拠点別 切替、件数 / 売上 切替の2軸トグルつき。
 */
export default function MonthlyChart({ months, venues }: Props) {
  const [venue, setVenue] = useState<string>(ALL);
  const [metric, setMetric] = useState<"count" | "sales">("count");

  const series = useMemo(() => {
    return months.map((m) => {
      if (venue === ALL) {
        const agg = Object.values(m.byVenue).reduce(
          (s, v) => ({ count: s.count + v.count, sales: s.sales + v.sales }),
          { count: 0, sales: 0 }
        );
        return { month: m.month, ...agg };
      }
      const v = m.byVenue[venue] ?? { count: 0, sales: 0 };
      return { month: m.month, count: v.count, sales: v.sales };
    });
  }, [months, venue]);

  const max = Math.max(1, ...series.map((s) => (metric === "count" ? s.count : s.sales)));
  const totalCount = series.reduce((s, x) => s + x.count, 0);
  const totalSales = series.reduce((s, x) => s + x.sales, 0);

  return (
    <div className="monthly-chart">
      <div className="monthly-chart-toolbar">
        <label>
          表示
          <select value={venue} onChange={(e) => setVenue(e.target.value)}>
            <option value={ALL}>{ALL}</option>
            {venues.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="metric-toggle">
          <button
            className={metric === "count" ? "active" : ""}
            onClick={() => setMetric("count")}
            type="button"
          >
            予約数
          </button>
          <button
            className={metric === "sales" ? "active" : ""}
            onClick={() => setMetric("sales")}
            type="button"
          >
            売上
          </button>
        </div>
        <div className="monthly-chart-totals">
          <span>
            合計予約数: <strong>{totalCount}件</strong>
          </span>
          <span>
            合計売上: <strong>¥{totalSales.toLocaleString()}</strong>
          </span>
        </div>
      </div>

      <div className="monthly-chart-bars">
        {series.map((s) => {
          const value = metric === "count" ? s.count : s.sales;
          const pct = (value / max) * 100;
          return (
            <div key={s.month} className="monthly-chart-bar">
              <div className="bar-value">
                {metric === "count" ? `${s.count}件` : `¥${Math.round(s.sales / 1000)}k`}
              </div>
              <div className="bar-wrap">
                <div className="bar-fill" style={{ height: `${pct}%` }} />
              </div>
              <div className="bar-label">{s.month}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
