"use client";

import { useState } from "react";
import Image from "next/image";
import type { GalleryCategory } from "@/content/venues";

/**
 * カテゴリタブ（室内/備品・設備/外観/間取り等）つきフォトギャラリー。
 * メイン画像＋サムネイル切り替え。依存ライブラリなし・next/imageで自動最適化。
 */
export default function PhotoGallery({ categories }: { categories: GalleryCategory[] }) {
  const [catIdx, setCatIdx] = useState(0);
  const [imgIdx, setImgIdx] = useState(0);
  if (categories.length === 0) return null;

  const cat = categories[Math.min(catIdx, categories.length - 1)];
  const photos = cat.images;
  const main = photos[Math.min(imgIdx, photos.length - 1)];

  return (
    <div className="gallery">
      {categories.length > 1 && (
        <div className="gallery-tabs" role="tablist" aria-label="写真カテゴリ">
          {categories.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={i === catIdx}
              className={`gallery-tab ${i === catIdx ? "active" : ""}`}
              onClick={() => {
                setCatIdx(i);
                setImgIdx(0);
              }}
            >
              {c.label}
              <span className="gallery-tab-count">{c.images.length}</span>
            </button>
          ))}
        </div>
      )}
      <div className="gallery-main">
        <Image
          src={main.src}
          alt={main.alt}
          fill
          sizes="(max-width: 768px) 100vw, 1120px"
          style={{ objectFit: "cover" }}
          priority={catIdx === 0 && imgIdx === 0}
        />
      </div>
      <div className="gallery-thumbs">
        {photos.map((p, i) => (
          <button
            key={p.src}
            type="button"
            aria-label={p.alt}
            className={`gallery-thumb ${i === imgIdx ? "active" : ""}`}
            onClick={() => setImgIdx(i)}
          >
            <Image src={p.src} alt={p.alt} fill sizes="120px" style={{ objectFit: "cover" }} />
          </button>
        ))}
      </div>
    </div>
  );
}
