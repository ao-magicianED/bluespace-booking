/**
 * venues.ts の静的ギャラリー定義を venue_photos テーブルへ移行するシードスクリプト。
 * 実行: app ディレクトリで `node scripts/seed-venue-photos.ts`（Node 23.6+ / TS直接実行）
 * 注意: 実行すると venue_photos を全削除して入れ直す（管理画面でのアップロード分も消える）
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { venueContents } from "../src/content/venues.ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()])
);

const db = createClient(env.SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const { data: venues, error: vErr } = await db.from("venues").select("id, slug");
if (vErr || !venues) throw new Error(`venues取得失敗: ${vErr?.message}`);
const idBySlug = Object.fromEntries(venues.map((v) => [v.slug, v.id]));

const rows: Record<string, unknown>[] = [];
for (const c of Object.values(venueContents)) {
  const vid = idBySlug[c.slug];
  if (!vid) {
    console.warn(`skip: ${c.slug}（venuesに存在しない）`);
    continue;
  }
  c.photos.categories.forEach((cat, ci) =>
    cat.images.forEach((img, i) =>
      rows.push({
        venue_id: vid,
        category_id: cat.id,
        category_label: cat.label,
        cat_sort: ci,
        src: img.src,
        alt: img.alt,
        sort: i,
      })
    )
  );
}

const { error: delErr } = await db.from("venue_photos").delete().neq("src", "");
if (delErr) throw new Error(`削除失敗: ${delErr.message}`);
const { error: insErr } = await db.from("venue_photos").insert(rows);
if (insErr) throw new Error(`挿入失敗: ${insErr.message}`);
console.log(`完了: ${rows.length}枚を登録しました`);
