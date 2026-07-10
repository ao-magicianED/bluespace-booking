import { NextResponse } from "next/server";
import iconv from "iconv-lite";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { computeRepeatNumbers, formatMemberNo, realizedRevenue } from "@/lib/ledger";
import type { Booking } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  pending: "決済待ち",
  confirmed: "確定",
  cancelled: "キャンセル",
  expired: "期限切れ",
};

function jst(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });
}

/** CSVフィールドのエスケープ（カンマ・改行・引用符対応） */
function esc(v: string | number | null | undefined): string {
  const s = String(v ?? "");
  if (/[",\r\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

/**
 * GET /api/admin/ledger-csv — 予約台帳の全件CSVダウンロード（Shift_JIS / Excel対応）。
 * リピート回数（同一メールの確定予約を利用日順にカウント）と会員番号を含む。
 */
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  const db = getDb();
  const [{ data: bookings }, { data: members }] = await Promise.all([
    db
      .from("bookings")
      .select("*, venues(name)")
      .order("start_at", { ascending: false })
      .limit(5000),
    db.from("member_profiles").select("user_id, member_no"),
  ]);
  const rows = (bookings ?? []) as (Booking & { venues: { name: string } | null })[];
  const memberByUser = new Map((members ?? []).map((m) => [m.user_id, m.member_no as number]));
  const repeat = computeRepeatNumbers(rows);

  const header = [
    "予約番号",
    "状態",
    "利用開始",
    "利用終了",
    "拠点",
    "お名前",
    "会社名",
    "区分",
    "会員番号",
    "メール",
    "電話",
    "人数",
    "利用目的",
    "リピート回数",
    "全予約回数",
    "確定予約回数",
    "キャンセル回数",
    "支払方法",
    "当初金額",
    "調整後金額",
    "返金額",
    "実収額",
    "クーポン",
    "申込日時",
    "キャンセル日時",
    "決済参照ID",
    "予約ID",
  ];

  const lines = [header.map(esc).join(",")];
  for (const b of rows) {
    const rep = repeat.get(b.id);
    lines.push(
      [
        b.id.replace(/-/g, "").slice(-8).toUpperCase(),
        STATUS_LABEL[b.booking_status] ?? b.booking_status,
        jst(b.start_at),
        jst(b.end_at),
        b.venues?.name ?? "",
        b.customer_name,
        b.company_name ?? "",
        b.customer_type === "corporate" ? "法人" : "個人",
        b.user_id ? formatMemberNo(memberByUser.get(b.user_id)) : "",
        b.customer_email,
        b.customer_phone,
        b.party_size ?? "",
        b.purpose ?? "",
        rep && rep.seq > 0 ? `${rep.seq}回目/計${rep.total}回` : "",
        rep ? rep.totalAll : "",
        rep ? rep.total : "",
        rep ? rep.cancelled : "",
        b.payment_method === "invoice" ? "請求書払い" : "クレジットカード",
        b.total_amount,
        b.adjusted_total != null ? b.adjusted_total : "",
        b.refunded_amount ?? 0,
        realizedRevenue(b),
        b.coupon_code ?? "",
        jst(b.created_at),
        jst(b.cancelled_at),
        b.stripe_payment_intent_id ?? b.stripe_invoice_id ?? "",
        b.id,
      ]
        .map(esc)
        .join(",")
    );
  }

  const csv = lines.join("\r\n");
  const body = iconv.encode(csv, "Shift_JIS");
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replaceAll("-", "");
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": "text/csv; charset=Shift_JIS",
      "Content-Disposition": `attachment; filename="bluespace-ledger-${today}.csv"`,
    },
  });
}
