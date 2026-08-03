import { getDb } from "./supabase";
import { getStripe } from "./stripe";
import { voidInvoice, getCustomerCashBalanceJpy } from "./invoice";
import { sendAdminAlert, sendMail } from "./mail";
import { formatBookingPeriod } from "./confirm";
import { formatJstWeekdayDateTime } from "./slots";
import type { Booking } from "./types";

/**
 * 請求書払いの期限切れ処理。「枠の解放」「お客様通知」「請求書void」「リマインダー」の
 * 4つを独立させ、それぞれ別条件でclaimすることで、途中でクラッシュしても
 * 次回実行で正しく再試行できるようにする（詳細はdocs/invoice-deadline-and-booking-ux-design.md §4.2）。
 *
 * 呼び出し元（/api/cron/expire-invoices・/api/cron/maintenance）はGET一発でこれを叩くだけ。
 * 各行の処理は個別にtry/catchするため、1件の異常が他の予約の処理を止めない。
 */

const BATCH_LIMIT = 200;
/** void猶予（期限後どれだけ請求書をopenのまま待つか）。着金遅延（銀行の翌営業日着金等）を吸収する */
const VOID_GRACE_MS = 24 * 60 * 60 * 1000;
/** 通知の遡及送信を防ぐ下限（cron停止からの復旧時に古い期限切れへ大量送信しないため） */
const NOTICE_LOOKBACK_MS = 48 * 60 * 60 * 1000;
/** リマインダーを送る「期限まで残りX時間」の窓 */
const REMINDER_WINDOW_MS = 9 * 60 * 60 * 1000;

export type ExpireInvoicesResult = {
  expired: number;
  notified: number;
  voided: number;
  reminded: number;
  errors: number;
};

type VenueName = { venues: { name: string } | null };

