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

/**
 * getHolidaySetの厳格版（価格ガードレール用）。
 * 通常版はDB障害時に空Setを返すfail-open（料金表示を止めないため）だが、
 * 「土日祝に値下げ指示を出さない」ガードレールでは空Set=祝日なし扱いとなり安全方向が逆になる。
 * こちらは (1)クエリ失敗でthrow (2)対象年の祝日データがテーブルに1件もなければthrow（未投入年の素通り防止）。
 */
export async function getHolidaySetStrict(dates: string[]): Promise<Set<string>> {
  if (dates.length === 0) return new Set();
  const db = getDb();
  const { data, error } = await db.from("jp_holidays").select("date").in("date", dates);
  if (error) throw new Error(`祝日データの取得に失敗しました: ${error.message}`);

  const years = Array.from(new Set(dates.map((d) => d.slice(0, 4))));
  for (const year of years) {
    const { data: probe, error: probeErr } = await db
      .from("jp_holidays")
      .select("date")
      .gte("date", `${year}-01-01`)
      .lte("date", `${year}-12-31`)
      .limit(1);
    if (probeErr) throw new Error(`祝日データの取得に失敗しました: ${probeErr.message}`);
    if (!probe || probe.length === 0) {
      throw new Error(`${year}年の祝日データが未登録です（cron/maintenanceの祝日更新を確認してください）`);
    }
  }
  return new Set((data ?? []).map((r) => r.date as string));
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
