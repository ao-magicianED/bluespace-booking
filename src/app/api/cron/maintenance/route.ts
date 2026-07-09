import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/supabase";
import { runConfirmationSideEffects, formatBookingPeriod } from "@/lib/confirm";
import { refreshHolidays } from "@/lib/holidays";
import { runCouponCampaigns } from "@/lib/campaigns";
import { voidInvoice } from "@/lib/invoice";
import { sendAdminAlert, sendMail } from "@/lib/mail";
import { getStripe } from "@/lib/stripe";
import { mapSearchUrl, myBookingUrl, reviewUrl } from "@/lib/site-url";
import { SELF_CHANGE_CUTOFF_HOURS } from "@/lib/change-request";
import { utcToJstDateStr } from "@/lib/slots";
import type { Booking, Venue } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/maintenance
 * 定期メンテナンス（Vercel Cron または 外部Cron(GAS等)から呼ぶ）:
 * 1. 期限切れpendingの掃除（Webhook取りこぼしの保険）
 * 2. カレンダー同期失敗の再試行
 *
 * 認証: Authorization: Bearer <CRON_SECRET>
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const result = {
    expired: 0,
    calendarRetried: 0,
    calendarFailed: 0,
    holidays: 0,
    invoicesVoided: 0,
    changeRequestsExpired: 0,
    priceAdjustmentsExpired: 0,
    remindersSent: 0,
    reviewRequestsSent: 0,
    coupons: { thanks: 0, secondVisit: 0, winback30: 0, winback90: 0 },
  };

  // -1. 古い変更申請（pending 72h以上 / pending_payment 72h以上）を期限切れに
  const expiryCutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const { data: expiredCrs } = await db
    .from("booking_change_requests")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .in("status", ["pending", "pending_payment"])
    .lt("created_at", expiryCutoff)
    .select("id");
  result.changeRequestsExpired = (expiredCrs ?? []).length;

  // -1b. 古い追加請求（price_increase, pending_payment 72h以上）を期限切れに。
  // Stripeのcheckout.session.expired Webhookを取りこぼすと、対応するbooking_adjustments行が
  // pending_paymentのまま残り続け、その予約への以降の料金調整が全てブロックされてしまう保険措置
  const { data: stalePriceAdjustments } = await db
    .from("booking_adjustments")
    .select("id, booking_id, stripe_session_id, new_amount")
    .eq("adjustment_type", "price_increase")
    .eq("status", "pending_payment")
    .lt("created_at", expiryCutoff);
  for (const adj of (stalePriceAdjustments ?? []) as {
    id: string;
    booking_id: string;
    stripe_session_id: string | null;
    new_amount: number;
  }[]) {
    if (adj.stripe_session_id) {
      try {
        await getStripe().checkout.sessions.expire(adj.stripe_session_id);
      } catch (e) {
        console.error("[cron] 追加請求Checkoutセッション失効失敗:", e);
      }
    }
    await db.from("booking_adjustments").update({ status: "expired" }).eq("id", adj.id);
    await sendAdminAlert(
      "⏰ 追加請求の決済期限切れ（自動失効）",
      `72時間以内にお支払いがなかったため、追加請求を自動的に失効させました。\n予約ID: ${adj.booking_id}\n調整ID: ${adj.id}\n請求額: ¥${adj.new_amount.toLocaleString()}\n必要であれば管理画面から再度料金調整を行ってください。`
    );
  }
  result.priceAdjustmentsExpired = (stalePriceAdjustments ?? []).length;

  // 0-a. 期限切れの請求書払い予約: 請求書を無効化してお客様に通知してから失効させる
  //（カードのpendingと違い、明示的な後始末が必要）
  const { data: dueInvoices } = await db
    .from("bookings")
    .select("*, venues(name)")
    .eq("booking_status", "pending")
    .eq("payment_method", "invoice")
    .lt("expires_at", new Date().toISOString());
  for (const b of (dueInvoices ?? []) as (Booking & { venues: { name: string } | null })[]) {
    const { data: upd } = await db
      .from("bookings")
      .update({ booking_status: "expired", updated_at: new Date().toISOString() })
      .eq("id", b.id)
      .eq("booking_status", "pending")
      .select("id");
    if ((upd ?? []).length === 0) continue; // 入金が間に合った等
    if (b.stripe_invoice_id) {
      try {
        await voidInvoice(b.stripe_invoice_id);
      } catch (e) {
        console.error("[cron] 請求書void失敗:", e);
      }
    }
    await sendMail({
      to: b.customer_email,
      subject: `【お支払い期限切れ】ご予約キャンセルのお知らせ`,
      text: [
        `${b.customer_name} 様`,
        "",
        `お支払い期限までに入金の確認ができなかったため、以下のご予約はキャンセルされました。`,
        "",
        `スペース: ${b.venues?.name ?? ""}`,
        `日時: ${formatBookingPeriod(b)}`,
        "",
        "引き続きご利用をご希望の場合は、お手数ですが再度ご予約ください。",
        "ブルーステージ合同会社",
      ].join("\n"),
    });
    await sendAdminAlert(
      "請求書の支払期限切れ→自動キャンセル",
      `${b.venues?.name ?? ""} ${formatBookingPeriod(b)}\n会社: ${b.company_name ?? ""}（${b.customer_name}様）\n金額: ¥${b.total_amount.toLocaleString()}\n予約ID: ${b.id}`
    );
    result.invoicesVoided++;
  }

  // 0. 祝日データの自動更新（holidays-jp API・前年/今年/翌年分。失敗しても続行）
  try {
    result.holidays = await refreshHolidays();
  } catch (e) {
    console.error("[cron] 祝日更新エラー:", e);
  }

  // 1. 期限切れpendingの掃除
  const { data: expiredCount, error: expireError } = await db.rpc("expire_stale_pendings");
  if (expireError) {
    console.error("[cron] 期限切れ掃除エラー:", expireError);
  } else {
    result.expired = expiredCount ?? 0;
  }

  // 2. カレンダー同期失敗 or 確認メール未送信の再試行（直近の確定予約のみ）
  const { data: failed, error: failedError } = await db
    .from("bookings")
    .select("*")
    .eq("booking_status", "confirmed")
    .or("calendar_sync_status.eq.failed,confirmation_email_sent_at.is.null")
    .gt("end_at", new Date().toISOString())
    .limit(20);
  if (failedError) {
    console.error("[cron] 同期/メール失敗予約の取得エラー:", failedError);
  } else {
    for (const booking of (failed ?? []) as Booking[]) {
      const { data: venue } = await db
        .from("venues")
        .select("*")
        .eq("id", booking.venue_id)
        .single<Venue>();
      if (!venue) continue;
      await runConfirmationSideEffects(booking, venue, false);
      const { data: after } = await db
        .from("bookings")
        .select("calendar_sync_status")
        .eq("id", booking.id)
        .single();
      if (after?.calendar_sync_status === "synced") result.calendarRetried++;
      else result.calendarFailed++;
    }
  }

  // 2-b. 前日リマインダー（明日JST開始のconfirmed予約・冪等）
  try {
    const tomorrowJst = utcToJstDateStr(new Date(Date.now() + 24 * 60 * 60 * 1000));
    const dayStart = new Date(`${tomorrowJst}T00:00:00+09:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const { data: upcoming } = await db
      .from("bookings")
      .select("*")
      .eq("booking_status", "confirmed")
      .is("reminder_email_sent_at", null)
      .gte("start_at", dayStart.toISOString())
      .lt("start_at", dayEnd.toISOString())
      .limit(200);
    for (const b of (upcoming ?? []) as Booking[]) {
      const { data: venue } = await db.from("venues").select("*").eq("id", b.venue_id).maybeSingle<Venue>();
      if (!venue) continue;
      const accessSection = venue.access_info?.trim()
        ? [``, `▼入退室のご案内`, venue.access_info.trim()]
        : [];
      const ok = await sendMail({
        to: b.customer_email,
        subject: `【明日のご予約】${venue.name} ${formatBookingPeriod(b)}`,
        text: [
          `${b.customer_name} 様`,
          ``,
          `明日のご予約が近づいてまいりましたので、ご案内いたします。`,
          ``,
          `▼ご予約内容`,
          `スペース: ${venue.name}`,
          `住所: ${venue.address}`,
          `地図: ${mapSearchUrl(venue.address)}`,
          `日時: ${formatBookingPeriod(b)}`,
          ...accessSection,
          ``,
          `▼延長・時間変更について`,
          `ご利用時間の延長・変更は、利用開始${SELF_CHANGE_CUTOFF_HOURS}時間前まで下記マイページからお手続きいただけます。`,
          ``,
          `▼マイページ`,
          myBookingUrl(b.id),
          ``,
          `当日は気をつけてお越しください。`,
          `ブルーステージ合同会社`,
        ].join("\n"),
      });
      if (ok) {
        await db
          .from("bookings")
          .update({ reminder_email_sent_at: new Date().toISOString() })
          .eq("id", b.id);
        result.remindersSent++;
      }
    }
  } catch (e) {
    console.error("[cron] リマインダー送信エラー:", e);
  }

  // 2-c. レビュー依頼メール（利用終了した確定予約に1回だけ送る・冪等）
  // 直近3日以内に終了した予約が対象（cron停止からの復旧時に古い予約へ大量送信しないための下限）
  try {
    const lookbackIso = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: ended } = await db
      .from("bookings")
      .select("*")
      .eq("booking_status", "confirmed")
      .is("review_request_sent_at", null)
      .lt("end_at", new Date().toISOString())
      .gt("end_at", lookbackIso)
      .limit(200);
    for (const b of (ended ?? []) as Booking[]) {
      // 送信前にreview_request_sent_atを予約的に確保（cronの並行実行・タイムアウト再試行での
      // 二重送信を防ぐ）。まだnullの行だけ更新できた場合のみ「自分がこの予約を担当する」とみなす
      const { data: claimed } = await db
        .from("bookings")
        .update({ review_request_sent_at: new Date().toISOString() })
        .eq("id", b.id)
        .is("review_request_sent_at", null)
        .select("id");
      if (!claimed || claimed.length === 0) continue; // 他の実行が既に処理済み

      const { data: venue } = await db
        .from("venues")
        .select("name")
        .eq("id", b.venue_id)
        .maybeSingle<{ name: string }>();
      if (!venue) continue;
      const ok = await sendMail({
        to: b.customer_email,
        subject: `【1分で完了】${venue.name} のご利用はいかがでしたか？`,
        text: [
          `${b.customer_name} 様`,
          ``,
          `先日は ${venue.name} をご利用いただき、誠にありがとうございました。`,
          ``,
          `よろしければ、ご利用の感想をお聞かせください（星を選ぶだけでも大歓迎です）。`,
          `いただいたレビューは拠点ページに掲載され、これからご利用を検討される方の参考になります。`,
          ``,
          `▼レビューを投稿する（1分で完了）`,
          reviewUrl(b.review_token),
          ``,
          `※このリンクは ${b.customer_name} 様のご予約専用です。`,
          ``,
          `またのご利用をお待ちしております。`,
          `ブルーステージ合同会社`,
        ].join("\n"),
      });
      if (ok) {
        result.reviewRequestsSent++;
      } else {
        // 送信失敗時は確保を解除し、次回cronで再試行できるようにする
        await db.from("bookings").update({ review_request_sent_at: null }).eq("id", b.id);
      }
    }
  } catch (e) {
    console.error("[cron] レビュー依頼送信エラー:", e);
  }

  // 3. 自動クーポン配布（初回サンクス・30日/90日掘り起こし。冪等）
  try {
    result.coupons = await runCouponCampaigns();
  } catch (e) {
    console.error("[cron] クーポン配布エラー:", e);
  }

  return NextResponse.json(result);
}
