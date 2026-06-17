// コーポレートサイトの拠点写真を圧縮して public/venues/ に取り込むスクリプト
// 実行: node scripts/import-photos.mjs
import sharp from "sharp";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = "C:/Users/04kc5/Desktop/ClaudeCodePJ/ブルーステージ合同会社HP移管PJ/src/assets/spaces";
const DST_ROOT = "public/venues";

// カテゴリごとの最大取り込み枚数
const CAPS = { interior: 6, equipment: 6, exterior: 3, layout: 3, treatment: 6 };

// コーポレートサイトのHeroSliderが採用している「厳選写真」を先頭に置く
// （ファイル名順の機械選択だと古いカットが先頭に来るため）
const VENUES = [
  { slug: "kanda", cats: ["interior", "equipment", "exterior", "layout"], map: true },
  {
    slug: "ueno-okachimachi",
    cats: ["interior", "equipment", "exterior", "layout"],
    map: true,
    picks: { interior: ["01.jpg", "02.jpg", "03.jpg", "08.jpg", "10.jpg", "14.jpg"], exterior: ["07.jpg"] },
  },
  { slug: "nishi-shinjuku", cats: ["interior", "equipment", "exterior", "layout"], map: true },
  { slug: "shirokane-takanawa", cats: ["interior", "equipment", "exterior", "treatment"], map: true },
  {
    slug: "keisei-koiwa",
    cats: ["interior", "equipment", "exterior", "layout"],
    map: true,
    picks: { interior: ["04.jpg", "06.jpg", "08.jpg", "10.jpg", "11.jpg", "12.jpg"], exterior: ["05.jpg"] },
  },
  { slug: "ueno-4a", flat: true },
  { slug: "ueno-4b", flat: true },
];

async function convert(src, dst) {
  await sharp(src)
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toFile(dst);
}

const manifest = {};
for (const v of VENUES) {
  const srcDir = join(SRC_ROOT, v.slug);
  const dstDir = join(DST_ROOT, v.slug);
  mkdirSync(dstDir, { recursive: true });
  manifest[v.slug] = {};

  // hero
  if (existsSync(join(srcDir, "hero.jpg"))) {
    await convert(join(srcDir, "hero.jpg"), join(dstDir, "hero.jpg"));
    manifest[v.slug].hero = `/venues/${v.slug}/hero.jpg`;
  }

  if (v.flat) {
    // photo01-06 → interior扱い
    const files = readdirSync(srcDir).filter((f) => /^photo\d+\.jpg$/.test(f)).sort();
    manifest[v.slug].interior = [];
    for (let i = 0; i < Math.min(files.length, 6); i++) {
      const out = `interior-${i + 1}.jpg`;
      await convert(join(srcDir, files[i]), join(dstDir, out));
      manifest[v.slug].interior.push(`/venues/${v.slug}/${out}`);
    }
    continue;
  }

  for (const cat of v.cats) {
    const catDir = join(srcDir, cat);
    if (!existsSync(catDir)) continue;
    const all = readdirSync(catDir).filter((f) => f.endsWith(".jpg")).sort();
    const cap = CAPS[cat] ?? 6;
    // 厳選リストがあればそれを先頭に、残りはファイル名順で補充
    const picked = v.picks?.[cat]?.filter((f) => all.includes(f)) ?? [];
    const rest = all.filter((f) => !picked.includes(f));
    const files = [...picked, ...rest];
    manifest[v.slug][cat] = [];
    for (let i = 0; i < Math.min(files.length, cap); i++) {
      const out = `${cat}-${i + 1}.jpg`;
      await convert(join(catDir, files[i]), join(dstDir, out));
      manifest[v.slug][cat].push(`/venues/${v.slug}/${out}`);
    }
  }

  // 案内地図（map/01.jpg）
  if (v.map) {
    const mapDir = join(srcDir, "map");
    if (existsSync(mapDir)) {
      const files = readdirSync(mapDir).filter((f) => f.endsWith(".jpg")).sort();
      if (files.length > 0) {
        await convert(join(mapDir, files[0]), join(dstDir, "access-map.jpg"));
        manifest[v.slug].accessMap = `/venues/${v.slug}/access-map.jpg`;
      }
    }
  }
}

console.log(JSON.stringify(manifest, null, 1));
