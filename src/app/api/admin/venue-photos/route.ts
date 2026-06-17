import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const BUCKET = "venue-photos";
const MAX_FILES = 10;
const MAX_SIZE = 15 * 1024 * 1024; // 15MB/枚（リサイズ前）

/**
 * POST /api/admin/venue-photos — 写真アップロード（multipart/form-data）。
 * fields: venueId, categoryId, categoryLabel, files[]
 * 画像は幅1600pxにリサイズしてSupabase Storageへ保存し、venue_photosに行を追加する。
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

  const venueId = String(form.get("venueId") ?? "");
  const categoryLabel = String(form.get("categoryLabel") ?? "").trim().slice(0, 30);
  const categoryId = String(form.get("categoryId") ?? "").trim().slice(0, 50) || categoryLabel;
  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (!/^[0-9a-f-]{36}$/.test(venueId)) {
    return NextResponse.json({ error: "拠点IDが不正です" }, { status: 400 });
  }
  if (!categoryLabel) {
    return NextResponse.json({ error: "カテゴリ名を入力してください" }, { status: 400 });
  }
  if (files.length === 0 || files.length > MAX_FILES) {
    return NextResponse.json({ error: `写真は1〜${MAX_FILES}枚で指定してください` }, { status: 400 });
  }

  const db = getDb();
  const { data: venue } = await db
    .from("venues")
    .select("slug, name")
    .eq("id", venueId)
    .maybeSingle<{ slug: string; name: string }>();
  if (!venue) return NextResponse.json({ error: "拠点が見つかりません" }, { status: 404 });

  // 既存カテゴリの並び順・末尾sortを取得
  const { data: existing } = await db
    .from("venue_photos")
    .select("category_id, cat_sort, sort")
    .eq("venue_id", venueId);
  const rows = existing ?? [];
  const sameCat = rows.filter((r) => r.category_id === categoryId);
  const catSort =
    sameCat.length > 0
      ? sameCat[0].cat_sort
      : rows.length > 0
        ? Math.max(...rows.map((r) => r.cat_sort)) + 1
        : 0;
  let nextSort = sameCat.length > 0 ? Math.max(...sameCat.map((r) => r.sort)) + 1 : 0;

  let uploaded = 0;
  for (const file of files) {
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: `「${file.name}」が大きすぎます（15MBまで）` },
        { status: 400 }
      );
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      // limitInputPixels: 解凍爆弾（小さいファイルだが巨大ピクセル）対策（上限約2.4億px）
      const out = await sharp(buf, { limitInputPixels: 24000 * 10000 })
        .rotate() // EXIFの向きを反映
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      const path = `${venue.slug}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.jpg`;
      const { error: upError } = await db.storage.from(BUCKET).upload(path, out, {
        contentType: "image/jpeg",
        cacheControl: "31536000",
      });
      if (upError) throw new Error(upError.message);
      const { data: pub } = db.storage.from(BUCKET).getPublicUrl(path);
      const { error: insError } = await db.from("venue_photos").insert({
        venue_id: venueId,
        category_id: categoryId,
        category_label: categoryLabel,
        cat_sort: catSort,
        src: pub.publicUrl,
        alt: `${venue.name} ${categoryLabel}`,
        sort: nextSort++,
      });
      if (insError) throw new Error(insError.message);
      uploaded++;
    } catch (e) {
      console.error("[admin/venue-photos] アップロード失敗:", e);
      return NextResponse.json(
        { error: `アップロードに失敗しました（${uploaded}枚は成功）: ${String(e).slice(0, 200)}` },
        { status: 500 }
      );
    }
  }
  return NextResponse.json({ ok: true, uploaded });
}

/** DELETE /api/admin/venue-photos — 写真を1枚削除（DB行＋Storageのファイル） */
export async function DELETE(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }
  let body: { photoId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const photoId = body.photoId ?? "";
  if (!/^[0-9a-f-]{36}$/.test(photoId)) {
    return NextResponse.json({ error: "写真IDが不正です" }, { status: 400 });
  }
  const db = getDb();
  const { data: photo } = await db
    .from("venue_photos")
    .select("id, src")
    .eq("id", photoId)
    .maybeSingle<{ id: string; src: string }>();
  if (!photo) return NextResponse.json({ error: "写真が見つかりません" }, { status: 404 });

  const { error } = await db.from("venue_photos").delete().eq("id", photoId);
  if (error) {
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }
  // アップロード写真ならStorageからも削除（静的ファイル /venues/... はそのまま）
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const idx = photo.src.indexOf(marker);
  if (idx >= 0) {
    const path = decodeURIComponent(photo.src.slice(idx + marker.length));
    await db.storage.from(BUCKET).remove([path]);
  }
  return NextResponse.json({ ok: true });
}

/** PATCH /api/admin/venue-photos — 並べ替え（同カテゴリ内で1つ上/下と入れ替え） */
export async function PATCH(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }
  let body: { photoId?: string; dir?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }
  const photoId = body.photoId ?? "";
  const dir = body.dir === "up" ? "up" : "down";
  if (!/^[0-9a-f-]{36}$/.test(photoId)) {
    return NextResponse.json({ error: "写真IDが不正です" }, { status: 400 });
  }
  const db = getDb();
  const { data: photo } = await db
    .from("venue_photos")
    .select("id, venue_id, category_id, sort")
    .eq("id", photoId)
    .maybeSingle<{ id: string; venue_id: string; category_id: string; sort: number }>();
  if (!photo) return NextResponse.json({ error: "写真が見つかりません" }, { status: 404 });

  // 隣の写真を探して sort を入れ替える
  const neighborQuery = db
    .from("venue_photos")
    .select("id, sort")
    .eq("venue_id", photo.venue_id)
    .eq("category_id", photo.category_id);
  const { data: neighbor } = await (dir === "up"
    ? neighborQuery.lt("sort", photo.sort).order("sort", { ascending: false }).limit(1)
    : neighborQuery.gt("sort", photo.sort).order("sort", { ascending: true }).limit(1)
  ).maybeSingle<{ id: string; sort: number }>();
  if (!neighbor) return NextResponse.json({ ok: true }); // 端なので何もしない

  await db.from("venue_photos").update({ sort: neighbor.sort }).eq("id", photo.id);
  await db.from("venue_photos").update({ sort: photo.sort }).eq("id", neighbor.id);
  return NextResponse.json({ ok: true });
}
