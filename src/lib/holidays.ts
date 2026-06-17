import { getDb } from "./supabase";
import { jstDayOfWeek } from "./slots";

/**
 * 「休日」= 土曜・日曜・日本の祝日（jp_holidaysテーブル）。
 * 祝日データはCron（/api/cron/maintenance）が holidays-jp API から自動更新する。
 */

/** 指定した日付配列のうち祝日であるものをSetで返す（DBを1回だけ叩く） */
export async function getHolidaySet(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const db = getDb();
  const { data, error } = await db.from("jp_holidays").select("date").in("date", dates);
  if (error) {
    // 祝日テーブルが読めない場合は土日のみで判定（過小請求リスクよりサービス継続を優先しログに残す）
    console.error("[holidays] 祝日取得エラー:", error.message);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.date as string));
}

/** 土日祝判定 */
export function isHolidayDate(dateStr: string, holidaySet: Set<string>): boolean {
  const dow = jstDayOfWeek(dateStr);
  return dow === 0 || dow === 6 || holidaySet.has(dateStr);
}

/** holidays-jp APIから祝日を取得してDBへupsert（Cronから呼ぶ・ベストエフォート） */
export async function refreshHolidays(): Promise<number> {
  const res = await fetch("https://holidays-jp.github.io/api/v1/date.json");
  if (!res.ok) throw new Error(`holidays-jp API ${res.status}`);
  const json: Record<string, string> = await res.json();
  const rows = Object.entries(json).map(([date, name]) => ({ date, name }));
  if (rows.length === 0) return 0;
  const db = getDb();
  const { error } = await db.from("jp_holidays").upsert(rows, { onConflict: "date" });
  if (error) throw new Error(`祝日upsertエラー: ${error.message}`);
  return rows.length;
}
