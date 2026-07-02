-- 前日リマインダーメールの送信済みフラグ（冪等化用。confirmation_email_sent_at と同じ考え方）
alter table bookings
  add column if not exists reminder_email_sent_at timestamptz;
