-- 0016: 実利用者レビュー（星評価＋コメント）
-- 競合（インスタベース/スペースマーケット/スペイシー）はいずれも実予約者レビューが
-- コンバージョンの中核。本サイトは静的な「ご利用者の声」のみだったため、
-- 「利用完了 → レビュー依頼メール → トークンURLから投稿 → 管理者承認 → 公開」の流れを追加する。

-- レビュー依頼用トークン（予約IDとは別の秘密URL。メール受信者だけが投稿できる）
alter table bookings add column if not exists review_token uuid not null default gen_random_uuid();
-- レビュー依頼メールの送信済みフラグ（冪等化用。reminder_email_sent_at と同じ考え方）
alter table bookings add column if not exists review_request_sent_at timestamptz;

create unique index if not exists idx_bookings_review_token on bookings(review_token);

create table if not exists booking_reviews (
  id uuid default gen_random_uuid() primary key,
  -- 1予約=1レビュー（実際に利用した予約に紐づくレビューだけを受け付ける）
  booking_id uuid not null unique references bookings(id),
  venue_id uuid not null references venues(id),
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  -- 利用用途（会議・パーティー等。予約時のpurposeを初期値にする）
  purpose text not null default '',
  -- 表示名（「田中様」「T.K.」など投稿者が選んだ表記。空なら「ご利用者」表示）
  reviewer_name text not null default '',
  status text not null default 'pending' check (status in (
    'pending',    -- 投稿済み・承認待ち
    'published',  -- 公開中
    'rejected'    -- 非公開（不適切・重複など）
  )),
  -- 運営からの返信（公開レビューの下に表示。ホスト返信は信頼性向上の定番機能）
  host_reply text,
  host_replied_at timestamptz,
  submitted_at timestamptz not null default now(),
  published_at timestamptz,
  created_at timestamptz default now() not null
);

create index if not exists idx_reviews_venue_published
  on booking_reviews(venue_id, published_at desc) where status = 'published';
create index if not exists idx_reviews_status on booking_reviews(status);

-- RLS: クライアントからの直接アクセスを全面禁止（service_role経由のみ。0001と同方針）
alter table booking_reviews enable row level security;
