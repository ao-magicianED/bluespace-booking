import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { listPriceActions, VENUE_PRICING_POLICY, type Channel, type PriceActionStatus } from "@/lib/price-actions";
import AdminPriceActionForm from "@/components/AdminPriceActionForm";
import AdminPriceActionResultForm from "@/components/AdminPriceActionResultForm";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<Channel, string> = {
  instabase: "インスタベース",
  spacemarket: "スペースマーケット",
  upnow: "UPNOW",
  own: "自社サイト",
};
const STATUS_LABEL: Record<PriceActionStatus, string> = {
  draft: "指示のみ",
  applied: "設定済み",
  reverted: "定価に復帰",
  expired: "未実施のまま終了",
};
const STATUS_CLASS: Record<PriceActionStatus, string> = {
  draft: "st-pending",
  applied: "st-confirmed",
  reverted: "st-cancelled",
  expired: "st-cancelled",
};

function hourLabel(h: number): string {
  return Number.isInteger(h) ? `${h}:00` : `${Math.floor(h)}:30`;
}

export default async function AdminPriceActionsPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const db = getDb();
  const { data: venueRows } = await db
    .from("venues")
    .select("slug, name")
    .eq("active", true)
    .order("name");
  const venues = (venueRows ?? []) as { slug: string; name: string }[];

  const formVenues = venues
    .filter((v) => v.slug in VENUE_PRICING_POLICY)
    .map((v) => ({ ...v, ...VENUE_PRICING_POLICY[v.slug] }));

  let actions: Awaited<ReturnType<typeof listPriceActions>> = [];
  let error: string | null = null;
  try {
    actions = await listPriceActions();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <>
      <div className="admin-header">
        <h1>価格指示・実施台帳</h1>
        <Link href="/admin" className="policy">
          ← 管理ダッシュボードへ戻る
        </Link>
      </div>
      <p className="policy">
        週次の価格指示（どの拠点・どの枠を・何円にするか）と、スタッフが実際に設定した結果をここに記録します。
        平日のみ・拠点別下限価格は保存時に自動チェックされます（土日祝・下限割れは保存できません）。
        効果測定には「比較用の保護枠」も併せて記録してください。
      </p>

      {error && <div className="notice error">取得エラー: {error}</div>}

      <h2 className="analytics-h">拠点別の下限価格（ガードレール）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>拠点</th>
              <th>下限価格</th>
              <th>備考</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(VENUE_PRICING_POLICY).map(([slug, p]) => (
              <tr key={slug}>
                <td>{p.label}</td>
                <td>{p.floorPrice}円/h</td>
                <td>{p.requiresIsolatedSlot ? "孤立1時間枠のみ（曜日単位の値下げ禁止）" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AdminPriceActionForm venues={formVenues} />

      <h2 className="analytics-h">価格指示・実施履歴（直近200件）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>対象日</th>
              <th>拠点</th>
              <th>時間帯</th>
              <th>チャネル</th>
              <th>変更前→指示</th>
              <th>保護枠</th>
              <th>状態</th>
              <th>結果記録</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id}>
                <td>{a.target_date}</td>
                <td>{a.venues?.name?.replace("ブルースペース", "") ?? "—"}</td>
                <td>
                  {hourLabel(a.start_hour)}〜{hourLabel(a.end_hour)}
                </td>
                <td>{CHANNEL_LABEL[a.channel]}</td>
                <td>
                  {a.previous_price != null ? `¥${a.previous_price.toLocaleString()}` : "未確認"} →{" "}
                  ¥{a.planned_price.toLocaleString()}
                  {a.applied_price != null && (
                    <>
                      <br />
                      <span className="policy">実施: ¥{a.applied_price.toLocaleString()}</span>
                    </>
                  )}
                </td>
                <td>{a.is_holdout ? "✅" : "—"}</td>
                <td>
                  <span className={`status-badge ${STATUS_CLASS[a.status]}`}>{STATUS_LABEL[a.status]}</span>
                </td>
                <td>
                  {a.status === "draft" || a.status === "applied" ? (
                    <AdminPriceActionResultForm id={a.id} defaultPrice={a.planned_price} />
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
            {actions.length === 0 && (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", color: "var(--gray-text)" }}>
                  価格指示はまだありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
