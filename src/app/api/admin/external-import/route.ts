import { NextRequest, NextResponse } from "next/server";
import iconv from "iconv-lite";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { parseExternalCsv, type ExternalChannel } from "@/lib/external-import";

export const dynamic = "force-dynamic";

const CHANNELS: ExternalChannel[] = ["instabase", "spacemarket", "upnow"];
// 実データで確認済みのエクスポート文字コード（インスタベース=UTF-8 BOM／スペースマーケット=UTF-8／UPNOW=Shift_JIS）
const ENCODING: Record<ExternalChannel, string> = {
  instabase: "utf8",
  spacemarket: "utf8",
  upnow: "cp932",
};
const UPSERT_CHUNK = 500;

/**
 * POST /api/admin/external-import — 外部モールのCSVをアップロードして external_bookings に取り込む。
 * fields: channel, file（multipart/form-data）
 * 同じCSVを再アップロードしても (channel, external_booking_id) のユニーク制約でupsertされるだけで重複しない。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const channel = String(form.get("channel") ?? "") as ExternalChannel;
  const file = form.get("file");
  if (!CHANNELS.includes(channel)) {
    return NextResponse.json({ error: "チャネルの指定が不正です" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "CSVファイルを選択してください" }, { status: 400 });
  }
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "ファイルサイズが大きすぎます（20MBまで）" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const text = iconv.decode(buf, ENCODING[channel]);

  let records;
  try {
    records = parseExternalCsv(channel, text);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
  if (records.length === 0) {
    return NextResponse.json({ error: "取り込める行がありませんでした" }, { status: 400 });
  }

  const db = getDb();
  const { data: venues, error: venueErr } = await db.from("venues").select("id, slug");
  if (venueErr) {
    return NextResponse.json({ error: `拠点取得エラー: ${venueErr.message}` }, { status: 500 });
  }
  const venueIdBySlug = new Map((venues ?? []).map((v) => [v.slug as string, v.id as string]));

  const unmatchedNames = new Set<string>();
  const rows = records.map((r) => {
    const venueId = r.venueSlug ? (venueIdBySlug.get(r.venueSlug) ?? null) : null;
    if (!venueId) unmatchedNames.add(r.rawVenueName || "(拠点名なし)");
    return {
      channel: r.channel,
      external_booking_id: r.externalBookingId,
      venue_id: venueId,
      raw_venue_name: r.rawVenueName,
      status: r.status,
      booked_at: r.bookedAt,
      start_at: r.startAt,
      end_at: r.endAt,
      hours: r.hours,
      gross_amount: r.grossAmount,
      net_amount: r.netAmount,
      coupon_amount: r.couponAmount,
      plan_name: r.planName,
      purpose: r.purpose,
    };
  });

  // 挿入/更新の内訳を出すため、先に既存IDを調べておく（大量件数に備えてページング）
  const idsInBatch = rows.map((r) => r.external_booking_id);
  const existingIds = new Set<string>();
  for (let i = 0; i < idsInBatch.length; i += 1000) {
    const chunk = idsInBatch.slice(i, i + 1000);
    const { data, error } = await db
      .from("external_bookings")
      .select("external_booking_id")
      .eq("channel", channel)
      .in("external_booking_id", chunk);
    if (error) {
      return NextResponse.json({ error: `既存件数の確認に失敗しました: ${error.message}` }, { status: 500 });
    }
    for (const d of data ?? []) existingIds.add(d.external_booking_id as string);
  }

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await db
      .from("external_bookings")
      .upsert(chunk, { onConflict: "channel,external_booking_id" });
    if (error) {
      return NextResponse.json({ error: `取込に失敗しました（${i}件目付近）: ${error.message}` }, { status: 500 });
    }
  }

  const insertedCount = idsInBatch.filter((id) => !existingIds.has(id)).length;
  const updatedCount = idsInBatch.length - insertedCount;

  await db.from("external_import_batches").insert({
    channel,
    file_name: file.name.slice(0, 200),
    row_count: rows.length,
    inserted_count: insertedCount,
    updated_count: updatedCount,
    unmatched_venue_count: unmatchedNames.size > 0 ? rows.filter((r) => !r.venue_id).length : 0,
  });

  return NextResponse.json({
    ok: true,
    rowCount: rows.length,
    insertedCount,
    updatedCount,
    unmatchedVenueNames: Array.from(unmatchedNames).slice(0, 20),
  });
}
