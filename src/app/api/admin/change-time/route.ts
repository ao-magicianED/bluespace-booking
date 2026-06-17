import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { sendAdminAlert, sendMail } from "@/lib/mail";
import { formatBookingPeriod } from "@/lib/confirm";
import {
  validateTimeRange,
  checkTimeSlotAvailable,
  calcChangeAmounts,
} from "@/lib/change-request";
import { updateBookingEventTime } from "@/lib/google-calendar";
import { effectiveTotal, collectPaymentIntents, refundFromPaymentIntents } from "@/lib/adjustment";
import { getStripe } from "@/lib/stripe";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/change-time
 * 管理者による予約時間の即時変更。料金差額があれば自動で返金 or 追加請求リンク発行。
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { bookingId?: string; startAt?: string; endAt?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const bookingId = body.bookingId ?? "";
  const startAtIso = body.startAt ?? "";
  const endAtIso = body.endAt ?? "";
  const reason = (body.reason ?? "").trim();

  if (!/^[0-9a-f-]{36}$/.test(bookingId)) {
    return NextResponse.json({ error: "予約IDが不正です" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "変更理由を入力してください" }, { status: 400 });
  }
  const start = new Date(startAtIso);
  const end = new Date(endAtIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return NextResponse.json({ error: "日時の形式が不正です" }, { status: 400 });
  }

  const db = getDb();
  const { data: booking } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (!booking) return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });
  if (booking.booking_status !== "confirmed" || booking.payment_status === "refunded") {
    return NextResponse.json({ error: "確定済みの予約のみ変更できます" }, { status: 400 });
  }

  const { data: venue } = await db
    .from("venues")
    .select("*")
    .eq("id", booking.venue_id)
    .single<Venue>();
  if (!venue) return NextResponse.json({ error: "拠点情報が取得できません" }, { status: 500 });

  // 営業時間・最小最大時間の検証
  const vr = validateTimeRange(venue, start, end);
  if (!vr.ok) return NextResponse.json({ error: vr.reason }, { status: 400 });

  const previous = { start: new Date(booking.start_at), end: new Date(booking.end_at) };
  if (previous.start.getTime() === start.getTime() && previous.end.getTime() === end.getTime()) {
    return NextResponse.json({ error: "現在の時間と同じです" }, { status: 400 });
  }

  // 重複申請チェック
  const { data: activeReq } = await db
    .from("booking_change_requests")
    .select("id")
    .eq("booking_id", bookingId)
    .in("status", ["pending", "pending_payment"])
    .maybeSingle();
  if (activeReq) {
    return NextResponse.json({ error: "処理中の変更申請があります。先にそちらを処理してください。" }, { status: 409 });
  }

  // 空き状況チェック
  const avail = await checkTimeSlotAvailable(
    venue.id,
    bookingId,
    { start, end },
    venue.calendar_id
  );
  if (!avail.ok) return NextResponse.json({ error: avail.reason }, { status: 409 });

  const now = new Date();
  const amounts = calcChangeAmounts(booking, venue, previous, { start, end }, now);
  const currentEffective = effectiveTotal(booking);

  // 監査ログ用 change_request 作成（admin_modify, approved として記録）
  const { data: cr, error: crErr } = await db
    .from("booking_change_requests")
    .insert({
      booking_id: bookingId,
      request_type: "admin_modify",
      previous_start_at: booking.start_at,
      previous_end_at: booking.end_at,
      requested_start_at: start.toISOString(),
      requested_end_at: end.toISOString(),
      previous_amount: currentEffective,
      new_amount: amounts.newAmount,
      refund_amount: amounts.refundAmount,
      extra_amount: amounts.extraAmount,
      cancel_fee_basis_at: now.toISOString(),
      status: "approved",
      reason,
      decided_at: now.toISOString(),
      decided_by: "admin",
    })
    .select("id")
    .single();
  if (crErr) {
    return NextResponse.json({ error: `変更申請の記録に失敗しました: ${crErr.message}` }, { status: 500 });
  }

  // 増額がある場合: 即時カレンダー更新せず、Checkoutを発行（決済完了で確定）
  if (amounts.extraAmount > 0) {
    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://bluespacerental.com";
    const period = formatBookingPeriod({ start_at: start.toISOString(), end_at: end.toISOString() });
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        currency: "jpy",
        line_items: [
          {
            price_data: {
              currency: "jpy",
              unit_amount: amounts.extraAmount,
              product_data: {
                name: `予約時間延長 ${venue.name}`,
                description: `${formatBookingPeriod(booking)} → ${period}（差額¥${amounts.extraAmount.toLocaleString()}）`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          change_request_id: (cr as { id: string }).id,
          booking_id: bookingId,
        },
        customer_email: booking.customer_email,
        success_url: `${baseUrl}/my/${bookingId}?changed=1`,
        cancel_url: `${baseUrl}/my/${bookingId}`,
        expires_at: Math.floor(Date.now() / 1000) + 72 * 60 * 60,
      },
      { idempotencyKey: `cr-admin-${(cr as { id: string }).id}` }
    );

    // 状態: pending_payment に戻して、Checkout完了Webhookで approved → 反映
    await db
      .from("booking_change_requests")
      .update({
        status: "pending_payment",
        stripe_session_id: session.id,
        decided_at: null,
      })
      .eq("id", (cr as { id: string }).id);

    // お客様にメール送付
    await sendMail({
      to: booking.customer_email,
      subject: `【予約時間変更のご案内】${venue.name}`,
      text: [
        `${booking.customer_name} 様`,
        "",
        "ご予約時間の変更を管理者が手続き中です。下記より追加料金のお支払いをお願いいたします。",
        "",
        `▼変更内容`,
        `スペース: ${venue.name}`,
        `変更前: ${formatBookingPeriod(booking)}`,
        `変更後: ${period}`,
        `追加お支払い額: ¥${amounts.extraAmount.toLocaleString()}`,
        `理由: ${reason}`,
        "",
        `▼お支払いはこちら`,
        session.url ?? "",
        "",
        "※お支払い期限: 72時間以内",
        "※期限を過ぎると変更は無効になります（元の時間のままです）。",
        "",
        "ブルーステージ合同会社",
      ].join("\n"),
    });
    await sendAdminAlert(
      `予約時間変更（追加請求）${venue.name}`,
      `${formatBookingPeriod(booking)} → ${period}\n追加¥${amounts.extraAmount.toLocaleString()}\nお客様にお支払いリンクを送信しました。`
    );
    return NextResponse.json({
      ok: true,
      type: "pending_payment",
      checkoutUrl: session.url,
      changeRequestId: (cr as { id: string }).id,
    });
  }

  // 増額なしのケース（短縮・時間ずらしで差額0、または減額）→ 即時反映
  await applyApprovedTimeChange({
    bookingId,
    venue,
    booking,
    start,
    end,
    amounts,
    reason,
    changeRequestId: (cr as { id: string }).id,
  });

  return NextResponse.json({
    ok: true,
    type: "applied",
    refundAmount: amounts.refundAmount,
    changeRequestId: (cr as { id: string }).id,
  });
}

