-- =============================================================
-- フェーズ2-⑤: 請求書払い（法人・銀行振込）
-- ※Supabase本番には2026-06-12適用済み（apply_migration: invoice_payment）
-- =============================================================

alter table bookings add column if not exists payment_method text not null default 'card'
  check (payment_method in ('card', 'invoice'));
alter table bookings add column if not exists customer_type text not null default 'individual'
  check (customer_type in ('individual', 'corporate'));
alter table bookings add column if not exists company_name text;
alter table bookings add column if not exists stripe_invoice_id text;
create unique index if not exists uq_bookings_invoice
  on bookings (stripe_invoice_id) where stripe_invoice_id is not null;

-- 仮押さえ作成関数の expires_at 上限を「30分」→「4日」に緩和（請求書払い対応）
-- 関数全文は 0003_members.sql と同じ構成のため省略（本番適用済みの定義が正）。
-- 変更点: `if p_expires_at > now() + interval '31 minutes'` → `interval '4 days'`
