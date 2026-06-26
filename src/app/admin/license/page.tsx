import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getLicenseStatus, getUpgradeOptions } from "@/lib/license";

export const dynamic = "force-dynamic";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

export default async function LicensePage() {
  if (!(await isAdmin())) redirect("/admin/login");

  let status, upgrades, errorMsg: string | null = null;
  try {
    status = await getLicenseStatus();
    upgrades = getUpgradeOptions(status.max_venues);
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
      <div className="admin-header" style={{ marginBottom: "1.5rem" }}>
        <h1>ライセンス管理</h1>
        <Link href="/admin" className="policy">← ダッシュボードに戻る</Link>
      </div>

      {errorMsg && (
        <div style={{
          padding: "1rem",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 8,
          marginBottom: "1.5rem",
          color: "#991b1b",
        }}>
          <strong>エラー:</strong> {errorMsg}
          <p style={{ marginTop: 8, fontSize: 13 }}>
            migration 0013_license_limits.sql が Supabase に適用されていない可能性があります。
            Supabase SQL Editor で該当ファイルを実行してください。
          </p>
        </div>
      )}

      {status && (
        <>
          {/* 現状サマリ */}
          <section style={{
            background: "#fff",
            border: "1px solid #e5e7eb",
            borderRadius: 12,
            padding: "1.5rem",
            marginBottom: "1.5rem",
          }}>
            <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 4 }}>
              現在のプラン
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 16 }}>
              {status.plan_label}
            </div>

            <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>使用中の拠点</div>
                <div style={{ fontSize: 28, fontWeight: 700 }}>
                  {status.used}<span style={{ fontSize: 16, color: "#6b7280" }}> / {status.max_venues}</span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "#6b7280" }}>残ライセンス枠</div>
                <div style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: status.remaining > 0 ? "#15803d" : "#b45309",
                }}>
                  {status.remaining}
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 8 }}>使用状況</div>
                <div style={{
                  height: 10,
                  background: "#f3f4f6",
                  borderRadius: 999,
                  overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%",
                    width: `${Math.min(100, (status.used / status.max_venues) * 100)}%`,
                    background: status.remaining === 0 ? "#dc2626" : "#1e4d8c",
                    transition: "width 0.3s",
                  }} />
                </div>
              </div>
            </div>

            {status.remaining === 0 && (
              <div style={{
                marginTop: 16,
                padding: 12,
                background: "#fef3c7",
                border: "1px solid #fcd34d",
                borderRadius: 6,
                fontSize: 13,
                color: "#92400e",
              }}>
                ⚠️ ライセンス枠を使い切っています。新しい拠点を追加するには下のプランへアップグレードしてください。
              </div>
            )}
          </section>

          {/* アップグレード候補 */}
          {upgrades && upgrades.length > 0 && (
            <section>
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>
                利用可能なアップグレード
              </h2>
              <div style={{ display: "grid", gap: 12 }}>
                {upgrades.map((u) => (
                  <div key={u.to_plan} style={{
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    padding: "1rem 1.25rem",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "1rem",
                  }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{u.to_label}</div>
                      <div style={{ fontSize: 13, color: "#6b7280", marginTop: 2 }}>
                        最大 {u.to_max_venues} 部屋まで利用可能
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>差額（一括）</div>
                      <div style={{ fontSize: 22, fontWeight: 700, color: "#1e4d8c" }}>
                        {yen(u.price_diff)}
                      </div>
                      <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4 }}>
                        ※ 決済機能は近日リリース
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{
                marginTop: 16,
                padding: 12,
                background: "#eff6ff",
                border: "1px solid #bfdbfe",
                borderRadius: 6,
                fontSize: 13,
                color: "#1e3a8a",
              }}>
                💡 現状はライセンス変更が必要な場合、運営者（ブルーステージ合同会社）に直接ご連絡ください。
                Stripe Checkout 経由のセルフ決済は次フェーズで実装予定です。
              </div>
            </section>
          )}

          {(!upgrades || upgrades.length === 0) && (
            <section style={{
              background: "#f0fdf4",
              border: "1px solid #86efac",
              borderRadius: 12,
              padding: "1rem 1.25rem",
              fontSize: 14,
              color: "#166534",
            }}>
              ✓ 最上位プランをご利用中です。さらに多くの拠点が必要な場合は個別お見積もりします。
            </section>
          )}
        </>
      )}
    </div>
  );
}