/**
 * 時間変更を確定反映する（カレンダー更新・DB更新・必要なら返金・通知）。
 * Checkout完了Webhook、管理者の即時反映、自動承認、いずれからも呼ばれる。
 */
export async function applyApprovedTimeChange(params: {
  bookingId: string;
  venue: Venue;
  booking: Booking;
  start: Date;
  end: Date;
  amounts: { newAmount: number; extraAmount: number; refundAmount: number };
  reason: string;
  changeRequestId: string;
}): Promise<void> {
  const { bookingId, venue, booking, start, end, amounts, reason, changeRequestId } = params;
  const db = getDb();
  const now = new Date();
  const currentEffective = effectiveTotal(booking);

  // bookings 更新
  const updates: Record<string, unknown> = {
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    updated_at: now.toISOString(),
  };
  if (amounts.newAmount !== currentEffective) {
    updates.adjusted_total = amounts.newAmount;
  }

  let actuallyRefunded = 0;
  let refundRemaining = 0;
  let refundId: string | null = null;
  if (amounts.refundAmount > 0) {
    const pis = await collectPaymentIntents(
      bookingId,
      booking.stripe_payment_intent_id,
      booking.stripe_invoice_id,
      db
    );
    if (pis.length > 0) {
      try {
        const r = await refundFromPaymentIntents(
          pis,
          amounts.refundAmount,
          `cr-${changeRequestId}`
        );
        refundId = r.refundIds[0] ?? null;
        refundRemaining = r.remainingAmount;
        actuallyRefunded = amounts.refundAmount - refundRemaining;
        updates.refunded_amount = (booking.refunded_amount ?? 0) + actuallyRefunded;
        updates.payment_status =
          (booking.refunded_amount ?? 0) + actuallyRefunded >= booking.total_amount
            ? "refunded"
            : "partially_refunded";
      } catch (e) {
        await sendAdminAlert(
          "🚨 時間変更の自動返金失敗（手動対応必要）",
          `予約ID: ${bookingId}\n返金予定額: ¥${amounts.refundAmount.toLocaleString()}\nエラー: ${String(e)}`
        );
      }
    } else {
      await sendAdminAlert(
        "⚠️ 時間変更の返金元PIなし（手動対応必要）",
        `予約ID: ${bookingId}\n返金予定額: ¥${amounts.refundAmount.toLocaleString()}`
      );
    }
  }

  await db.from("bookings").update(updates).eq("id", bookingId);

  // Googleカレンダー更新
  if (booking.calendar_event_id && venue.calendar_id) {
    try {
      await updateBookingEventTime(venue.calendar_id, booking.calendar_event_id, start, end);
    } catch (e) {
      console.error("[change-time] カレンダー更新失敗:", e);
      await sendAdminAlert(
        "⚠️ カレンダー更新失敗（時間変更）",
        `予約ID: ${bookingId}\n手動でGoogleカレンダーを修正してください。\nエラー: ${String(e)}`
      );
    }
  }

  // change_request 確定
  await db
    .from("booking_change_requests")
    .update({
      status: "approved",
      decided_at: now.toISOString(),
      stripe_refund_id: refundId,
    })
    .eq("id", changeRequestId);

  // メール通知
  const oldPeriod = formatBookingPeriod(booking);
  const newPeriod = formatBookingPeriod({ start_at: start.toISOString(), end_at: end.toISOString() });
  await sendMail({
    to: booking.customer_email,
    subject: `【予約時間変更完了】${venue.name}`,
    text: [
      `${booking.customer_name} 様`,
      "",
      "ご予約の時間が変更されました。",
      "",
      "▼変更内容",
      `スペース: ${venue.name}`,
      `変更前: ${oldPeriod}`,
      `変更後: ${newPeriod}`,
      amounts.newAmount !== currentEffective
        ? `料金: ¥${currentEffective.toLocaleString()} → ¥${amounts.newAmount.toLocaleString()}`
        : `料金: 変更なし（¥${amounts.newAmount.toLocaleString()}）`,
      actuallyRefunded > 0 ? `差額返金: ¥${actuallyRefunded.toLocaleString()}` : "",
      `理由: ${reason}`,
      "",
      actuallyRefunded > 0
        ? "ご返金はクレジットカードへ自動で行われます。明細への反映は5〜10営業日かかる場合があります。"
        : "",
      "ブルーステージ合同会社",
    ].filter(Boolean).join("\n"),
  });
  await sendAdminAlert(
    `予約時間変更完了 ${venue.name}`,
    [
      `${oldPeriod} → ${newPeriod}`,
      amounts.newAmount !== currentEffective
        ? `料金: ¥${currentEffective.toLocaleString()} → ¥${amounts.newAmount.toLocaleString()}`
        : "",
      actuallyRefunded > 0 ? `返金¥${actuallyRefunded.toLocaleString()}` : "",
      refundRemaining > 0 ? `⚠️ ¥${refundRemaining.toLocaleString()}は自動返金できませんでした` : "",
      `理由: ${reason}`,
    ].filter(Boolean).join("\n")
  );
}
