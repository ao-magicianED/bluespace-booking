-- =============================================================
-- 時間帯別料金（venue_price_bands）＋入口トークン（venue_entry_tokens）
-- ※スキーマのみ。帯データのシード（価格投入）はこのファイルに含めない
--   （投入は replace_venue_price_bands RPC 経由で別途行う）
--
-- ⚠️ 適用前の必須確認（スキーマドリフト）:
--   create_pending_booking は 0004_invoice.sql の注記どおり「本番だけ手動で
--   期限上限を4日へ変更済み」。本ファイルは4日版を正として再作成するが、
--   適用前に必ず本番の現行定義を取得して差分を確認すること:
--     select pg_get_functiondef('create_pending_booking(uuid,timestamptz,timestamptz,text,text,text,text,int,jsonb,timestamptz,uuid)'::regprocedure);
--   リポジトリ外でさらに手が入っていた場合は、その差分を本定義に取り込んでから適用する。
-- =============================================================

-- EXCLUDE USING gist で uuid/text の = を使うための拡張（0001で有効化済み・冪等）
create extension if not exists btree_gist;

-- ---------------------------------------------------------------
-- 時間帯別料金。帯が無い (venue, day_type) は venues.hourly_price /
-- holiday_hourly_price へフォールバックする（=レガシー拠点）。
-- 被覆（0-24隙間なし）・両tier存在・standard>=repeat は
-- replace_venue_price_bands RPC が保証する（EXCLUDE制約は重複防止のみ）。
-- ---------------------------------------------------------------
create table if not exists venue_price_bands (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  tier text not null check (tier in ('standard', 'repeat')),
  day_type text not null check (day_type in ('weekday', 'holiday')),
  start_hour int not null check (start_hour >= 0 and start_hour < 24),
  end_hour int not null check (end_hour > start_hour and end_hour <= 24),
  hourly_price int not null check (hourly_price >= 0),
  created_at timestamptz not null default now(),
  -- 同一 (venue, tier, day_type) 内で時間帯が重ならないこと
  constraint venue_price_bands_no_overlap exclude using gist (
    venue_id with =, tier with =, day_type with =,
    int4range(start_hour, end_hour) with &&
  )
);
create index if not exists idx_venue_price_bands_lookup
  on venue_price_bands (venue_id, day_type);
alter table venue_price_bands enable row level security;  -- ポリシーなし＝service_roleのみ

-- ---------------------------------------------------------------
-- 帯置換の監査ログ（置換前スナップショット）。ロールバックの復元元。
-- ---------------------------------------------------------------
create table if not exists venue_price_band_audits (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  day_type text not null check (day_type in ('weekday', 'holiday')),
  snapshot jsonb not null,
  replaced_at timestamptz not null default now()
);
create index if not exists idx_venue_price_band_audits_lookup
  on venue_price_band_audits (venue_id, day_type, replaced_at desc);
alter table venue_price_band_audits enable row level security;

-- ---------------------------------------------------------------
-- 現地QRの入口トークン。active=false で該当QRを即時失効（キルスイッチ）。
-- 全行 active=false にすれば新規の見積・決済はすべて standard に戻る。
-- ---------------------------------------------------------------
create table if not exists venue_entry_tokens (
  token uuid primary key default gen_random_uuid(),
  venue_id uuid references venues(id),      -- null可（全拠点共通トークンも許す）
  tier text not null default 'repeat' check (tier in ('repeat')),
  active boolean not null default true,
  label text,                                -- 「御徒町 室内POP」等の管理メモ
  created_at timestamptz not null default now()
);
alter table venue_entry_tokens enable row level security;

-- ---------------------------------------------------------------
-- 予約がどちらの価格ティアだったか（GROUP BY集計用。監査はprice_breakdown側）
-- ---------------------------------------------------------------
alter table bookings add column if not exists price_tier text not null default 'standard'
  check (price_tier in ('standard', 'repeat'));

