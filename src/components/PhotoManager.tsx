"use client";

import { useState } from "react";
/* eslint-disable @next/next/no-img-element -- 管理画面のサムネイルは最適化不要 */

type PhotoRow = {
  id: string;
  category_id: string;
  category_label: string;
  src: string;
  sort: number;
};

/** 管理画面: 拠点の写真ギャラリー管理（アップロード・削除・並べ替え） */
export default function PhotoManager({
  venueId,
  photos,
}: {
  venueId: string;
  photos: PhotoRow[];
}) {
  const categories: { id: string; label: string }[] = [];
  for (const p of photos) {
    if (!categories.some((c) => c.id === p.category_id)) {
      categories.push({ id: p.category_id, label: p.category_label });
    }
  }

  const [catChoice, setCatChoice] = useState(categories[0]?.id ?? "__new__");
  const [newCatLabel, setNewCatLabel] = useState("");
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload() {
    if (!files || files.length === 0) {
      setMessage({ ok: false, text: "写真を選択してください" });
      return;
    }
    const isNew = catChoice === "__new__";
    const label = isNew ? newCatLabel.trim() : (categories.find((c) => c.id === catChoice)?.label ?? "");
    if (!label) {
      setMessage({ ok: false, text: "カテゴリ名を入力してください" });
      return;
    }
    setBusy(true);
    setMessage(null);
    const form = new FormData();
    form.append("venueId", venueId);
    form.append("categoryId", isNew ? label : catChoice);
    form.append("categoryLabel", label);
    Array.from(files).forEach((f) => form.append("files", f));
    try {
      const res = await fetch("/api/admin/venue-photos", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) {
        setMessage({ ok: false, text: json.error ?? "アップロードに失敗しました" });
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setMessage({ ok: false, text: "通信エラーが発生しました" });
      setBusy(false);
    }
  }

  async function remove(photoId: string) {
    if (!confirm("この写真をギャラリーから削除しますか？")) return;
    setBusy(true);
    const res = await fetch("/api/admin/venue-photos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId }),
    });
    if (res.ok) window.location.reload();
    else {
      const json = await res.json();
      setMessage({ ok: false, text: json.error ?? "削除に失敗しました" });
      setBusy(false);
    }
  }

  async function move(photoId: string, dir: "up" | "down") {
    setBusy(true);
    const res = await fetch("/api/admin/venue-photos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoId, dir }),
    });
    if (res.ok) window.location.reload();
    else setBusy(false);
  }

  return (
    <div className="access-editor">
      <h2>写真ギャラリー</h2>
      <p className="policy">
        拠点ページのギャラリーに表示される写真です。並び順の先頭がカテゴリのメイン表示になります。
        アップロードした写真は自動で幅1600pxに圧縮されます。
      </p>

      {categories.map((cat) => (
        <div key={cat.id} className="photo-cat-block">
          <h3>
            {cat.label}（{photos.filter((p) => p.category_id === cat.id).length}枚）
          </h3>
          <div className="photo-grid">
            {photos
              .filter((p) => p.category_id === cat.id)
              .map((p, i, arr) => (
                <div key={p.id} className="photo-cell">
                  <img src={p.src} alt="" loading="lazy" />
                  <div className="photo-cell-actions">
                    <button onClick={() => move(p.id, "up")} disabled={busy || i === 0} title="前へ">
                      ←
                    </button>
                    <button
                      onClick={() => move(p.id, "down")}
                      disabled={busy || i === arr.length - 1}
                      title="後ろへ"
                    >
                      →
                    </button>
                    <button onClick={() => remove(p.id)} disabled={busy} className="danger" title="削除">
                      ✕
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
      ))}

      <div className="photo-upload-box">
        <h3>写真を追加する</h3>
        <div className="form-field">
          <label>追加先カテゴリ</label>
          <select value={catChoice} onChange={(e) => setCatChoice(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
            <option value="__new__">＋ 新しいカテゴリを作る</option>
          </select>
        </div>
        {catChoice === "__new__" && (
          <div className="form-field">
            <label>新しいカテゴリ名</label>
            <input
              type="text"
              value={newCatLabel}
              onChange={(e) => setNewCatLabel(e.target.value)}
              placeholder="例: イベント利用例"
            />
          </div>
        )}
        <div className="form-field">
          <label>写真ファイル（複数選択可・1回10枚まで）</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFiles(e.target.files)}
          />
        </div>
        <button className="submit-btn" onClick={upload} disabled={busy}>
          {busy ? "アップロード中..." : "アップロードする"}
        </button>
      </div>
      {message && <div className={`notice ${message.ok ? "success" : "error"}`}>{message.text}</div>}
    </div>
  );
}