export async function expireOverdueInvoices(): Promise<ExpireInvoicesResult> {
  const result: ExpireInvoicesResult = { expired: 0, notified: 0, voided: 0, reminded: 0, errors: 0 };
  const db = getDb();
  const nowIso = new Date().toISOString();

  // --- Q1a: 枠の解放（期限切れpending→expired。通知はここではしない） ---
  const { data: duePending, error: dueErr } = await db
    .from("bookings")
    .select("id")
    .eq("booking_status", "pending")
    .eq("payment_method", "invoice")
    .lt("expires_at", nowIso)
    .limit(BATCH_LIMIT);
  if (dueErr) {
    console.error("[expire-invoices] Q1a取得エラー:", dueErr);
    result.errors++;
  } else {
    for (const row of duePending ?? []) {
      try {
        const { data: updated, error } = await db
          .from("bookings")
          .update({ booking_status: "expired", updated_at: new Date().toISOString() })
          .eq("id", row.id)
          .eq("booking_status", "pending")
          .select("id");
        if (error) throw new Error(error.message);
        if ((updated ?? []).length > 0) result.expired++;
      } catch (e) {
        console.error(`[expire-invoices] Q1a失敗 (booking=${row.id}):`, e);
        result.errors++;
      }
    }
  }

  // --- Q1b: お客様・管理者への通知（別経路でexpiredになった予約も対象。独立claimで漏れなく） ---
  const noticeLookbackIso = new Date(Date.now() - NOTICE_LOOKBACK_MS).toISOString();
  const { data: needsNotice, error: noticeErr } = await db
    .from("bookings")
    .select("*, venues(name)")
    .eq("booking_status", "expired")
    .eq("payment_method", "invoice")
    .is("invoice_expiry_notice_sent_at", null)
    .lt("expires_at", nowIso)
    .gt("expires_at", noticeLookbackIso)
    .limit(BATCH_LIMIT);
  if (noticeErr) {
    console.error("[expire-invoices] Q1b取得エラー:", noticeErr);
    result.errors++;
  } else {
    for (const b of (needsNotice ?? []) as (Booking & VenueName)[]) {
      try {
        const { data: claimed } = await db
          .from("bookings")
          .update({ invoice_expiry_notice_sent_at: new Date().toISOString() })
          .eq("id", b.id)
          .is("invoice_expiry_notice_sent_at", null)
          .select("id");
        if (!claimed || claimed.length === 0) continue; // 他の実行が既に処理済み

        await sendMail({
          to: b.customer_email,
          subject: `【お支払い期限切れ】ご予約の仮押さえを解除しました`,
          text: [
            `${b.customer_name} 様`,
            "",
            `お支払い期限までに入金の確認ができなかったため、以下のご予約の仮押さえを解除しました。`,
            `この時間帯は他のお客様が予約できる状態になっています。`,
            "",
            `スペース: ${b.venues?.name ?? ""}`,
            `日時: ${formatBookingPeriod(b)}`,
            "",
            `※すでにお振込がお済みの場合は行き違いです。入金を確認でき次第、`,
            `　空き状況を再確認のうえ、予約の確定またはご返金のご連絡をいたします。`,
            `※これからのお振込はご遠慮ください。引き続きご利用をご希望の場合は、`,
            `　お手数ですが再度ご予約ください。`,
            "",
            "ブルーステージ合同会社",
          ].join("\n"),
        });
        await sendAdminAlert(
          "請求書の支払期限切れ→仮押さえ解除",
          [
            `${b.venues?.name ?? ""} ${formatBookingPeriod(b)}`,
            `会社: ${b.company_name ?? ""}（${b.customer_name}様）`,
            `金額: ¥${b.total_amount.toLocaleString()}`,
            `予約ID: ${b.id}`,
          ].join("\n")
        );
        result.notified++;
      } catch (e) {
        console.error(`[expire-invoices] Q1b失敗 (booking=${b.id}):`, e);
        result.errors++;
      }
    }
  }

  // --- Q2: 遅延void（期限+24h経過後。着金猶予を過ぎた請求書を無効化） ---
  const voidCutoffIso = new Date(Date.now() - VOID_GRACE_MS).toISOString();
  const { data: needsVoid, error: voidQueryErr } = await db
    .from("bookings")
    .select("id, stripe_invoice_id, stripe_invoice_customer_id")
    .eq("booking_status", "expired")
    .eq("payment_method", "invoice")
    .not("stripe_invoice_id", "is", null)
    .is("invoice_voided_at", null)
    .lt("expires_at", voidCutoffIso)
    .limit(BATCH_LIMIT);
  if (voidQueryErr) {
    console.error("[expire-invoices] Q2取得エラー:", voidQueryErr);
    result.errors++;
  } else {
    for (const b of (needsVoid ?? []) as {
      id: string;
      stripe_invoice_id: string;
      stripe_invoice_customer_id: string | null;
    }[]) {
      try {
        try {
          await voidInvoice(b.stripe_invoice_id);
        } catch (voidErr) {
          // 既にvoid済み/支払済み等のエラーでも、再試行を止めるため記録は続行する
          console.error(`[expire-invoices] Q2 voidエラー (booking=${b.id}):`, voidErr);
        }
        await db
          .from("bookings")
          .update({ invoice_voided_at: new Date().toISOString() })
          .eq("id", b.id)
          .is("invoice_voided_at", null);
        result.voided++;

        // void直後の残高チェック（部分入金されたまま期限切れになったケースの検知。誤警報防止のため
        // ここではterminal（void済み）確定後にのみチェックする）
        if (b.stripe_invoice_customer_id) {
          try {
            const jpy = await getCustomerCashBalanceJpy(b.stripe_invoice_customer_id);
            if (jpy > 0) {
              await sendAdminAlert(
                "⚠️ 無効化済み請求書への入金が滞留しています",
                [
                  `void直後の残高チェックでJPY残高が検出されました。`,
                  `部分入金されたまま期限切れになった可能性があります。Stripeダッシュボードから返金してください。`,
                  ``,
                  `予約ID: ${b.id}`,
                  `顧客ID: ${b.stripe_invoice_customer_id}`,
                  `残高: ¥${jpy.toLocaleString()}`,
                ].join("\n")
              );
            }
          } catch (balErr) {
            console.error(`[expire-invoices] Q2残高チェック失敗 (booking=${b.id}):`, balErr);
          }
        }
      } catch (e) {
        console.error(`[expire-invoices] Q2失敗 (booking=${b.id}):`, e);
        result.errors++;
      }
    }
  }

  // --- Q3: 入金リマインダー（期限9時間前・1回だけ・冪等claim） ---
  const reminderCutoffIso = new Date(Date.now() + REMINDER_WINDOW_MS).toISOString();
  const { data: needsReminder, error: reminderErr } = await db
    .from("bookings")
    .select("*, venues(name)")
    .eq("booking_status", "pending")
    .eq("payment_method", "invoice")
    .is("invoice_reminder_sent_at", null)
    .gt("expires_at", nowIso)
    .lt("expires_at", reminderCutoffIso)
    .limit(BATCH_LIMIT);
  if (reminderErr) {
    console.error("[expire-invoices] Q3取得エラー:", reminderErr);
    result.errors++;
  } else {
    for (const b of (needsReminder ?? []) as (Booking & VenueName)[]) {
      try {
        // 送信前にreminder_sent_atを予約的に確保（cronの並行実行での二重送信を防ぐ）
        const { data: claimed } = await db
          .from("bookings")
          .update({ invoice_reminder_sent_at: new Date().toISOString() })
          .eq("id", b.id)
          .is("invoice_reminder_sent_at", null)
          .select("id");
        if (!claimed || claimed.length === 0) continue;

        let hostedInvoiceUrl: string | null = null;
        if (b.stripe_invoice_id) {
          try {
            const invoice = await getStripe().invoices.retrieve(b.stripe_invoice_id);
            hostedInvoiceUrl = invoice.hosted_invoice_url ?? null;
          } catch (e) {
            console.error(`[expire-invoices] 請求書取得失敗 (booking=${b.id}):`, e);
          }
        }

        const ok = await sendMail({
          to: b.customer_email,
          subject: `【お支払い期限間近】お振込のお願い ${b.venues?.name ?? ""} ${formatBookingPeriod(b)}`,
          text: [
            `${b.customer_name} 様`,
            "",
            `ご予約のお支払い期限が近づいてまいりました。`,
            "",
            `▼ご予約内容`,
            `スペース: ${b.venues?.name ?? ""}`,
            `日時: ${formatBookingPeriod(b)}`,
            `金額: ¥${b.total_amount.toLocaleString()}`,
            `お支払い期限: ${b.expires_at ? formatJstWeekdayDateTime(new Date(b.expires_at)) : ""}`,
            "",
            `▼請求書（お振込先の確認はこちら）`,
            hostedInvoiceUrl ?? "Stripeからお送りした請求書メールをご確認ください",
            "",
            `期限までに入金が確認できない場合、ご予約の仮押さえは自動的に解除されます。`,
            `※すでにお振込済みの場合は行き違いですのでご容赦ください。着金確認まで少しお時間がかかることがあります。`,
            "",
            "ブルーステージ合同会社",
          ].join("\n"),
        });
        if (ok) {
          result.reminded++;
        } else {
          // 送信失敗時は確保を解除し、次回で再試行できるようにする
          await db.from("bookings").update({ invoice_reminder_sent_at: null }).eq("id", b.id);
        }
      } catch (e) {
        console.error(`[expire-invoices] Q3失敗 (booking=${b.id}):`, e);
        result.errors++;
      }
    }
  }

  return result;
}
