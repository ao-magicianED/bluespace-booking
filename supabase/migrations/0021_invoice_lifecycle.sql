-- ---------------------------------------------------------------
-- 請求書払いライフサイクル管理（期限短縮＋expired/通知/void分離）
-- ---------------------------------------------------------------
alter table bookings add column if not exists invoice_reminder_sent_at timestamptz;
alter table bookings add column if not exists invoice_expiry_notice_sent_at timestamptz;
alter table bookings add column if not exists invoice_voided_at timestamptz;
alter table bookings add column if not exists stripe_invoice_customer_id text;

-- 期限チェックcron用 partial index（pending×invoiceのexpires_at検索を高速化）
create index if not exists idx_bookings_invoice_pending
  on bookings (expires_at)
  where booking_status = 'pending' and payment_method = 'invoice';

-- ---------------------------------------------------------------
-- Webhook processing リース（processing滞留で入金確定イベントが
-- 永久に再処理されなくなる既存バグの修正。§4.7参照）
-- ---------------------------------------------------------------
alter table stripe_events add column if not exists processing_started_at timestamptz not null default now();

-- ---------------------------------------------------------------
-- create_pending_booking 本番定義の再掲（リポジトリと本番の乖離解消）。
-- 2026-08-04に本番DBから pg_get_functiondef(oid) で取得した定義をそのまま貼っている。
-- リポジトリ内の 0001_init.sql / 0003_members.sql は expires_at 上限が
-- interval '31 minutes' のまま（請求書払い対応前の古い定義）で、本番のみ
-- 4日に緩和済みだった。手書きでの復元は禁止（書き換え漏れで本番の請求書
-- 予約が invalid_expiry で全滅するリスクがあるため）。
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_pending_booking(p_venue_id uuid, p_start_at timestamp with time zone, p_end_at timestamp with time zone, p_customer_name text, p_customer_email text, p_customer_phone text, p_purpose text, p_total_amount integer, p_price_breakdown jsonb, p_expires_at timestamp with time zone, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_active_pending int;
  v_venue_active boolean;
begin
  select active into v_venue_active from venues where id = p_venue_id;
  if v_venue_active is distinct from true then
    raise exception 'venue_not_found';
  end if;
  -- カード=30分 / 請求書=最長4日（3日期限+短縮ケース）を許容
  if p_expires_at > now() + interval '4 days' then
    raise exception 'invalid_expiry';
  end if;

  update bookings
     set booking_status = 'expired', updated_at = now()
   where venue_id = p_venue_id
     and booking_status = 'pending'
     and expires_at is not null
     and expires_at < now() - interval '10 minutes'
     and tstzrange(start_at, end_at, '[)') && tstzrange(p_start_at, p_end_at, '[)');

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
$function$;
