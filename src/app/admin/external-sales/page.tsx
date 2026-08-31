import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { JST_OFFSET_MS } from "@/lib/slots";
import { PURPOSE_CATEGORIES, categorizePurpose } from "@/lib/purpose-category";
import AdminExternalImportForm from "@/components/AdminExternalImportForm";

export const dynamic = "force-dynamic";

function jstMonth(iso: string): string {
  const d = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const CHANNEL_LABEL: Record<string, string> = {
  instabase: "インスタベース",
  spacemarket: "スペースマーケット",
  upnow: "UPNOW",
};

type BatchRow = {
  id: string;
  channel: string;
  file_name: string;
  row_count: number;
  inserted_count: number;
  updated_count: number;
  unmatched_venue_count: number;
  created_at: string;
};

type SummaryRow = {
  channel: string;
  venue_id: string | null;
  gross_amount: number;
  purpose: string | null;
  start_at: string | null;
};

/** 確定分の (channel, venue_id, gross_amount, purpose, start_at) を全件ページングして取得する（Supabaseの既定上限1000行対策） */
async function fetchConfirmedSummaryRows(): Promise<SummaryRow[]> {
  const db = getDb();
  const PAGE = 1000;
  const MAX_PAGES = 30;
  const rows: SummaryRow[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    // ORDER BYなしのページングは順序が保証されず、ページ間で行の取りこぼし・二重取得が起きるため必ず並べる
    const { data, error } = await db
      .from("external_bookings")
      .select("channel, venue_id, gross_amount, purpose, start_at")
      .eq("status", "confirmed")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`外部予約の集計取得エラー: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export default async function AdminExternalSalesPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const db = getDb();
  const [{ data: batches }, { data: venueRows }] = await Promise.all([
    db
      .from("external_import_batches")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30),
    db.from("venues").select("id, name"),
  ]);
  const venueNameById = new Map((venueRows ?? []).map((v) => [v.id as string, v.name as string]));

  let summaryRows: SummaryRow[] = [];
  let summaryError: string | null = null;
  try {
    summaryRows = await fetchConfirmedSummaryRows();
  } catch (e) {
    summaryError = e instanceof Error ? e.message : String(e);
  }

  // 自社サイト分の予約も合わせて用途カテゴリ集計に含める（note月次レポート用、戦略書付録B準拠）
  const { data: ownRows } = await db
    .from("bookings")
    .select("purpose, start_at")
    .eq("booking_status", "confirmed");

  const byMonthCategory = new Map<string, Map<string, number>>();
  const addPurpose = (startAt: string | null, purpose: string | null) => {
    if (!startAt) return;
    const month = jstMonth(startAt);
    const category = categorizePurpose(purpose);
    const monthMap = byMonthCategory.get(month) ?? new Map<string, number>();
    monthMap.set(category, (monthMap.get(category) ?? 0) + 1);
    byMonthCategory.set(month, monthMap);
  };
  for (const r of summaryRows) addPurpose(r.start_at, r.purpose);
  for (const r of ownRows ?? []) addPurpose(r.start_at as string, r.purpose as string);
  const purposeMonths = [...byMonthCategory.keys()].sort().slice(-6); // 直近6ヶ月

  const byChannel = new Map<string, { count: number; gross: number }>();
  const byVenueChannel = new Map<string, { count: number; gross: number }>();
  for (const r of summaryRows) {
    const c = byChannel.get(r.channel) ?? { count: 0, gross: 0 };
    c.count++;
    c.gross += r.gross_amount;
    byChannel.set(r.channel, c);

    const venueLabel = r.venue_id ? (venueNameById.get(r.venue_id) ?? "不明") : "未マッチ";
    const key = `${venueLabel}__${r.channel}`;
    const v = byVenueChannel.get(key) ?? { count: 0, gross: 0 };
    v.count++;
    v.gross += r.gross_amount;
    byVenueChannel.set(key, v);
  }

  return (
    <>
      <div className="admin-header">
        <h1>外部モール予約の取込・集計</h1>
        <Link href="/admin" className="policy">
          ← 管理ダッシュボードへ戻る
        </Link>
      </div>
      <p className="policy">
        インスタベース・スペースマーケット・UPNOWの予約データを蓄積します。手動エクスポートしたCSVを
        アップロードしてください（週1回程度を想定）。取り込んだデータは価格施策の効果測定に使います。
      </p>

      <AdminExternalImportForm />

      <h2 className="analytics-h">チャネル別サマリ（確定分・全期間）</h2>
      {summaryError && <div className="notice error">取得エラー: {summaryError}</div>}
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>チャネル</th>
              <th>確定件数</th>
              <th>表示額合計</th>
            </tr>
          </thead>
          <tbody>
            {Object.keys(CHANNEL_LABEL).map((ch) => {
              const s = byChannel.get(ch);
              return (
                <tr key={ch}>
                  <td>{CHANNEL_LABEL[ch]}</td>
                  <td>{s?.count ?? 0}件</td>
                  <td>¥{(s?.gross ?? 0).toLocaleString()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">拠点×チャネル別サマリ（確定分・全期間）</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>拠点</th>
              <th>チャネル</th>
              <th>確定件数</th>
              <th>表示額合計</th>
            </tr>
          </thead>
          <tbody>
            {Array.from(byVenueChannel.entries())
              .sort((a, b) => b[1].gross - a[1].gross)
              .map(([key, s]) => {
                const [venueLabel, ch] = key.split("__");
                return (
                  <tr key={key}>
                    <td>{venueLabel.replace("ブルースペース", "")}</td>
                    <td>{CHANNEL_LABEL[ch] ?? ch}</td>
                    <td>{s.count}件</td>
                    <td>¥{s.gross.toLocaleString()}</td>
                  </tr>
                );
              })}
            {byVenueChannel.size === 0 && (
              <tr>
                <td colSpan={4} style={{ textAlign: "center", color: "var(--gray-text)" }}>
                  取込データはまだありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">月次・用途カテゴリ集計（直近6ヶ月・自社+外部モール合算）</h2>
      <p className="policy">
        note月次レポート「よくある利用シーン」向けの集計です(docs/media-disclosure-strategy.md 付録B準拠)。
        公開前に必ず、拠点×カテゴリの組み合わせが月間3件未満でないか確認し、該当する場合は「その他・未分類」に統合してください。
        固有名詞(社名・イベント名・個人名)は本表・note記事のいずれにも一切記載しないでください。
      </p>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>月</th>
              {PURPOSE_CATEGORIES.map((c) => (
                <th key={c}>{c}</th>
              ))}
              <th>合計</th>
            </tr>
          </thead>
          <tbody>
            {purposeMonths.map((m) => {
              const monthMap = byMonthCategory.get(m) ?? new Map<string, number>();
              const total = [...monthMap.values()].reduce((s, n) => s + n, 0);
              return (
                <tr key={m}>
                  <td>{m}</td>
                  {PURPOSE_CATEGORIES.map((c) => (
                    <td key={c}>{monthMap.get(c) ?? 0}件</td>
                  ))}
                  <td>{total}件</td>
                </tr>
              );
            })}
            {purposeMonths.length === 0 && (
              <tr>
                <td colSpan={PURPOSE_CATEGORIES.length + 2} style={{ textAlign: "center", color: "var(--gray-text)" }}>
                  データがありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className="analytics-h">取込履歴</h2>
      <div className="ledger-wrap">
        <table className="ledger-table">
          <thead>
            <tr>
              <th>日時</th>
              <th>チャネル</th>
              <th>ファイル名</th>
              <th>件数</th>
              <th>新規/更新</th>
              <th>拠点未マッチ</th>
            </tr>
          </thead>
          <tbody>
            {((batches ?? []) as BatchRow[]).map((b) => (
              <tr key={b.id}>
                <td>{new Date(b.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}</td>
                <td>{CHANNEL_LABEL[b.channel] ?? b.channel}</td>
                <td>{b.file_name}</td>
                <td>{b.row_count}件</td>
                <td>
                  {b.inserted_count}/{b.updated_count}
                </td>
                <td>{b.unmatched_venue_count > 0 ? `⚠️${b.unmatched_venue_count}件` : "—"}</td>
              </tr>
            ))}
            {(batches ?? []).length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", color: "var(--gray-text)" }}>
                  取込履歴はまだありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
