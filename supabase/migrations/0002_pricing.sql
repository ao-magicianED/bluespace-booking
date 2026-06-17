-- =============================================================
-- フェーズ2-①: 料金体系（休日料金・割引）/ オプション / クーポン / 祝日
-- =============================================================

-- ---------------------------------------------------------------
-- 拠点に料金・割引設定を追加
-- holiday_hourly_price: 土日祝の時給（nullなら平日と同額）
-- last_minute_percent: 直前割（利用当日の予約に適用、0=なし）
-- early_bird_percent / early_bird_days: 早割（N日以上前の予約に適用）
-- ---------------------------------------------------------------
alter table venues add column if not exists holiday_hourly_price int;
alter table venues add column if not exists last_minute_percent int not null default 0
  check (last_minute_percent between 0 and 100);
alter table venues add column if not exists early_bird_percent int not null default 0
  check (early_bird_percent between 0 and 100);
alter table venues add column if not exists early_bird_days int not null default 30
  check (early_bird_days >= 1);

-- bookingsにクーポン記録（検索・集計用。内訳はprice_breakdownにも入る）
alter table bookings add column if not exists coupon_code text;

-- ---------------------------------------------------------------
-- 日本の祝日（Cronで holidays-jp API から自動更新。初期データ2026-2027）
-- ---------------------------------------------------------------
create table if not exists jp_holidays (
  date date primary key,
  name text not null default ''
);
alter table jp_holidays enable row level security;

insert into jp_holidays (date, name) values
  ('2026-01-01','元日'),('2026-01-12','成人の日'),('2026-02-11','建国記念の日'),
  ('2026-02-23','天皇誕生日'),('2026-03-20','春分の日'),('2026-04-29','昭和の日'),
  ('2026-05-03','憲法記念日'),('2026-05-04','みどりの日'),('2026-05-05','こどもの日'),
  ('2026-05-06','振替休日'),('2026-07-20','海の日'),('2026-08-11','山の日'),
  ('2026-09-21','敬老の日'),('2026-09-22','国民の休日'),('2026-09-23','秋分の日'),
  ('2026-10-12','スポーツの日'),('2026-11-03','文化の日'),('2026-11-23','勤労感謝の日'),
  ('2027-01-01','元日'),('2027-01-11','成人の日'),('2027-02-11','建国記念の日'),
  ('2027-02-23','天皇誕生日'),('2027-03-21','春分の日'),('2027-03-22','振替休日'),
  ('2027-04-29','昭和の日'),('2027-05-03','憲法記念日'),('2027-05-04','みどりの日'),
  ('2027-05-05','こどもの日'),('2027-07-19','海の日'),('2027-08-11','山の日'),
  ('2027-09-20','敬老の日'),('2027-09-23','秋分の日'),('2027-10-11','スポーツの日'),
  ('2027-11-03','文化の日'),('2027-11-23','勤労感謝の日')
on conflict (date) do nothing;

-- ---------------------------------------------------------------
-- 有料オプション（プロジェクター等）
-- price_unit: per_booking=予約ごと / per_hour=1時間ごと
-- ---------------------------------------------------------------
create table if not exists venue_options (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  name text not null,
  price int not null check (price >= 0),
  price_unit text not null default 'per_booking'
    check (price_unit in ('per_booking', 'per_hour')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table venue_options enable row level security;

-- ---------------------------------------------------------------
-- クーポン（ゲリラクーポン等。Table Editorに1行足せば即発行できる）
-- percent_off か amount_off のどちらか一方を設定する
-- venue_id がnullなら全拠点で使える
-- ---------------------------------------------------------------
create table if not exists coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null default '',
  percent_off int check (percent_off between 1 and 100),
  amount_off int check (amount_off > 0),
  venue_id uuid references venues(id),
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses int check (max_uses > 0),
  used_count int not null default 0,
  min_amount int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (percent_off is not null or amount_off is not null)
);
alter table coupons enable row level security;

-- クーポン使用回数のカウントアップ（決済確定時にWebhookから呼ぶ）
create or replace function increment_coupon_use(p_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update coupons set used_count = used_count + 1 where upper(code) = upper(p_code);
end;
$$;
revoke execute on function increment_coupon_use(text) from public, anon, authenticated;
grant execute on function increment_coupon_use(text) to service_role;

-- ---------------------------------------------------------------
-- 京成小岩の初期設定（平日1000/休日2000・直前割10%・早割10%/30日・プロジェクター500円）
-- ---------------------------------------------------------------
update venues
   set holiday_hourly_price = 2000,
       last_minute_percent = 10,
       early_bird_percent = 10,
       early_bird_days = 30
 where slug = 'keisei-koiwa';

insert into venue_options (venue_id, name, price, price_unit, active)
select id, 'プロジェクター', 500, 'per_booking', true
  from venues where slug = 'keisei-koiwa'
   and not exists (
     select 1 from venue_options o where o.venue_id = venues.id and o.name = 'プロジェクター'
   );
