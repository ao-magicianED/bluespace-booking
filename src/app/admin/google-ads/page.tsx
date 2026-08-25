import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { missingConfig } from "@/lib/google-ads";
import ConversionUploader from "./ConversionUploader";

export const dynamic = "force-dynamic";

/**
 * 管理画面: Google広告のコンバージョン取り込み（CSV手動運用）。
 *
 * APIの開発者トークンは審査に数日〜数週間かかる。
 * その間もコンバージョンを欠測させないための手動経路。
 * 環境変数が揃えば毎日のCronが自動送信するので、このページは使わなくなる。
 */
export default async function AdminGoogleAdsPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const missing = missingConfig();
  const apiReady = missing.length === 0;

  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <div className="admin-header" style={{ marginBottom: "1.5rem" }}>
        <h1>Google広告 コンバージョン取り込み</h1>
        <Link href="/admin" className="policy">← ダッシュボードに戻る</Link>
      </div>

      <section
        style={{
          background: apiReady ? "#ecfdf5" : "#fffbeb",
          border: `1px solid ${apiReady ? "#a7f3d0" : "#fde68a"}`,
          borderRadius: 12,
          padding: "1rem 1.25rem",
          marginBottom: "1.5rem",
          fontSize: 14,
        }}
      >
        {apiReady ? (
          <>
            <strong>API連携は設定済みです。</strong>
            <p style={{ margin: "6px 0 0" }}>
              毎日 JST 7:00 のCronが自動で送信します。通常このページを使う必要はありません。
            </p>
          </>
        ) : (
          <>
            <strong>API連携はまだ設定されていません。</strong>
            <p style={{ margin: "6px 0 0" }}>
              開発者トークンの審査が終わるまでは、下のCSV手順で取り込んでください。
            </p>
            <p style={{ margin: "6px 0 0", fontSize: 12, color: "#92400e" }}>
              未設定: {missing.join(", ")}
            </p>
          </>
        )}
      </section>

      <ConversionUploader />

      <section style={{ marginTop: "2rem", fontSize: 13, color: "#6b7280", lineHeight: 1.8 }}>
        <h2 style={{ fontSize: 15, color: "#111827" }}>なぜ2段階なのか</h2>
        <p style={{ margin: "6px 0 0" }}>
          「送信済み」にした予約は次回から抽出されません。
          先にマークするとアップロードに失敗したとき永久に欠測するので、
          <strong>Google広告に取り込めたことを確認してから</strong>マークします。
        </p>
        <p style={{ margin: "6px 0 0" }}>
          マークするのは、いまダウンロードしたCSVに入っていた予約だけです。
          その間に確定した新しい予約は次回に回ります。
        </p>
      </section>
    </div>
  );
}