-- ---------------------------------------------------------------
-- 帯の全置換RPC（管理API・シード投入の唯一の入口。1トランザクション）。
-- 検証: 0-24完全被覆（重複なし）・両tier存在・10円単位・standard>=repeat。
-- 置換前の帯は venue_price_band_audits へ退避する。
-- ---------------------------------------------------------------
create or replace function replace_venue_price_bands(
  p_venue_id uuid,
  p_day_type text,
  p_bands jsonb  -- [{"tier","start_hour","end_hour","hourly_price"}, ...] 両tier分
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  b jsonb;
  v_tier text;
  v_start int;
  v_end int;
  v_price int;
  v_slot int;
  v_cnt int;
  v_std_price int;
  v_rep_price int;
  v_snapshot jsonb;
begin
  if p_day_type is null or p_day_type not in ('weekday', 'holiday') then
    raise exception 'invalid_day_type';
  end if;
  select exists(select 1 from venues where id = p_venue_id) into v_exists;
  if not v_exists then
    raise exception 'venue_not_found';
  end if;
  if p_bands is null or jsonb_typeof(p_bands) <> 'array' or jsonb_array_length(p_bands) = 0 then
    raise exception 'invalid_bands';
  end if;

  -- venue単位で直列化（並行置換で検証がすり抜けるのを防ぐ）
  perform pg_advisory_xact_lock(hashtext('venue_price_bands:' || p_venue_id::text));

  -- 要素検証（tier・時刻整合・10円単位）
  for b in select * from jsonb_array_elements(p_bands) loop
    v_tier := b->>'tier';
    v_start := (b->>'start_hour')::int;
    v_end := (b->>'end_hour')::int;
    v_price := (b->>'hourly_price')::int;
    if v_tier is null or v_tier not in ('standard', 'repeat') then
      raise exception 'invalid_tier';
    end if;
    if v_start is null or v_end is null or v_start < 0 or v_end > 24 or v_end <= v_start then
      raise exception 'invalid_band_range';
    end if;
    if v_price is null or v_price < 0 or v_price % 10 <> 0 then
      raise exception 'invalid_band_price';
    end if;
  end loop;

  -- 帯境界は整数時なので、1時間刻みで
  -- 「各時刻を覆う帯が各tierちょうど1本（=完全被覆・重複なし）」と
  -- 「standard >= repeat」を検証する
  for v_slot in 0..23 loop
    select count(*) into v_cnt from jsonb_array_elements(p_bands) x
     where x->>'tier' = 'standard'
       and (x->>'start_hour')::int <= v_slot and (x->>'end_hour')::int > v_slot;
    if v_cnt <> 1 then
      raise exception 'band_coverage_invalid: tier=standard hour=%', v_slot;
    end if;
    select count(*) into v_cnt from jsonb_array_elements(p_bands) x
     where x->>'tier' = 'repeat'
       and (x->>'start_hour')::int <= v_slot and (x->>'end_hour')::int > v_slot;
    if v_cnt <> 1 then
      raise exception 'band_coverage_invalid: tier=repeat hour=%', v_slot;
    end if;
    select (x->>'hourly_price')::int into v_std_price from jsonb_array_elements(p_bands) x
     where x->>'tier' = 'standard'
       and (x->>'start_hour')::int <= v_slot and (x->>'end_hour')::int > v_slot;
    select (x->>'hourly_price')::int into v_rep_price from jsonb_array_elements(p_bands) x
     where x->>'tier' = 'repeat'
       and (x->>'start_hour')::int <= v_slot and (x->>'end_hour')::int > v_slot;
    if v_std_price < v_rep_price then
      raise exception 'tier_order_violation: hour=% standard=% repeat=%', v_slot, v_std_price, v_rep_price;
    end if;
  end loop;

  -- 置換前スナップショットを退避（初回投入時は既存0件のため退避なし）
  select jsonb_agg(
           jsonb_build_object(
             'tier', tier, 'start_hour', start_hour,
             'end_hour', end_hour, 'hourly_price', hourly_price
           ) order by tier, start_hour
         )
    into v_snapshot
    from venue_price_bands
   where venue_id = p_venue_id and day_type = p_day_type;
  if v_snapshot is not null then
    insert into venue_price_band_audits (venue_id, day_type, snapshot)
    values (p_venue_id, p_day_type, v_snapshot);
  end if;

  delete from venue_price_bands where venue_id = p_venue_id and day_type = p_day_type;
  insert into venue_price_bands (venue_id, tier, day_type, start_hour, end_hour, hourly_price)
  select p_venue_id, x->>'tier', p_day_type,
         (x->>'start_hour')::int, (x->>'end_hour')::int, (x->>'hourly_price')::int
    from jsonb_array_elements(p_bands) x;
end;
$$;

-- ---------------------------------------------------------------
-- 帯のロールバックRPC: 直前のスナップショットを復元する。
-- 全DELETEでのロールバックは管理画面で加えた修正まで消すため、原則こちらを使う
-- （初回シード直後に限り `delete from venue_price_bands;` でのフラット復帰も有効）。
-- 復元前の現在の帯もauditsへ退避するため、復元のやり直しも可能。
-- ---------------------------------------------------------------
create or replace function restore_venue_price_bands(
  p_venue_id uuid,
  p_day_type text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prev jsonb;
  v_current jsonb;
begin
  if p_day_type is null or p_day_type not in ('weekday', 'holiday') then
    raise exception 'invalid_day_type';
  end if;
  perform pg_advisory_xact_lock(hashtext('venue_price_bands:' || p_venue_id::text));

  select snapshot into v_prev
    from venue_price_band_audits
   where venue_id = p_venue_id and day_type = p_day_type
   order by replaced_at desc
   limit 1;
  if v_prev is null then
    raise exception 'no_snapshot';
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'tier', tier, 'start_hour', start_hour,
             'end_hour', end_hour, 'hourly_price', hourly_price
           ) order by tier, start_hour
         )
    into v_current
    from venue_price_bands
   where venue_id = p_venue_id and day_type = p_day_type;
  if v_current is not null then
    insert into venue_price_band_audits (venue_id, day_type, snapshot)
    values (p_venue_id, p_day_type, v_current);
  end if;

  delete from venue_price_bands where venue_id = p_venue_id and day_type = p_day_type;
  insert into venue_price_bands (venue_id, tier, day_type, start_hour, end_hour, hourly_price)
  select p_venue_id, x->>'tier', p_day_type,
         (x->>'start_hour')::int, (x->>'end_hour')::int, (x->>'hourly_price')::int
    from jsonb_array_elements(v_prev) x;
