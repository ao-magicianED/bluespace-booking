-- 0008: 会員番号（member_profiles）
-- 会員登録順に連番を自動付与する。表示は BS-00001 形式（コード側でフォーマット）
create table if not exists member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  member_no bigint generated always as identity,
  created_at timestamptz not null default now()
);
alter table member_profiles enable row level security;

-- 既存会員を登録日順にバックフィル（連番が登録順になる）
insert into member_profiles (user_id)
select id from auth.users order by created_at
on conflict (user_id) do nothing;

-- 新規会員の作成時に自動で番号を振るトリガー
create or replace function handle_new_member()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.member_profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_member();
