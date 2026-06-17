-- =============================================================
-- レンタルスペース予約システム フェーズ1 初期スキーマ
-- Supabase の SQL Editor にそのまま貼り付けて実行できます
-- =============================================================

-- 排他制約（EXCLUDE USING gist で uuid 列を使う）に必要な拡張
create extension if not exists btree_gist;

-- ---------------------------------------------------------------
-- 拠点
-- ---------------------------------------------------------------
create table if not exists venues (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  address text not null default '',
  description text not null default '',
  open_hour int not null default 0 check (open_hour between 0 and 23),
  close_hour int not null default 24 check (close_hour between 1 and 24),
  hourly_price int not null check (hourly_price >= 0),
  min_hours int not null default 1 check (min_hours >= 1),
  max_hours int not null default 8 check (max_hours >= min_hours),
  calendar_id text not null default '',
  external_booking_url text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (open_hour < close_hour)
);

-- ---------------------------------------------------------------
-- 予約
-- booking_status: pending(仮押さえ) / confirmed(確定) / cancelled / expired
-- payment_status: unpaid / paid / refunded / partially_refunded
-- ---------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  start_at timestamptz not null,
  end_at timestamptz not null,
  booking_status text not null default 'pending'
    check (booking_status in ('pending', 'confirmed', 'cancelled', 'expired')),
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'paid', 'refunded', 'partially_refunded')),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null default '',
  purpose text not null default '',
  total_amount int not null check (total_amount >= 0),
  currency text not null default 'jpy',
  price_breakdown jsonb not null default '{}',
  stripe_session_id text,
  stripe_payment_intent_id text,
  calendar_event_id text,
  calendar_sync_status text not null default 'none'
    check (calendar_sync_status in ('none', 'synced', 'failed')),
  confirmation_email_sent_at timestamptz,
  expires_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  refunded_amount int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_at < end_at),
  -- ★ダブルブッキング防止の本丸：同一拠点・時間帯重複の行をDBレベルで拒否
  constraint no_double_booking exclude using gist (
    venue_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  ) where (booking_status in ('pending', 'confirmed'))
);

create index if not exists idx_bookings_venue_time on bookings (venue_id, start_at);
create index if not exists idx_bookings_status on bookings (booking_status);
-- セッションIDは予約と1対1（取り違え防止）
create unique index if not exists uq_bookings_session
  on bookings (stripe_session_id) where stripe_session_id is not null;

-- ---------------------------------------------------------------
-- Stripe Webhook 冪等化（同じイベントを二度処理しない）
-- ---------------------------------------------------------------
create table if not exists stripe_events (
  event_id text primary key,
  type text not null,
  -- processing: 処理中 / processed: 完了 / failed: 失敗（再送時に再処理を許可）
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------
-- RLS: クライアントからの直接アクセスを全面禁止
-- （アクセスはNext.jsサーバーの service_role キー経由のみ。service_roleはRLSを通過する）
-- ---------------------------------------------------------------
alter table venues enable row level security;
alter table bookings enable row level security;
alter table stripe_events enable row level security;

-- ---------------------------------------------------------------
-- 仮押さえ作成関数
-- 同一トランザクションで「重なる期限切れpendingの掃除 → INSERT」を行う。
-- 排他制約違反（先に取られた）の場合は 'slot_taken' エラーを返す。
-- ---------------------------------------------------------------
create or replace function create_pending_booking(
  p_venue_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_purpose text,
  p_total_amount int,
  p_price_breakdown jsonb,
  p_expires_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_active_pending int;
  v_venue_active boolean;
begin
  -- 入力の健全性チェック（service_role以外から万一呼ばれた場合の防御）
  select active into v_venue_active from venues where id = p_venue_id;
  if v_venue_active is distinct from true then
    raise exception 'venue_not_found';
  end if;
  if p_expires_at > now() + interval '31 minutes' then
    raise exception 'invalid_expiry';
  end if;

  -- 期限切れの仮押さえを排他制約の対象から外す（これをしないと枠が塞がったままになる）
  -- ※10分の猶予: 決済完了Webhookが遅延して届くケースに備え、期限直後はまだ解放しない
  update bookings
     set booking_status = 'expired', updated_at = now()
   where venue_id = p_venue_id
     and booking_status = 'pending'
     and expires_at is not null
     and expires_at < now() - interval '10 minutes'
     and tstzrange(start_at, end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)');

  -- 枠押さえ荒らし対策：同一メールの有効な仮押さえは2件まで
  select count(*) into v_active_pending
    from bookings
   where customer_email = p_customer_email
     and booking_status = 'pending'
     and (expires_at is null or expires_at >= now());
  if v_active_pending >= 2 then
    raise exception 'too_many_pending';
  end if;

  insert into bookings (
    venue_id, start_at, end_at,
    booking_status, payment_status,
    customer_name, customer_email, customer_phone, purpose,
    total_amount, price_breakdown, expires_at
  ) values (
    p_venue_id, p_start_at, p_end_at,
    'pending', 'unpaid',
    p_customer_name, p_customer_email, p_customer_phone, coalesce(p_purpose, ''),
    p_total_amount, p_price_breakdown, p_expires_at
  ) returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'slot_taken';
end;
$$;

-- ---------------------------------------------------------------
-- 期限切れ仮押さえの一括掃除（Cronから呼ぶ）
-- ---------------------------------------------------------------
create or replace function expire_stale_pendings()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  -- 10分の猶予: 決済完了Webhookの遅延に備える（create_pending_bookingと同じ方針）
  update bookings
     set booking_status = 'expired', updated_at = now()
   where booking_status = 'pending'
     and expires_at is not null
     and expires_at < now() - interval '10 minutes';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------
-- 関数の実行権限: サーバー（service_role）のみに限定
-- （anonキーが他用途で公開されても予約関数を直接叩けないようにする）
-- ---------------------------------------------------------------
revoke execute on function create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz) to service_role;
revoke execute on function expire_stale_pendings() from public, anon, authenticated;
grant execute on function expire_stale_pendings() to service_role;
