"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** 管理画面のレビュー操作（承認・非公開・運営返信） */
export default function AdminReviewActions({
  reviewId,
  status,
  hostReply,
}: {
  reviewId: string;
  status: "pending" | "published" | "rejected";
  hostReply: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showReply, setShowReply] = useState(false);
  const [reply, setReply] = useState(hostReply ?? "");

  async function act(action: "publish" | "reject" | "reply") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewId, action, reply: action === "reply" ? reply : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "操作に失敗しました");
        return;
      }
      setShowReply(false);
      router.refresh();
    } catch {
      setError("通信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-review-actions">
      {status !== "published" && (
        <button type="button" disabled={busy} onClick={() => act("publish")}>
          ✅ 公開する
        </button>
      )}
      {status !== "rejected" && (
        <button type="button" disabled={busy} onClick={() => act("reject")}>
          🚫 非公開にする
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => setShowReply((v) => !v)}>
        💬 運営返信{hostReply ? "を編集" : "を書く"}
      </button>
      {showReply && (
        <div className="admin-review-reply">
          <textarea
            value={reply}
            rows={3}
            maxLength={1000}
            onChange={(e) => setReply(e.target.value)}
            placeholder="ご利用ありがとうございました。またのお越しをお待ちしております。"
          />
          <button type="button" disabled={busy} onClick={() => act("reply")}>
            返信を保存
          </button>
        </div>
      )}
      {error && <span className="notice error">{error}</span>}
    </div>
  );
}
