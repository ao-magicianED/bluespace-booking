-- =============================================================
-- フェーズ2-②: 会員制（Supabase Auth）＋領収書
-- =============================================================

-- 会員予約の紐付け（ゲスト予約はnullのまま）
alter table bookings add column if not exists user_id uuid references auth.users(id);
create index if not exists idx_bookings_user on bookings (user_id);

-- 領収書（宛名は利用者が発行時に入力。再発行可・初回発行日時を記録）
alter table bookings add column if not exists receipt_name text;
alter table bookings add column if not exists receipt_first_issued_at timestamptz;

-- 仮押さえ作成関数を user_id 対応に差し替え
drop function if exists create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz);

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
  p_user_id uuid default null
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
  if p_expires_at > now() + interval '31 minutes' then
    raise exception 'invalid_expiry';
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
    total_amount, price_breakdown, expires_at, user_id
  ) values (
    p_venue_id, p_start_at, p_end_at,
    'pending', 'unpaid',
    p_customer_name, p_customer_email, p_customer_phone, coalesce(p_purpose, ''),
    p_total_amount, p_price_breakdown, p_expires_at, p_user_id
  ) returning id into v_id;

  return v_id;
exception
  when exclusion_violation then
    raise exception 'slot_taken';
end;
$$;

revoke execute on function create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz, uuid) from public, anon, authenticated;
grant execute on function create_pending_booking(uuid, timestamptz, timestamptz, text, text, text, text, int, jsonb, timestamptz, uuid) to service_role;
