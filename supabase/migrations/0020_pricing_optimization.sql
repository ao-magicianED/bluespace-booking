-- =============================================================
-- 0020: 価格最適化（STEP 0） — 予約カーブの記録／価格施策の台帳／外部モール予約の取込
-- 2026-07-19 のCSV分析（インスタベース・スペースマーケット・UPNOW）を受けて、
-- 「指示 → 実施 → 効果測定 → 翌週の指示」ループを毎週回すための記録基盤。
-- =============================================================

-- ---------------------------------------------------------------
-- 予約カーブ（ペーススナップショット）
-- 「利用日の何日前に何時間埋まっていたか」を拠点×利用日ごとに毎日記録する。
-- occupancy_daily_snapshots（0018）は「過去の実績」を直近数日分だけ再計算して残す設計のため、
-- 「価格を決めた時点で、その先の日がどれだけ埋まっていたか」を後から復元できない。
-- 本テーブルは未来向きの窓（当面35日先まで）を毎日そのままupsertし、captured_on（記録日）を
-- 主キーに含めて過去分を上書きしない（同日の再実行はcronの再試行として上書きされるだけで重複しない）。
create table if not exists occupancy_pace_snapshots (
  captured_on date not null,
  venue_id uuid not null references venues(id),
  service_date date not null,
  -- 自社確定予約のみの埋まり時間
  own_busy_hours numeric not null check (own_busy_hours >= 0),
  -- 自社確定予約＋外部サイト予約・手動ブロック（Googleカレンダーbusy）を合算した埋まり時間。
  -- カレンダー取得に失敗した日はnull（不完全な値を「正常値」として残さないため）
  combined_busy_hours numeric check (
    combined_busy_hours is null
    or (combined_busy_hours >= own_busy_hours and combined_busy_hours <= capacity_hours)
  ),
  capacity_hours numeric not null check (capacity_hours >= 0),
  created_at timestamptz not null default now(),
  primary key (captured_on, venue_id, service_date),
  check (own_busy_hours <= capacity_hours)
);

create index if not exists idx_pace_snapshots_venue_service
  on occupancy_pace_snapshots(venue_id, service_date);

alter table occupancy_pace_snapshots enable row level security;

-- ---------------------------------------------------------------
-- 価格施策の台帳（指示・実施・結果）
-- 週次「価格指示書」で決めた内容と、スタッフが実際に設定した結果を1行にまとめて記録する。
-- 1人〜数人運用のため pricing_runs/recommendations 等に分割せず、単一テーブルに留める
-- （拠点数・件数の規模が大きくなったら分割を検討）。
create table if not exists price_actions (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id),
  -- 対象枠（利用日ベース。曜日テンプレートではなく実施週の具体的な日付を入れる）
  target_date date not null,
  start_hour numeric not null check (start_hour >= 0 and start_hour <= 24),
  end_hour numeric not null check (end_hour > start_hour and end_hour <= 24),
  channel text not null check (channel in ('instabase', 'spacemarket', 'upnow', 'own')),
  -- 変更前の掲載価格（円/h・スタッフが確認して記入。未確認ならnull）
  previous_price int check (previous_price is null or previous_price >= 0),
  -- 指示した特価（円/h）
  planned_price int not null check (planned_price >= 0),
  -- 比較用に価格を据え置く「保護枠」の指示か（trueなら planned_price は現状維持の意味）
  is_holdout boolean not null default false,
  reason text not null default '',
  -- draft: 指示のみ（未実施） / applied: スタッフが設定済み / reverted: 定価に戻した / expired: 対象日が過ぎた
  status text not null default 'draft' check (status in ('draft', 'applied', 'reverted', 'expired')),
  -- 実施記録
  applied_price int check (applied_price is null or applied_price >= 0),
  applied_at timestamptz,
  applied_by text,
  result_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_price_actions_venue_date
  on price_actions(venue_id, target_date);
create index if not exists idx_price_actions_status
  on price_actions(status);

alter table price_actions enable row level security;

-- ---------------------------------------------------------------
-- 外部モール予約の取込（インスタベース／スペースマーケット／UPNOWのCSV）
-- スタッフが手動エクスポートしたCSVを管理画面からアップロードして取り込む。
-- 同じCSVを再アップロードしても重複しないよう (channel, external_booking_id) をユニークにする。
create table if not exists external_bookings (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('instabase', 'spacemarket', 'upnow')),
  external_booking_id text not null,
  -- venuesに紐付けできた場合のみセット（CSVの表記ゆれでマッチできない行はnullのまま保持し、raw_venue_nameで後から追える）
  venue_id uuid references venues(id),
  raw_venue_name text not null default '',
  status text not null check (status in ('confirmed', 'cancelled', 'other')),
  booked_at date,
  start_at timestamptz,
  end_at timestamptz,
  hours numeric,
  gross_amount int not null default 0,
  net_amount int,
  coupon_amount int not null default 0,
  plan_name text,
  purpose text,
  imported_at timestamptz not null default now(),
  unique (channel, external_booking_id)
);

create index if not exists idx_external_bookings_venue_start
  on external_bookings(venue_id, start_at);
create index if not exists idx_external_bookings_channel_booked
  on external_bookings(channel, booked_at);

alter table external_bookings enable row level security;

-- 取込バッチの履歴（いつ・どのチャネルのCSVを・何件取り込んだか）
create table if not exists external_import_batches (
  id uuid primary key default gen_random_uuid(),
  channel text not null check (channel in ('instabase', 'spacemarket', 'upnow')),
  file_name text not null default '',
  row_count int not null default 0,
  inserted_count int not null default 0,
  updated_count int not null default 0,
  unmatched_venue_count int not null default 0,
  imported_by text,
  created_at timestamptz not null default now()
);

alter table external_import_batches enable row level security;
