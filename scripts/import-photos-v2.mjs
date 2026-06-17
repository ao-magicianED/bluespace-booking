// ★HP掲載写真（H:\共有ドライブ\BS写真）から多様な構図の写真を自動選定して取り込む
// - dHash（知覚ハッシュ）で「見た目が似ている写真」を判定
// - maxmin貪欲法で「お互いに最も構図が違う」組み合わせを選ぶ
// - 備品は多め（最大10枚）に必ず取り込む
// 実行: node scripts/import-photos-v2.mjs
import sharp from "sharp";
import { readdirSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC_ROOT = "H:/共有ドライブ/BS写真";
const DST_ROOT = "public/venues";

const VENUES = [
  { slug: "keisei-koiwa", dir: "ブルースペース京成小岩(済み)" },
  { slug: "kanda", dir: "ブルースペース神田(済み)あ" },
  { slug: "ueno-okachimachi", dir: "ブルースペース上野御徒町(済み)あ" },
  { slug: "ueno-4a", dir: "ブルースペース上野駅前4A(済み)" },
  { slug: "ueno-4b", dir: "ブルースペース上野駅前4B(済み)" },
  { slug: "nishi-shinjuku", dir: "ブルースペース西新宿403(済み)あ" },
  { slug: "shirokane-takanawa", dir: "ブルースペース白金高輪(済み)あ" },
];

// ★内のカテゴリフォルダ → サイト上のカテゴリID と選定上限
const CATS = [
  { src: "室内", id: "interior", cap: 8 },
  { src: "備品", id: "equipment", cap: 10 },
  { src: "外観周辺施設", id: "exterior", cap: 4 },
];

/** dHash 64bit: 9x8グレースケールに縮小し隣接画素の明暗で指紋化 */
async function dhash(file) {
  const { data } = await sharp(file)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const bits = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) bits.push(data[y * 9 + x] < data[y * 9 + x + 1] ? 1 : 0);
  return bits;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/** maxmin貪欲法: 既選択集合との最小距離が最大の画像を順に追加（=構図の多様性最大化） */
function pickDiverse(items, cap) {
  if (items.length <= cap) return items;
  const selected = [items[0]];
  const rest = items.slice(1);
  while (selected.length < cap && rest.length > 0) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < rest.length; i++) {
      const minDist = Math.min(...selected.map((s) => hamming(s.hash, rest[i].hash)));
      if (minDist > bestScore) {
        bestScore = minDist;
        bestIdx = i;
      }
    }
    selected.push(rest.splice(bestIdx, 1)[0]);
  }
  return selected;
}

async function convert(src, dst) {
  await sharp(src)
    .rotate() // EXIFの向きを反映
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 75, mozjpeg: true })
    .toFile(dst);
}

const isImage = (f) => /\.(jpe?g|png)$/i.test(f);

const manifest = {};
for (const v of VENUES) {
  const starDir = join(SRC_ROOT, v.dir, "★HP掲載写真");
  const dstDir = join(DST_ROOT, v.slug);
  mkdirSync(dstDir, { recursive: true });
  manifest[v.slug] = {};

  for (const cat of CATS) {
    const catDir = join(starDir, cat.src);
    if (!existsSync(catDir)) {
      manifest[v.slug][cat.id] = 0;
      continue;
    }
    const files = readdirSync(catDir).filter(isImage).sort();
    // ハッシュ計算（読めないファイルはスキップ）
    const items = [];
    for (const f of files) {
      try {
        items.push({ file: join(catDir, f), hash: await dhash(join(catDir, f)) });
      } catch {
        console.error(`skip(読込不可): ${v.slug}/${cat.src}/${f}`);
      }
    }
    const picked = pickDiverse(items, cat.cap);
    for (let i = 0; i < picked.length; i++) {
      await convert(picked[i].file, join(dstDir, `${cat.id}-${i + 1}.jpg`));
    }
    manifest[v.slug][cat.id] = picked.length;
  }

  // 地図 → access-map.jpg（1枚目）
  const mapDir = join(starDir, "地図");
  if (existsSync(mapDir)) {
    const maps = readdirSync(mapDir).filter(isImage).sort();
    if (maps.length > 0) {
      await convert(join(mapDir, maps[0]), join(dstDir, "access-map.jpg"));
      manifest[v.slug].accessMap = true;
    }
  }

  // ヒーローは室内1枚目（最も代表的な構図）をhero.jpgにも複製
  if (manifest[v.slug].interior > 0) {
    await sharp(join(dstDir, "interior-1.jpg")).toFile(join(dstDir, "hero.jpg"));
  }
}

console.log(JSON.stringify(manifest, null, 1));
