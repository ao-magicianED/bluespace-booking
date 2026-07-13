-- 0018: 稼働状況の日次スナップショット保存
-- 日次レポート（HTMLメール化）はその場で毎日集計し直すだけで、過去の実績を残していなかった。
-- 蓄積すれば季節変動・値下げ施策の効果測定・拠点間比較などの分析が後からできるようになる。
-- 日次cronが直近数日分（アプリ側のSNAPSHOT_BACKFILL_DAYS、既定3日）を毎回upsertする。
-- cronが数日止まっても次回実行時に欠損を埋められるようにするため（同日再実行でも上書きされるだけで重複しない）。
create table if not exists occupancy_daily_snapshots (
  date date not null,
  venue_id uuid not null references venues(id),
  -- 自社確定予約のみの埋まり時間（売上に直結する実績値）
  own_busy_hours numeric not null check (own_busy_hours >= 0),
  -- 自社確定予約＋外部サイト予約・手動ブロック（Googleカレンダーbusy）を合算した埋まり時間。
  -- カレンダー取得に失敗した日はnull（外部予約分を含まない不完全な値を「正常値」として残さないため）
  combined_busy_hours numeric check (
    combined_busy_hours is null
    or (combined_busy_hours >= own_busy_hours and combined_busy_hours <= capacity_hours)
  ),
  capacity_hours numeric not null check (capacity_hours >= 0),
  captured_at timestamptz not null default now(),
  -- upsert時にアプリ側で更新する（再計算で値が変わったことを追跡できるように）
  updated_at timestamptz not null default now(),
  primary key (date, venue_id),
  check (own_busy_hours <= capacity_hours)
);

create index if not exists idx_occupancy_snapshots_venue_date
  on occupancy_daily_snapshots(venue_id, date);

-- RLS: クライアントからの直接アクセスを全面禁止（service_role経由のみ。0001と同方針）
alter table occupancy_daily_snapshots enable row level security;
