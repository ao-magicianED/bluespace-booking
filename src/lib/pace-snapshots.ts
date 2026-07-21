import { getDb } from "./supabase";
import { getBusyRanges } from "./google-calendar";
import { addDaysJst, jstToUtc, todayJst } from "./slots";
import { dailyOccupancy, mergeRanges } from "./occupancy";
import { fetchVenuesAndOwnBookings } from "./occupancy-report";
import type { TimeRange } from "./types";

/**
 * 予約カーブ（ペーススナップショット）の記録（STEP 0）。
 * occupancy_daily_snapshots（0018）は「過去の実績」を直近数日分だけ再計算して残す設計のため、
 * 「価格を決めた時点で、その先の日がどれだけ埋まっていたか」を後から復元できなかった。
 * このモジュールは向こう PACE_WINDOW_DAYS 日分の埋まり時間を毎日そのままupsertし、
 * captured_on（記録日）を主キーに含めることで過去分を上書きしない。
 * 値下げ施策の効果測定（「値下げ後、その先の埋まり方が上がったか」の比較）に使う。
 */

/** 何日先まで記録するか（週次の価格施策サイクルより十分長く取る） */
export const PACE_WINDOW_DAYS = 35;

export type PaceSnapshotRow = {
  capturedOn: string;
  venueId: string;
  serviceDate: string;
  ownBusyHours: number;
  /** カレンダー取得に失敗した拠点はnull（外部予約分を含まない不完全な値を「正常値」として残さないため） */
  combinedBusyHours: number | null;
  capacityHours: number;
};

/** 全アクティブ拠点の、今日から{@link PACE_WINDOW_DAYS}日分の予約カーブを集計する */
export async function collectPaceSnapshots(now: Date = new Date()): Promise<PaceSnapshotRow[]> {
  const today = todayJst(now);
  const windowEndExclusive = addDaysJst(today, PACE_WINDOW_DAYS);
  const { venues, ownByVenue } = await fetchVenuesAndOwnBookings(today, windowEndExclusive);

  const rows: PaceSnapshotRow[] = [];
  for (const venue of venues) {
    const own = ownByVenue.get(venue.id) ?? [];

    let calendarBusy: TimeRange[] = [];
    let calendarOk = true;
    try {
      calendarBusy = await getBusyRanges(
        venue.calendar_id,
        jstToUtc(today, 0),
        jstToUtc(windowEndExclusive, 0)
      );
    } catch (e) {
      console.error(`[pace-snapshots] FreeBusy取得失敗（${venue.slug}）: 自社予約のみで集計`, e);
      calendarOk = false;
    }
    const ownDays = dailyOccupancy(venue, own, today, PACE_WINDOW_DAYS);
    const combinedDays = calendarOk
      ? dailyOccupancy(venue, mergeRanges([...own, ...calendarBusy]), today, PACE_WINDOW_DAYS)
      : null;

    for (let i = 0; i < ownDays.length; i++) {
      rows.push({
        capturedOn: today,
        venueId: venue.id,
        serviceDate: ownDays[i].date,
        ownBusyHours: ownDays[i].busyHours,
        combinedBusyHours: combinedDays ? combinedDays[i].busyHours : null,
        capacityHours: ownDays[i].capacityHours,
      });
    }
  }
  return rows;
}

/** 予約カーブスナップショットをDBへ保存する。同じ(captured_on, venue_id, service_date)は上書き（cronの再実行に対応） */
export async function savePaceSnapshots(rows: PaceSnapshotRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  const dbRows = rows.map((r) => ({
    captured_on: r.capturedOn,
    venue_id: r.venueId,
    service_date: r.serviceDate,
    own_busy_hours: r.ownBusyHours,
    combined_busy_hours: r.combinedBusyHours,
    capacity_hours: r.capacityHours,
  }));
  const { error } = await db
    .from("occupancy_pace_snapshots")
    .upsert(dbRows, { onConflict: "captured_on,venue_id,service_date" });
  if (error) throw new Error(`予約カーブスナップショット保存エラー: ${error.message}`);
}
