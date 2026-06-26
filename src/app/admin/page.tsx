import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { formatBookingPeriod } from "@/lib/confirm";
import { jstToUtc, todayJst } from "@/lib/slots";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "決済待ち",
  confirmed: "確定",
  cancelled: "キャンセル",
  expired: "期限切れ",
};

type Row = Booking & { venues: { name: string } | null };

const FILTERS = [
  { key: "upcoming", label: "今後の予約" },
  { key: "confirmed", label: "確定すべて" },
  { key: "pending", label: "決済待ち" },
  { key: "cancelled", label: "キャンセル" },
  { key: "all", label: "全件" },
] as const;

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; q?: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");
  const { f = "upcoming", q = "" } = await searchParams;

  const db = getDb();
  const nowIso = new Date().toISOString();

  // 一覧クエリ（フィルタ別）
  let query = db.from("bookings").select("*, venues(name)").limit(100);
  switch (f) {
    case "upcoming":
      query = query.eq("booking_status", "confirmed").gt("end_at", nowIso).order("start_at", { ascending: true });
      break;
    case "confirmed":
      query = query.eq("booking_status", "confirmed").order("start_at", { ascending: false });
      break;
    case "pending":
      query = query.eq("booking_status", "pending").order("created_at", { ascending: false });
      break;
    case "cancelled":
      query = query.eq("booking_status", "cancelled").order("cancelled_at", { ascending: false });
      break;
    default:
      query = query.order("created_at", { ascending: false });
  }
  if (q.trim()) {
    const esc = q.trim().replaceAll("%", "").replaceAll(",", "");
    query = query.or(`customer_name.ilike.%${esc}%,customer_email.ilike.%${esc}%`);
  }
  const { data: rows, error } = await query;

  // 統計: 今後の確定件数 / 今月の確定売上 / 同期失敗
  const monthStart = jstToUtc(todayJst().slice(0, 8) + "01", 0).toISOString();
  const [upcomingRes, monthRes, failedRes] = await Promise.all([
    db.from("bookings").select("id", { count: "exact", head: true }).eq("booking_status", "confirmed").gt("end_at", nowIso),
    db.from("bookings").select("total_amount, refunded_amount").eq("booking_status", "confirmed").gte("start_at", monthStart),
    db.from("bookings").select("*, venues(name)").eq("booking_status", "confirmed").eq("calendar_sync_status", "failed").gt("end_at", nowIso),
  ]);
  const monthSales = (monthRes.data ?? []).reduce((s, b) => s + b.total_amount - (b.refunded_amount ?? 0), 0);
  const failed = (failedRes.data ?? []) as Row[];

  return (
    <>
      <div className="admin-header">
        <h1>管理ダッシュボード</h1>
        <span>
          <Link href="/admin/analytics" className="policy">📈 分析</Link>
          {"　"}
          <Link href="/admin/ledger" className="policy">📒 予約台帳・CSV</Link>
          {"　"}
          <Link href="/admin/venues" className="policy">🏢 拠点情報の編集（写真・FAQ・入退室案内）</Link>
          {"　"}
          <Link href="/admin/license" className="policy">🔑 ライセンス管理</Link>
          {"　"}
          <Link href="/" className="policy">← サイトを見る</Link>
        </span>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <span className="stat-label">今後の確定予約</span>
          <span className="stat-value">{upcomingRes.count ?? 0}件</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">今月の確定売上（返金控除後）</span>
          <span className="stat-value">¥{monthSales.toLocaleString()}</span>
        </div>
        <div className={`stat-card ${failed.length > 0 ? "stat-alert" : ""}`}>
          <span className="stat-label">カレンダー同期失敗</span>
          <span className="stat-value">{failed.length}件</span>
        </div>
      </div>

      {failed.length > 0 && (
        <div className="notice error">
          <strong>⚠️ カレンダー未登録の確定予約があります（外部サイトと二重予約の恐れ）:</strong>
          <ul style={{ margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
            {failed.map((b) => (
              <li key={b.id}>
                <Link href={`/admin/bookings/${b.id}`}>
                  {b.venues?.name} {formatBookingPeriod(b)}（{b.customer_name}様）→ 詳細から再同期
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="admin-filters">
        {FILTERS.map((x) => (
          <Link
            key={x.key}
            href={`/admin?f=${x.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
            className={`gallery-tab ${f === x.key ? "active" : ""}`}
          >
            {x.label}
          </Link>
        ))}
        <form method="GET" action="/admin" className="admin-search">
          <input type="hidden" name="f" value={f} />
          <input type="text" name="q" defaultValue={q} placeholder="名前・メールで検索" />
          <button type="submit">検索</button>
        </form>
      </div>

      {error && <div className="notice error">取得エラー: {error.message}</div>}

      <div className="grid-wrapper">
        <table className="admin-table">
          <thead>
            <tr>
              <th>利用日時</th>
              <th>拠点</th>
              <th>お客様</th>
              <th>金額</th>
              <th>状態</th>
              <th>同期</th>
            </tr>
          </thead>
          <tbody>
            {((rows ?? []) as Row[]).map((b) => (
              <tr key={b.id}>
                <td>
                  <Link href={`/admin/bookings/${b.id}`}>{formatBookingPeriod(b)}</Link>
                </td>
                <td>{b.venues?.name?.replace("ブルースペース", "") ?? ""}</td>
                <td>
                  {b.customer_name}
                  <br />
                  <span className="policy">{b.customer_email}</span>
                </td>
                <td>
                  ¥{b.total_amount.toLocaleString()}
                  {(b.refunded_amount ?? 0) > 0 && (
                    <>
                      <br />
                      <span className="policy">返金 ¥{b.refunded_amount.toLocaleString()}</span>
                    </>
                  )}
                </td>
                <td>
                  <span className={`status-badge st-${b.booking_status}`}>
                    {STATUS_LABEL[b.booking_status] ?? b.booking_status}
                  </span>
                </td>
                <td>
                  {b.booking_status === "confirmed"
                    ? b.calendar_sync_status === "synced"
                      ? "✅"
                      : b.calendar_sync_status === "failed"
                        ? "🚨"
                        : "—"
                    : "—"}
                </td>
              </tr>
            ))}
            {(rows ?? []).length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--gray-text)" }}>
                  該当する予約はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
