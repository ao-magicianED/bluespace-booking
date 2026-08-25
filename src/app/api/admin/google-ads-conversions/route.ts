import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Google広告のオフラインコンバージョン取込用CSV（APIの審査待ち中の代替手段）。
 *
 * なぜこの経路が必要か:
 *   ブラウザ側のタグ（gtag）だけでは、広告ブロッカー・タブの即閉じ・
 *   決済後のリダイレクト失敗で確実に取りこぼす。
 *   旧直販サイト（UPNOW）では完了ページが他社ドメインでタグ自体を置けず、
 *   コンバージョンが一度も取れなかった。
 *   ここでは「Stripeで決済が確定した」というサーバー事実だけを根拠にするため、
 *   ブラウザで何が起きても欠測しない。
 *
 * 使い方（管理画面 /admin/google-ads から操作する）:
 *   1. GET でCSVをダウンロード
 *   2. Google広告 → 目標 → コンバージョン → アップロード → ファイルをアップロード
 *   3. 取り込めたら POST で「そのCSVに入っていた予約IDだけ」を送信済みにする
 *
 * GETは読み取り専用にしてある。
 *   以前は ?mark=1 で同じGETが書き込みもしていたが、これは2つの意味で危なかった。
 *   ①GETで状態が変わるとリンクを踏んだだけで発火しうる
 *   ②マーク時にビューを引き直すため、ダウンロード後に増えた予約まで
 *     「送信済み」にしてしまい、CSVに入っていない予約が静かに欠測する
 *   どちらもPOSTで対象IDを明示することで消える。
 */

/** CSVフィールドのエスケープ（カンマ・改行・引用符対応） */
function esc(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

type Row = {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  conversion_time: string;
  conversion_value: number;
  currency: string;
  booking_id: string;
  venue_slug: string;
};

/** 1回のダウンロードで扱う上限。超えた分は次回に回る */
const MAX_ROWS = 5000;

async function fetchPending() {
  const db = getDb();
  const { data, error } = await db
    .from("google_ads_conversions")
    .select("*")
    .limit(MAX_ROWS);
  if (error) throw new Error(`コンバージョンの取得に失敗しました: ${error.message}`);
  return (data ?? []) as Row[];
}

/**
 * GET: 未送信のコンバージョンを出力する（読み取りのみ・状態は変えない）。
 *   ?format=json … 管理画面用。booking_id を含む生データを返す
 *   （既定）      … Google広告にそのまま渡せるCSV
 */
export async function GET(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  // コンバージョンアクション名はGoogle広告側で作った名前と完全一致させる必要がある
  const actionName =
    process.env.GOOGLE_ADS_CONVERSION_ACTION_NAME ?? "予約完了（自社サイト）";

  let rows: Row[];
  try {
    rows = await fetchPending();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  // クリックIDが無い行はGoogle広告に渡せないので最初に落とす。
  // 送信済みマークの対象も、ここで残った分だけにする（渡していない予約を消さない）。
  const usable = rows
    .map((r) => ({ ...r, clickId: r.gclid ?? r.gbraid ?? r.wbraid }))
    .filter((r): r is Row & { clickId: string } => Boolean(r.clickId));

  if (req.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json({
      actionName,
      total: rows.length,
      rows: usable.map((r) => ({
        bookingId: r.booking_id,
        clickId: r.clickId,
        conversionTime: r.conversion_time,
        conversionValue: r.conversion_value,
        currency: r.currency,
        venueSlug: r.venue_slug,
      })),
    });
  }

  // Google広告のアップロード仕様: 1行目にParameters、2行目に列名
  const lines: string[] = [
    "Parameters:TimeZone=Asia/Tokyo",
    [
      "Google Click ID",
      "Conversion Name",
      "Conversion Time",
      "Conversion Value",
      "Conversion Currency",
    ].join(","),
  ];

  for (const r of usable) {
    lines.push(
      [
        esc(r.clickId),
        esc(actionName),
        esc(r.conversion_time),
        esc(r.conversion_value),
        esc(r.currency),
      ].join(",")
    );
  }

  // Google広告はUTF-8を受け付ける（Excel向けのShift_JIS変換はしない）
  const csv = lines.join("\r\n") + "\r\n";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="google-ads-conversions-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * POST: Google広告への取り込みが済んだ予約を送信済みにする。
 * body: { bookingIds: string[] }
 *
 * 対象を呼び出し側から明示的に受け取るのが要点。
 * サーバー側で引き直すと、ダウンロードしてからアップロードするまでの間に
 * 確定した予約まで巻き込んで「送信済み」にしてしまう。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの形式が不正です" }, { status: 400 });
  }

  const raw = (body as { bookingIds?: unknown } | null)?.bookingIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    return NextResponse.json(
      { error: "bookingIds（送信済みにする予約IDの配列）が必要です" },
      { status: 400 }
    );
  }
  if (raw.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `一度に指定できるのは${MAX_ROWS}件までです` },
      { status: 400 }
    );
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const ids = Array.from(
    new Set(raw.filter((v): v is string => typeof v === "string" && UUID.test(v)))
  );
  if (ids.length === 0) {
    return NextResponse.json({ error: "有効な予約IDがありませんでした" }, { status: 400 });
  }

  // すでに送信済みの分は上書きしない（最初に送った日時を残す）
  const db = getDb();
  const { data, error } = await db
    .from("bookings")
    .update({ conversion_exported_at: new Date().toISOString() })
    .in("id", ids)
    .is("conversion_exported_at", null)
    .select("id");

  if (error) {
    return NextResponse.json(
      { error: `送信済みの記録に失敗しました: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ requested: ids.length, marked: (data ?? []).length });
}
