import { google, type calendar_v3 } from "googleapis";
import type { TimeRange } from "./types";

/**
 * Google Calendar 連携（サービスアカウント方式）
 * - 読み: FreeBusy（空き判定）。失敗時は呼び出し側で「予約不可」に倒す（fail closed）
 * - 書き: 予約確定時のイベント作成
 * - 注意: 拠点カレンダーは公開iCalでHPの空き状況表示にも使われている。
 *   ただし「予定の有無のみ表示」設定にしてあるため、外部公開範囲は開始/終了時刻のみで
 *   タイトル・説明の中身は共有された相手（オーナー等）にしか見えない前提でイベント本文に
 *   詳細情報を記載している。この公開設定はGoogle側の管理画面で変更されうるため、
 *   将来設定を見直す際は必ず「予定の有無のみ表示」のままであることを確認すること。
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
    cal.freebusy.query(
      {
        requestBody: {
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
          timeZone: "Asia/Tokyo",
          items: [{ id: calendarId }],
        },
      },
      // gaxiosにはデフォルトタイムアウトがなく、ソケットハング時はawaitが永久に続く。
      // rejectに変換して呼び出し側のfail closed / 自社予約のみ集計フォールバックに到達させる
      { timeout: 10_000 }
    )
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

/** カレンダーイベントに書き込む予約詳細（オーナー・共有相手のみが閲覧可能な前提） */
export type BookingEventDetails = {
  venueName: string;
  customerName: string;
  companyName?: string | null;
  partySize?: number | null;
  optionsText?: string | null;
  amountText: string;
  paymentMethodLabel: string;
  createdAtText: string;
  adminUrl: string;
};

function buildEventContent(
  bookingId: string,
  details: BookingEventDetails
): { summary: string; description: string } {
  const shortId = bookingId.replace(/-/g, "").slice(-8);
  const summary = `【自社予約(BlueSpaceRental)】${details.venueName} #${shortId}`;
  const description = [
    `お客様: ${details.customerName}${details.companyName ? `（${details.companyName}）` : ""}`,
    details.partySize != null ? `人数: ${details.partySize}名` : null,
    details.optionsText ? `オプション: ${details.optionsText}` : null,
    `金額: ${details.amountText}（${details.paymentMethodLabel}）`,
    `予約受付: ${details.createdAtText}`,
    `予約ID: ${bookingId}`,
    ``,
    `▼予約詳細ページ（管理画面・要ログイン）`,
    details.adminUrl,
  ]
    .filter((line): line is string => line != null)
    .join("\n");
  return { summary, description };
}

/**
 * 予約確定イベントを作成し、イベントIDを返す。
 */
export async function createBookingEvent(
  calendarId: string,
  bookingId: string,
  start: Date,
  end: Date,
  details: BookingEventDetails
): Promise<string> {
  if (!calendarId) throw new Error("calendar_id が未設定の拠点です");
  const cal = getCalendarClient();
  const { summary, description } = buildEventContent(bookingId, details);
  const res = await withRetry(() =>
    cal.events.insert({
      calendarId,
      requestBody: {
        summary,
        description,
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
 * details を渡すと、金額変更などを反映してタイトル・説明も再構築する。
 */
export async function updateBookingEventTime(
  calendarId: string,
  eventId: string,
  bookingId: string,
  start: Date,
  end: Date,
  details?: BookingEventDetails
): Promise<void> {
  if (!calendarId) throw new Error("calendar_id が未設定の拠点です");
  const cal = getCalendarClient();
  const content = details ? buildEventContent(bookingId, details) : null;
  await withRetry(() =>
    cal.events.patch({
      calendarId,
      eventId,
      requestBody: {
        ...(content ?? {}),
        start: { dateTime: start.toISOString(), timeZone: "Asia/Tokyo" },
        end: { dateTime: end.toISOString(), timeZone: "Asia/Tokyo" },
      },
    })
  );
}

/**
 * イベントを削除する（キャンセル時に使用）。冪等: 404/410（既に削除済み）はエラーにしない。
 */
export async function deleteBookingEvent(calendarId: string, eventId: string): Promise<void> {
  if (!calendarId) throw new Error("calendar_id が未設定の拠点です");
  const cal = getCalendarClient();
  try {
    await withRetry(() => cal.events.delete({ calendarId, eventId }));
  } catch (e: unknown) {
    const status = (e as { code?: number; response?: { status?: number } })?.code
      ?? (e as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 410) return; // 既に削除済み＝成功扱い
    throw e;
  }
}
