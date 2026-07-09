import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin-auth";
import { getDb } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe";
import { effectiveTotal, collectPaymentIntents, refundFromPaymentIntents } from "@/lib/adjustment";
import { sendMail, sendAdminAlert } from "@/lib/mail";
import { formatBookingPeriod } from "@/lib/confirm";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_AMOUNT = 1_000_000;

/**
 * POST /api/admin/adjust-price
 * 管理者による予約料金の事後変更。
 *   newAmount < 現在の実効金額 → 差額を即時返金（減額）
 *   newAmount > 現在の実効金額 → 差額分のCheckoutリンクをお客様に送信（増額）
 */
export async function POST(req: NextRequest) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "管理者ログインが必要です" }, { status: 401 });
  }

  let body: { bookingId?: string; newAmount?: number; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const bookingId = body.bookingId ?? "";
  const newAmount = body.newAmount;
  const reason = (body.reason ?? "").trim();

  if (!/^[0-9a-f-]{36}$/.test(bookingId)) {
    return NextResponse.json({ error: "予約IDが不正です" }, { status: 400 });
  }
  if (typeof newAmount !== "number" || !Number.isInteger(newAmount) || newAmount < 0 || newAmount > MAX_AMOUNT) {
    return NextResponse.json({ error: "金額は0〜1,000,000の整数で指定してください" }, { status: 400 });
  }
  if (!reason) {
    return NextResponse.json({ error: "変更理由を入力してください" }, { status: 400 });
  }

  const db = getDb();
  const { data: booking } = await db
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle<Booking>();
  if (!booking) return NextResponse.json({ error: "予約が見つかりません" }, { status: 404 });

  if (booking.booking_status !== "confirmed" || booking.payment_status === "refunded") {
    return NextResponse.json({ error: "確定済み（未全額返金）の予約のみ変更できます" }, { status: 400 });
  }

  // 決済待ちの調整がある場合は拒否
  const { data: pending } = await db
    .from("booking_adjustments")
    .select("id")
    .eq("booking_id", bookingId)
    .eq("status", "pending_payment")
    .limit(1);
  if ((pending ?? []).length > 0) {
    return NextResponse.json({ error: "お客様の追加決済を待っている調整があります。先にそちらを処理してください。" }, { status: 409 });
  }

  const currentEffective = effectiveTotal(booking);
  if (newAmount === currentEffective) {
    return NextResponse.json({ error: "現在の金額と同じです" }, { status: 400 });
  }

  const { data: venue } = await db
    .from("venues")
    .select("name")
    .eq("id", booking.venue_id)
    .maybeSingle<{ name: string }>();
  const venueName = venue?.name ?? "";
  const period = formatBookingPeriod(booking);

  const delta = newAmount - currentEffective;

  if (delta < 0) {
    // --- 減額: 差額を返金 ---
    const refundAmount = Math.abs(delta);

    // 二重送信（ダブルクリック・リトライ）対策: Stripe返金を実行する前に、
    // adjusted_totalへのCAS（compare-and-swap）更新で排他的にこの操作の実行権を取る。
    // 同時に届いたリクエストは片方だけがこの更新に成功し、負けた側は409で弾かれる。
    let claimQuery = db
      .from("bookings")
      .update({ adjusted_total: newAmount, updated_at: new Date().toISOString() })
      .eq("id", bookingId)
      .eq("booking_status", "confirmed");
    claimQuery =
      booking.adjusted_total == null
        ? claimQuery.is("adjusted_total", null)
        : claimQuery.eq("adjusted_total", booking.adjusted_total);
    const { data: claimed, error: claimErr } = await claimQuery.select("id");
    if (claimErr || !claimed || claimed.length === 0) {
      return NextResponse.json(
        { error: "この予約は他の操作と競合しています。画面を更新して再度お試しください" },
        { status: 409 }
      );
    }

    const pis = await collectPaymentIntents(
      bookingId,
      booking.stripe_payment_intent_id,
      booking.stripe_invoice_id,
      db
    );

    if (pis.length === 0) {
      // claim解除（返金元がないので今回は何も変更しなかったことにする）
      await db
        .from("bookings")
        .update({ adjusted_total: booking.adjusted_total ?? null, updated_at: new Date().toISOString() })
        .eq("id", bookingId);
      return NextResponse.json(
        { error: "返金元のStripe決済情報が見つかりません。手動でStripeダッシュボードから返金してください。" },
        { status: 422 }
      );
    }

    let refundIds: string[];
    let remainingAmount: number;
    try {
      const r = await refundFromPaymentIntents(pis, refundAmount, `adj-dec-${bookingId}-${currentEffective}-${newAmount}`);
      refundIds = r.refundIds;
      remainingAmount = r.remainingAmount;
    } catch (e) {
      // Stripe側の返金に失敗した場合はclaimを解除し、手動対応をアラート
      await db
        .from("bookings")
        .update({ adjusted_total: booking.adjusted_total ?? null, updated_at: new Date().toISOString() })
        .eq("id", bookingId);
      await sendAdminAlert(
        "🚨 料金減額の返金失敗（手動対応必要）",
        `予約ID: ${bookingId}\n返金予定額: ¥${refundAmount.toLocaleString()}\nエラー: ${String(e)}`
      );
      return NextResponse.json({ error: "返金処理に失敗しました。管理者に連絡してください" }, { status: 500 });
    }

    // DB更新（adjusted_totalは既にclaim済みなので、返金結果を反映するだけでよい）
    const newRefunded = (booking.refunded_amount ?? 0) + (refundAmount - remainingAmount);
    await db
      .from("bookings")
      .update({
        refunded_amount: newRefunded,
        payment_status: newRefunded >= booking.total_amount ? "refunded" : "partially_refunded",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    await db.from("booking_adjustments").insert({
      booking_id: bookingId,
      adjustment_type: "price_decrease",
      previous_amount: currentEffective,
      new_amount: newAmount,
      amount_delta: delta,
      reason,
      stripe_refund_id: refundIds[0] ?? null,
      status: "completed",
    });

    // 通知
    await sendMail({
      to: booking.customer_email,
      subject: `【料金変更のお知らせ】${venueName} ${period}`,
      text: [
        `${booking.customer_name} 様`,
        "",
        "ご予約の料金が変更されました。",
        "",
        `▼変更内容`,
        `スペース: ${venueName}`,
        `日時: ${period}`,
        `変更前: ¥${currentEffective.toLocaleString()}`,
        `変更後: ¥${newAmount.toLocaleString()}`,
        `差額返金: ¥${(refundAmount - remainingAmount).toLocaleString()}`,
        `理由: ${reason}`,
        "",
        "ご返金はクレジットカードへ自動で行われます。明細への反映は5〜10営業日かかる場合があります。",
        "",
        "ご不明な点がございましたらお気軽にお問い合わせください。",
        "ブルーステージ合同会社",
      ].join("\n"),
    });
    await sendAdminAlert(
      `料金減額 ${venueName} ${period}`,
      `¥${currentEffective.toLocaleString()} → ¥${newAmount.toLocaleString()}（返金¥${(refundAmount - remainingAmount).toLocaleString()}）\n理由: ${reason}\n${remainingAmount > 0 ? `⚠️ ¥${remainingAmount.toLocaleString()} は自動返金できませんでした。手動対応してください。` : ""}`
    );

    return NextResponse.json({
      ok: true,
      type: "decrease",
      refundAmount: refundAmount - remainingAmount,
      manualRefundNeeded: remainingAmount,
    });
  } else {
    // --- 増額: 追加請求のCheckoutセッションを生成 ---
    const chargeAmount = delta;
    const stripe = getStripe();
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://bluespacerental.com";

    // booking_adjustments を先に作成（pending_payment）
    const { data: adj, error: adjErr } = await db
      .from("booking_adjustments")
      .insert({
        booking_id: bookingId,
        adjustment_type: "price_increase",
        previous_amount: currentEffective,
        new_amount: newAmount,
        amount_delta: delta,
        reason,
        status: "pending_payment",
      })
      .select("id")
      .single();
    if (adjErr || !adj) {
      return NextResponse.json({ error: "調整レコードの作成に失敗しました" }, { status: 500 });
    }
    const adjustmentId = (adj as { id: string }).id;

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        currency: "jpy",
        line_items: [
          {
            price_data: {
              currency: "jpy",
              unit_amount: chargeAmount,
              product_data: {
                name: `追加請求: ${venueName} ${period}`,
                description: `料金変更 ¥${currentEffective.toLocaleString()} → ¥${newAmount.toLocaleString()}（${reason}）`,
              },
            },
            quantity: 1,
          },
        ],
        metadata: {
          adjustment_id: adjustmentId,
          booking_id: bookingId,
        },
        customer_email: booking.customer_email,
        success_url: `${baseUrl}/my/${bookingId}?adjusted=1`,
        cancel_url: `${baseUrl}/my/${bookingId}`,
        expires_at: Math.floor(Date.now() / 1000) + 72 * 60 * 60,
      },
      { idempotencyKey: `adj-inc-${adjustmentId}` }
    );

    // セッションIDを保存。失敗するとWebhook側のセッションID照合が必ず失敗する
    //（支払済みなのに反映されない）ため、失敗時はセッションを失効させ調整も取り下げる
    const { error: saveErr } = await db
      .from("booking_adjustments")
      .update({ stripe_session_id: session.id })
      .eq("id", adjustmentId);
    if (saveErr) {
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (e) {
        console.error("[adjust-price] セッション失効失敗:", e);
      }
      await db.from("booking_adjustments").update({ status: "expired" }).eq("id", adjustmentId);
      return NextResponse.json(
        { error: "決済ページの作成に失敗しました。時間をおいてお試しください" },
        { status: 500 }
      );
    }

    // お客様にメールでリンク送信
    await sendMail({
      to: booking.customer_email,
      subject: `【追加お支払いのお願い】${venueName} ${period}`,
      text: [
        `${booking.customer_name} 様`,
        "",
        "ご予約の料金が変更されました。追加のお支払いをお願いいたします。",
        "",
        `▼変更内容`,
        `スペース: ${venueName}`,
        `日時: ${period}`,
        `変更前: ¥${currentEffective.toLocaleString()}`,
        `変更後: ¥${newAmount.toLocaleString()}`,
        `追加お支払い額: ¥${chargeAmount.toLocaleString()}`,
        `理由: ${reason}`,
        "",
        `▼お支払いはこちら`,
        session.url ?? "",
        "",
        "※お支払い期限: 72時間以内",
        "※期限を過ぎると自動的にキャンセルとなります。",
        "",
        "ご不明な点がございましたらお気軽にお問い合わせください。",
        "ブルーステージ合同会社",
      ].join("\n"),
    });
    await sendAdminAlert(
      `追加請求 ${venueName} ${period}`,
      `¥${currentEffective.toLocaleString()} → ¥${newAmount.toLocaleString()}（追加¥${chargeAmount.toLocaleString()}）\n理由: ${reason}\nお客様にお支払いリンクを送信しました。`
    );

    return NextResponse.json({
      ok: true,
      type: "increase",
      chargeAmount,
      checkoutUrl: session.url,
    });
  }
}
