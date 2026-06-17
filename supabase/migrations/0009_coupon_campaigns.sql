-- 0009: 自動クーポン配布（初回サンクス・掘り起こし）
-- restrict_email: クーポンを特定顧客専用にする（コードが漏れても他人は使えない）
alter table coupons add column if not exists restrict_email text;

-- 配布履歴（同じ顧客に同じ種類のクーポンを二重配布しないための台帳）
create table if not exists coupon_grants (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  kind text not null, -- thanks_next_day | winback_30 | winback_90
  coupon_code text not null,
  sent_at timestamptz not null default now(),
  unique (email, kind)
);
alter table coupon_grants enable row level security;