end;
$$;

-- ---------------------------------------------------------------
-- 仮押さえ作成関数を price_tier 対応に差し替え。
-- ポイント: price_tier は予約INSERTと同時に保存する（INSERT後の別UPDATEは
-- 失敗時に price_breakdown.tier と price_tier の恒久不整合を作るため禁止）。
-- 期限上限は本番運用値の「4日」を正とする（0004_invoice.sql の注記参照）。
-- ---------------------------------------------------------------
drop function if exists create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz, uuid);

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
  p_expires_at timestamptz,
  p_user_id uuid default null,
  p_price_tier text default 'standard'
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
  select active into v_venue_active from venues where id = p_venue_id;
  if v_venue_active is distinct from true then
    raise exception 'venue_not_found';
  end if;
  -- カード=30分 / 請求書払い=最長4日（0004で本番適用済みの運用値）
  if p_expires_at > now() + interval '4 days' then
    raise exception 'invalid_expiry';
  end if;
  if p_price_tier is null or p_price_tier not in ('standard', 'repeat') then
    raise exception 'invalid_price_tier';
  end if;
  -- スナップショット（price_breakdown.tier）と集計列（price_tier）の一致を保証
  if coalesce(p_price_breakdown->>'tier', 'standard') <> p_price_tier then
    raise exception 'price_tier_mismatch';
  end if;

  -- 期限切れの仮押さえを排他制約の対象から外す（10分の猶予つき）
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
    total_amount, price_breakdown, expires_at, user_id, price_tier
  ) values (
    p_venue_id, p_start_at, p_end_at,
    'pending', 'unpaid',
    p_customer_name, p_customer_email, p_customer_phone, coalesce(p_purpose, ''),
    p_total_amount, p_price_breakdown, p_expires_at, p_user_id, p_price_tier
  ) returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'slot_taken';
end;
$$;

-- ---------------------------------------------------------------
-- 関数の実行権限: サーバー（service_role）のみに限定
-- ---------------------------------------------------------------
revoke execute on function replace_venue_price_bands(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function replace_venue_price_bands(uuid, text, jsonb) to service_role;
revoke execute on function restore_venue_price_bands(uuid, text) from public, anon, authenticated;
grant execute on function restore_venue_price_bands(uuid, text) to service_role;
revoke execute on function create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz, uuid, text) from public, anon, authenticated;
grant execute on function create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz, uuid, text) to service_role;
