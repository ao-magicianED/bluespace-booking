import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { sendAdminAlert, sendMail } from "@/lib/mail";
import { formatBookingPeriod } from "@/lib/confirm";
import { checkTimeSlotAvailable } from "@/lib/change-request";
import { applyApprovedTimeChange } from "@/lib/apply-time-change";
import type { Booking, BookingChangeRequest, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/decide-change-request
 * pendingの変更申請（お客様の短縮/時間ずらし申請）を承認/却下する。
 * 承認時: 申請作成時刻基準の料金スナップショットをそのまま適用、再度排他チェック。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { changeRequestId?: string; action?: string; adminNote?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const changeRequestId = body.changeRequestId ?? "";
  const action = body.action === "reject" ? "reject" : "approve";
  const adminNote = (body.adminNote ?? "").trim();

  if (!/^[0-9a-f-]{36}$/.test(changeRequestId)) {
    return NextResponse.json({ error: "申請IDが不正です" }, { status: 400 });
  }

  const db = getDb();
  const { data: cr } = await db
    .from("booking_change_requests")
    .select("*")
    .eq("id", changeRequestId)
    .maybeSingle<BookingChangeRequest>();
  if (!cr) return NextResponse.json({ error: "申請が見つかりません" }, { status: 404 });
  if (cr.status !== "pending") {
    return NextResponse.json({ error: `この申請は既に処理済みです（${cr.status}）` }, { status: 400 });
  }
  if (cr.request_type !== "self_modify") {
    return NextResponse.json({ error: "この申請は承認制ではありません" }, { status: 400 });
  }

  const { data: booking } = await db
    .from("bookings")
    .select("*")
    .eq("id", cr.booking_id)
    .maybeSingle<Booking>();
  if (!booking) return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  // 却下はいつでも可能にする（予約がキャンセル済みでも、放置されたpending申請を
  // 却下できないと管理画面から消せなくなるため）。時間反映を伴う承認のみ制限する。
  if (action === "approve" && booking.booking_status !== "confirmed") {
    return NextResponse.json(
      { error: `確定済みの予約のみ承認できます（現在: ${booking.booking_status}）` },
      { status: 400 }
    );
  }
  const { data: venue } = await db
    .from("venues")
    .select("*")
    .eq("id", booking.venue_id)
    .single<Venue>();
  if (!venue) return NextResponse.json({ error: "拠点情報が取得できません" }, { status: 500 });

  const now = new Date();

  if (action === "reject") {
    await db
      .from("booking_change_requests")
      .update({
        status: "rejected",
        decided_at: now.toISOString(),
        decided_by: "admin",
        admin_note: adminNote,
      })
      .eq("id", changeRequestId);

    await sendMail({
      to: booking.customer_email,
      subject: `【予約変更申請の結果】${venue.name}`,
      text: [
        `${booking.customer_name} 様`,
        "",
        "申し訳ございません。お申し込みいただいた予約時間の変更は、下記理由により承認できませんでした。",
        "",
        `▼申請内容`,
        `スペース: ${venue.name}`,
        `現在の予約: ${formatBookingPeriod(booking)}`,
        `ご希望: ${formatBookingPeriod({ start_at: cr.requested_start_at, end_at: cr.requested_end_at })}`,
        "",
        `▼却下理由`,
        adminNote || "(理由なし)",
        "",
        "現在のご予約は変更されておりません。ご不明な点はお問い合わせください。",
        "",
        "ブルーステージ合同会社",
      ].join("\n"),
    });
    await sendAdminAlert(
      `予約変更申請を却下 ${venue.name}`,
      `お客様: ${booking.customer_name}\n申請ID: ${changeRequestId}\n理由: ${adminNote || "(なし)"}`
    );
    return NextResponse.json({ ok: true, action: "rejected" });
  }

  // 承認: 再度排他チェック → 適用
  const start = new Date(cr.requested_start_at);
  const end = new Date(cr.requested_end_at);

  const avail = await checkTimeSlotAvailable(
    venue.id,
    cr.booking_id,
    { start, end },
    venue.calendar_id
  );
  if (!avail.ok) {
    return NextResponse.json(
      { error: `承認時の空き状況確認に失敗: ${avail.reason}。お客様に状況をご連絡ください。` },
      { status: 409 }
    );
  }

  // 原子的にpending→approvedへ遷移（二重クリック対策）。冒頭のstatusチェックは
  // SELECT時点の値を見るだけで排他にならず、ほぼ同時に届いた2回目の承認リクエストが
  // 両方ともapplyApprovedTimeChange（金額の加算RPCを含む）まで進んで二重加算する恐れがある
  const { data: claimed, error: claimErr } = await db
    .from("booking_change_requests")
    .update({ status: "approved", decided_at: now.toISOString(), decided_by: "admin", admin_note: adminNote })
    .eq("id", changeRequestId)
    .eq("status", "pending")
    .select("id");
  if (claimErr) {
    return NextResponse.json({ error: "承認処理に失敗しました。時間をおいて再度お試しください" }, { status: 500 });
  }
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "この申請は既に処理されています" }, { status: 409 });
  }

  const applyResult = await applyApprovedTimeChange({
    bookingId: cr.booking_id,
    venue,
    booking,
    start,
    end,
    amounts: {
      newAmount: cr.new_amount,
      extraAmount: cr.extra_amount,
      refundAmount: cr.refund_amount,
    },
    reason: cr.reason || "お客様申請の時間変更",
    changeRequestId,
  });
  if (!applyResult.ok) {
    // 承認自体は既に確定している（二重クリック対策のCASを通過済み）ため、ここで
    // 申請をrejectedへ戻すことはしない。管理者アラートは既にapplyApprovedTimeChange内で
    // 送信済みなので、ここではAPIレスポンスで手動対応が必要なことだけ伝える。
    const status = applyResult.reason === "slot_conflict" ? 409 : 500;
    const error =
      applyResult.reason === "slot_conflict"
        ? "承認は記録されましたが、予約時間の反映に失敗しました（枠が埋まっている可能性）。管理者へ通知済みです。手動で確認してください。"
        : "承認は記録されましたが、予約時間の反映に失敗しました（DB更新エラー）。管理者へ通知済みです。手動で確認してください。";
    return NextResponse.json({ error }, { status });
  }

  return NextResponse.json({
    ok: true,
    action: "approved",
    refundAmount: cr.refund_amount,
  });
}
