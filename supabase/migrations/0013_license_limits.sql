-- =============================================================
-- 0013: ライセンス制御（外販対応）
--
-- 外販時に「契約部屋数の上限」をDBレベルで強制するためのテーブルとトリガー。
-- シングルテナント設計（顧客ごとに独立したSupabaseプロジェクト前提）。
--
-- 顧客が管理画面で venues を追加しようとした際、active 数が max_venues を
-- 超えていれば INSERT が拒否される。アップグレードは管理画面の決済フローで
-- license_limits を更新する。
-- =============================================================

-- ---------------------------------------------------------------
-- license_limits: 1行固定（このインスタンス全体のライセンス枠）
-- ---------------------------------------------------------------
create table if not exists license_limits (
  id smallint primary key default 1,
  max_venues int not null default 1 check (max_venues >= 1),
  plan_name text not null default 'starter',
  updated_at timestamptz not null default now(),
  check (id = 1)
);

-- 初期データ: starter プラン (1部屋)
-- ブルーステージ本体は手動で max_venues=7, plan_name='internal' に変更してOK
insert into license_limits (id, max_venues, plan_name)
  values (1, 1, 'starter')
  on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- license_changes: ライセンス変更履歴（監査・返金処理に必須）
-- ---------------------------------------------------------------
create table if not exists license_changes (
  id uuid primary key default gen_random_uuid(),
  change_type text not null check (change_type in (
    'initial', 'add_venue', 'upgrade_plan', 'downgrade_plan', 'admin_override'
  )),
  before_limit int not null,
  after_limit int not null,
  plan_before text,
  plan_after text,
  stripe_session_id text,
  stripe_payment_intent_id text,
  amount_paid int not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists idx_license_changes_created on license_changes (created_at desc);

-- ---------------------------------------------------------------
-- INSERT トリガー: active=true で venues を追加するとき上限チェック
-- ---------------------------------------------------------------
create or replace function check_venue_license_insert() returns trigger as $$
declare
  current_count int;
  max_allowed int;
begin
  if new.active is true then
    select count(*) into current_count from venues where active = true;
    select max_venues into max_allowed from license_limits where id = 1;
    if current_count >= max_allowed then
      raise exception 'venue_license_exceeded: active venues=% exceeds license limit=%',
        current_count, max_allowed
        using errcode = 'P0001',
              hint = 'Increase max_venues in license_limits or call /api/admin/upgrade-license';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_venue_license_insert on venues;
create trigger trg_check_venue_license_insert
  before insert on venues
  for each row
  execute function check_venue_license_insert();

-- ---------------------------------------------------------------
-- UPDATE トリガー: active を false → true に変更する時もチェック
-- ---------------------------------------------------------------
create or replace function check_venue_license_update() returns trigger as $$
declare
  current_count int;
  max_allowed int;
begin
  if new.active = true and old.active = false then
    select count(*) into current_count from venues where active = true and id != new.id;
    select max_venues into max_allowed from license_limits where id = 1;
    if current_count + 1 > max_allowed then
      raise exception 'venue_license_exceeded: would exceed license limit % (current %, attempting +1)',
        max_allowed, current_count
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_check_venue_license_update on venues;
create trigger trg_check_venue_license_update
  before update on venues
  for each row
  when (old.active is distinct from new.active)
  execute function check_venue_license_update();

-- ---------------------------------------------------------------
-- RLS: クライアントから直接見せない（管理APIのみ service_role で操作）
-- ---------------------------------------------------------------
alter table license_limits enable row level security;
alter table license_changes enable row level security;
-- service_role は RLS をバイパスするので追加ポリシー不要

-- ---------------------------------------------------------------
-- ヘルパー関数: 残ライセンス枠を返す（管理画面用）
-- ---------------------------------------------------------------
create or replace function get_license_status()
returns table (max_venues int, used int, remaining int, plan_name text) as $$
begin
  return query
    select
      ll.max_venues,
      coalesce((select count(*)::int from venues where active = true), 0) as used,
      ll.max_venues - coalesce((select count(*)::int from venues where active = true), 0) as remaining,
      ll.plan_name
    from license_limits ll
    where ll.id = 1;
end;
$$ language plpgsql stable security definer;

grant execute on function get_license_status() to authenticated, anon;
