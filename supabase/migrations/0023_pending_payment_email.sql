-- カード決済の仮予約受付メール（Stripe Checkout URL入り）の送信記録（0023）。
-- Resend がリクエストを受理した時刻を best-effort で記録する（監査・将来の再送候補の判定用）。
-- 配信完了の保証ではなく、厳密な冪等化キーでもない（送信後に記録するため、記録失敗時は null のまま）。
-- confirmation_email_sent_at / reminder_email_sent_at と同じ nullable timestamptz。
alter table bookings
  add column if not exists pending_payment_email_sent_at timestamptz;
