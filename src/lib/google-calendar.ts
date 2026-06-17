import { google, type calendar_v3 } from "googleapis";
import type { TimeRange } from "./types";

/**
 * Google Calendar 連携（サービスアカウント方式）
 * - 読み: FreeBusy（空き判定）。失敗時は呼び出し側で「予約不可」に倒す（fail closed）
 * - 書き: 予約確定時のイベント作成
 * - 注意: 拠点カレンダーは公開iCalでHPにも使われるため、イベントに個人情報を書かない
 */

type ServiceAccount = { client_email: string; private_key: string };

function loadServiceAccount(): ServiceAccount | null {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_BASE64;
  if (!b64) return null;
  try {
    const json = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
    if (!json.client_email || !json.private_key) return null;
    return { client_email: json.client_email, private_key: json.private_key };
  } catch {
    return null;
  }
}

export function isCalendarConfigured(): boolean {
  return loadServiceAccount() !== null;
}

function getCalendarClient(): calendar_v3.Calendar {
  const sa = loadServiceAccount();
  if (!sa) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY_BASE64 が未設定または不正です");
  const auth = new google.auth.JWT({
    email: sa.client_email,
    key: sa.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
  });
  return google.calendar({ version: "v3", auth });
}

/** 軽いリトライ（指数バックオフ）。レート制限・一時障害対策 */
async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
    }
  }
  throw lastErr;
}

/**
 * 指定期間の「埋まっている時間帯」を取得する。
 * カレンダー未設定（calendar_id空）の場合は空配列（自社DBのみで判定）。
 * APIエラー時は例外を投げる → 呼び出し側でfail closed処理。
 */
export async function getBusyRanges(
  calendarId: string,
  timeMin: Date,
  timeMax: Date
): Promise<TimeRange[]> {
  if (!calendarId) return [];
  const cal = getCalendarClient();
  const res = await withRetry(() =>
    cal.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        timeZone: "Asia/Tokyo",
        items: [{ id: calendarId }],
      },
    })
  );
  const calResult = res.data.calendars?.[calendarId];
  // カレンダー単位のエラー（権限不足など）もfail closed対象
  if (!calResult || calResult.errors?.length) {
    throw new Error(`FreeBusy取得失敗: ${JSON.stringify(calResult?.errors ?? "no result")}`);
  }
  return (calResult.busy ?? []).map((b) => ({
    start: new Date(b.start as string),
    end: new Date(b.end as string),
  }));
}

/**
 * 予約確定イベントを作成し、イベントIDを返す。
 * タイトル・説明に個人情報は入れない（公開iCal経由の漏えい防止）。
 */
export async function createBookingEvent(
  calendarId: string,
  bookingId: string,
  start: Date,
  end: Date
): Promise<string> {
  if (!calendarId) throw new Error("calendar_id が未設定の拠点です");
  const cal = getCalendarClient();
  const shortId = bookingId.replace(/-/g, "").slice(-8);
  const res = await withRetry(() =>
    cal.events.insert({
      calendarId,
      requestBody: {
        summary: `【自社予約】#${shortId}`,
        description: `自社予約システム経由の予約です。\n予約ID: ${bookingId}\n詳細は管理者メールまたはSupabaseで確認してください。`,
        start: { dateTime: start.toISOString(), timeZone: "Asia/Tokyo" },
        end: { dateTime: end.toISOString(), timeZone: "Asia/Tokyo" },
      },
    })
  );
  const eventId = res.data.id;
  if (!eventId) throw new Error("カレンダーイベントIDが取得できませんでした");
  return eventId;
}

/**
 * 既存イベントの開始/終了時刻を更新する（時間変更時に使用）。
 */
export async function updateBookingEventTime(
  calendarId: string,
  eventId: string,
  start: Date,
  end: Date
): Promise<void> {
  if (!calendarId) throw new Error("calendar_id が未設定の拠点です");
  const cal = getCalendarClient();
  await withRetry(() =>
    cal.events.patch({
      calendarId,
      eventId,
      requestBody: {
        start: { dateTime: start.toISOString(), timeZone: "Asia/Tokyo" },
        end: { dateTime: end.toISOString(), timeZone: "Asia/Tokyo" },
      },
    })
  );
}
