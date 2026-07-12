import { getDb } from "./supabase";
import type { DailySnapshot } from "./occupancy-report";

/**
 * 稼働状況の日次スナップショットをDBに保存する（直近数日分、拠点別）。
 * 同じ(date, venue_id)なら上書き（cronの再実行や、数日分をまたいだ再計算でも重複しない）。
 * 蓄積後は季節変動・値下げ施策の効果測定・拠点間比較などの分析に使う。
 */
export async function saveDailySnapshots(snapshots: DailySnapshot[]): Promise<void> {
  if (snapshots.length === 0) return;
  const db = getDb();
  const updatedAt = new Date().toISOString();
  const rows = snapshots.map((s) => ({
    date: s.date,
    venue_id: s.venueId,
    own_busy_hours: s.ownBusyHours,
    combined_busy_hours: s.combinedBusyHours,
    capacity_hours: s.capacityHours,
    updated_at: updatedAt,
  }));
  const { error } = await db
    .from("occupancy_daily_snapshots")
    .upsert(rows, { onConflict: "date,venue_id" });
  if (error) throw new Error(`稼働スナップショット保存エラー: ${error.message}`);
}
