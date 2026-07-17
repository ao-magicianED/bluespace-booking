import { getDb } from "./supabase";
import { sendAdminAlert, sendMail } from "./mail";
import { formatBookingPeriod } from "./confirm";
import { updateBookingEventTime, type BookingEventDetails } from "./google-calendar";
import { effectiveTotal, collectPaymentIntents, refundFromPaymentIntents } from "./adjustment";
import { adminBookingUrl } from "./site-url";
import type { Booking, Venue } from "./types";
import type { PriceBreakdown } from "./pricing";

export type ApplyTimeChangeResult =
  | { ok: true }
  | { ok: false; reason: "slot_conflict" | "db_error"; message: string };

/**
 * 時間変更を確定反映する（カレンダー更新・DB更新・必要なら返金・通知）。
 * Checkout完了Webhook、管理者の即時反映、自動承認、いずれからも呼ばれる。
 * route.ts は HTTPハンドラ以外をexportできない（Next.jsのApp Router制約）ため、
 * 複数のroute.tsから共有されるこのロジックはlib側に置く。
 *
 * 戻り値で予約時刻の更新が実際に反映できたかを呼び出し元へ伝える（returnするだけで
 * 例外を投げないため、呼び出し元は必ずok/failを確認すること。呼び出し時点で決済/返金の
 * 金銭処理は既に完了しているため、失敗時でもそれらを取り消すことはしない＝手動対応に委ねる）。
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
}): Promise<ApplyTimeChangeResult> {
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
  // 増額分はここで初めて「実際に支払われた」ことが確定する（呼び出し元は決済完了後のみ
  // extraAmount>0で呼ぶ）。extra_paid_amountの加算はDB側の単一UPDATEで完結させ、
  // 同時実行での加算漏れ（lost update）を防ぐ（supabase/migrations/0017参照）
  if (amounts.extraAmount > 0) {
    const { error: incErr } = await db.rpc("increment_extra_paid_amount", {
      p_booking_id: bookingId,
      p_delta: amounts.extraAmount,
    });
    if (incErr) {
      console.error("[change-time] extra_paid_amount加算失敗:", incErr);
      await sendAdminAlert(
        "🚨 延長決済の反映に失敗（手動対応必要）",
        `予約ID: ${bookingId}\n決済は完了していますが、extra_paid_amountの加算に失敗しました。手動で確認・修正してください。\nエラー: ${String(incErr.message ?? incErr)}`
      );
    }
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
        // refunded_amountの加算・payment_statusの再計算もDB側の単一UPDATEで原子的に行う。
        // 1円も返金できていない場合は何もしない（返金失敗として手動対応アラートに任せる）
        if (actuallyRefunded > 0) {
          const { error: incErr } = await db.rpc("increment_refunded_amount", {
            p_booking_id: bookingId,
            p_delta: actuallyRefunded,
          });
          if (incErr) {
            console.error("[change-time] refunded_amount加算失敗:", incErr);
            await sendAdminAlert(
              "🚨 返金額の記録に失敗（手動対応必要）",
              `予約ID: ${bookingId}\nStripe側は返金済みですが、DBへの反映(refunded_amount)に失敗しました。手動で確認・修正してください。\nエラー: ${String(incErr.message ?? incErr)}`
            );
          }
        }
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

  // 決済/承認は完了済みのため、この更新の失敗は「時間帯が他の予約と重なった」等の
  // 排他制約違反である可能性が高い（no_double_booking, 0001参照）。検知せず後続の
  // カレンダー更新・承認確定・完了メールへ進むと、DB上は変更されていないのに
  // お客様には「変更完了」と案内してしまう事故になるため、必ず結果を確認する。
  // CAS条件（呼び出し元は必ず booking_status==='confirmed' を確認した直後の
  // スナップショットを渡す前提。start_at/end_at/adjusted_totalが読んだ時点のままで
  // あることも合わせて確認し、呼び出し元の空き確認から反映までの間に予約自体
  // （時刻・並行して行われた料金調整等）が変わっていた場合に、古いスナップショットに
  // 基づく金額・時刻で無条件に上書きしないようにする。
  // payment_statusはCASに含めない: このすぐ上のincrement_refunded_amount RPCが
  // このUPDATEより先にpayment_statusを書き換えるため、含めると返金を伴う変更が
  // （このUPDATE自体が原因で）必ず0件になってしまう。
  let bookingUpdateQuery = db
    .from("bookings")
    .update(updates)
    .eq("id", bookingId)
    .eq("booking_status", "confirmed")
    .eq("start_at", booking.start_at)
    .eq("end_at", booking.end_at);
  bookingUpdateQuery =
    booking.adjusted_total === null || booking.adjusted_total === undefined
      ? bookingUpdateQuery.is("adjusted_total", null)
      : bookingUpdateQuery.eq("adjusted_total", booking.adjusted_total);
  const { data: updatedRows, error: updateErr } = await bookingUpdateQuery.select("id");
  if (updateErr || !updatedRows || updatedRows.length === 0) {
    // 排他制約違反(exclusion_violation=23P01)は枠の競合、それ以外のDBエラーは
    // インフラ障害寄りとして区別する（呼び出し元での応答コード分岐に使う）
    const isExclusionViolation = updateErr?.code === "23P01";
    const reason: "slot_conflict" | "db_error" =
      !updateErr || isExclusionViolation ? "slot_conflict" : "db_error";
    const message = String(
      updateErr?.message ?? "更新0件（他の予約と重複しているか、予約が別経路で変更済みの可能性）"
    );
    const alertTitle =
      reason === "slot_conflict"
        ? "🚨 時間変更の反映に失敗（枠が埋まっている可能性・要手動対応）"
        : "🚨 時間変更の反映に失敗（DB更新エラー・要手動対応）";
    await sendAdminAlert(
      alertTitle,
      `予約ID: ${bookingId}\n決済/承認は完了していますが、予約時間の更新に失敗しました。カレンダー更新・完了メールは送信していません。手動で確認してください。\n分類: ${reason}\nエラー: ${message}`
    );
    return { ok: false, reason, message };
  }

  // Googleカレンダー更新（新しい金額も反映）
  if (booking.calendar_event_id && venue.calendar_id) {
    try {
      const bd = (booking.price_breakdown ?? null) as Partial<PriceBreakdown> | null;
      const details: BookingEventDetails = {
        venueName: venue.name,
        customerName: booking.customer_name,
        companyName: booking.customer_type === "corporate" ? booking.company_name : null,
        partySize: booking.party_size,
        optionsText:
          bd?.options && bd.options.length > 0
            ? bd.options.map((o) => `${o.name} ¥${o.amount.toLocaleString()}`).join(" / ")
            : null,
        amountText: `¥${amounts.newAmount.toLocaleString()}`,
        paymentMethodLabel: booking.payment_method === "invoice" ? "請求書払い（銀行振込）" : "カード決済",
        createdAtText: new Date(booking.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }),
        adminUrl: adminBookingUrl(bookingId),
      };
      await updateBookingEventTime(venue.calendar_id, booking.calendar_event_id, bookingId, start, end, details);
    } catch (e) {
      console.error("[change-time] カレンダー更新失敗:", e);
      await sendAdminAlert(
        "⚠️ カレンダー更新失敗（時間変更）",
        `予約ID: ${bookingId}\n手動でGoogleカレンダーを修正してください。\nエラー: ${String(e)}`
      );
    }
  }

  // change_request 確定（予約時刻の更新自体は既に成功しているため、この失敗は
  // 監査ログの記録漏れに留まる。ブロックはせずアラートのみで手動対応に委ねる）
  const { data: crUpdatedRows, error: crUpdateErr } = await db
    .from("booking_change_requests")
    .update({
      status: "approved",
      decided_at: now.toISOString(),
      stripe_refund_id: refundId,
    })
    .eq("id", changeRequestId)
    .select("id");
  if (crUpdateErr || !crUpdatedRows || crUpdatedRows.length === 0) {
    console.error("[change-time] change_request確定更新失敗:", crUpdateErr ?? "対象0件");
    await sendAdminAlert(
      "⚠️ 変更申請の確定記録に失敗（要確認・予約自体は変更済み）",
      `予約ID: ${bookingId}\n申請ID: ${changeRequestId}\n予約時間の変更は反映済みですが、申請テーブルの確定記録に失敗しました。\nエラー: ${String(crUpdateErr?.message ?? "対象0件")}`
    );
  }

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

  return { ok: true };
}
