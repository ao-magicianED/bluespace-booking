-- 0007: FAQの拠点別上書き（jsonb）＋ 写真ギャラリーのDB管理化
-- faqs: nullならコード内のデフォルトFAQを表示。設定すると上書き
alter table venues add column if not exists faqs jsonb;

-- ギャラリー写真（既存の静的ファイルもsrcにパスを入れて行として管理する）
create table if not exists venue_photos (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references venues(id) on delete cascade,
  category_id text not null,
  category_label text not null,
  cat_sort int not null default 0,
  src text not null,
  alt text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_venue_photos_venue on venue_photos(venue_id, cat_sort, sort);
alter table venue_photos enable row level security;

-- アップロード写真の保存先（公開バケット）
insert into storage.buckets (id, name, public)
values ('venue-photos', 'venue-photos', true)
on conflict (id) do nothing;
