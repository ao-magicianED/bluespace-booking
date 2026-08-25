-- =============================================================
-- 0021: 広告アトリビューション（Google広告のコンバージョン計測）
--
-- 背景:
--   旧直販サイト（UPNOW）では予約完了ページが upnow.jp ドメイン上にあり、
--   自社のタグを置けなかったためコンバージョンが一度も取れなかった。
--   自社サイトは決済完了まで自ドメインで完結するため、ここで確実に取り切る。
--
-- 方式:
--   ブラウザ計測（gtag）だけに頼らず、**サーバー側の確定情報**を正本にする。
--   ① 広告クリック時に付く gclid（Google Click ID）をランディングで受け取り、
--      Cookieに保存 → 決済リクエストに同梱 → この列に保存
--   ② Stripe Webhook で決済確定した「その瞬間」を conversion_reported_at に記録
--   ③ 確定分だけをGoogle広告へオフラインコンバージョンとして取り込む
--
--   ブラウザ側の計測は広告ブロッカー・タブ即閉じ・リダイレクト失敗で落ちるが、
--   この経路は決済確定というサーバー事実に紐づくため落ちない。
--
-- 注意:
--   gclid は「広告クリックの識別子」であり個人情報ではない。
--   ただし予約と紐づく以上、他の予約者情報と同じ扱いで保護する（RLSは bookings に準拠）。
-- =============================================================

-- ---------------------------------------------------------------
-- 予約に広告の出どころを記録する
-- ---------------------------------------------------------------
alter table bookings add column if not exists gclid text;
alter table bookings add column if not exists gbraid text;
alter table bookings add column if not exists wbraid text;
alter table bookings add column if not exists utm_source text;
alter table bookings add column if not exists utm_medium text;
alter table bookings add column if not exists utm_campaign text;
alter table bookings add column if not exists landing_path text;

-- Google広告へ送信済みかどうか（未送信の抽出に使う）
alter table bookings add column if not exists conversion_exported_at timestamptz;

comment on column bookings.gclid is 'Google広告のクリックID。検索・ディスプレイ経由';
comment on column bookings.gbraid is 'iOSアプリ→Web計測用のクリックID';
comment on column bookings.wbraid is 'iOS Web→Web計測用のクリックID';
comment on column bookings.conversion_exported_at is 'Google広告へオフラインコンバージョンを取り込んだ日時。nullなら未送信';

-- 未送信の確定予約を素早く引くための部分インデックス
create index if not exists idx_bookings_conversion_pending
  on bookings (created_at)
  where gclid is not null and conversion_exported_at is null;

-- 出どころ別の集計用
create index if not exists idx_bookings_utm_source
  on bookings (utm_source, created_at)
  where utm_source is not null;

-- ---------------------------------------------------------------
-- Google広告オフラインコンバージョン取込用のビュー
--
-- 「決済が確定し、キャンセルされておらず、まだ送っていない」予約だけを出す。
-- Google広告のインポート形式（Parameters行つきCSV）に合わせて整形する。
-- 金額は手取りではなく利用者の支払額（税込）を使う。
-- 調整（adjusted_total）がある場合はそちらを優先。
-- ---------------------------------------------------------------
create or replace view google_ads_conversions
  with (security_invoker = true) as
select
  b.gclid,
  b.gbraid,
  b.wbraid,
  -- Google広告は 'yyyy-MM-dd HH:mm:ss+09:00' 形式を受け付ける
  to_char(b.created_at at time zone 'Asia/Tokyo', 'YYYY-MM-DD HH24:MI:SS') || '+09:00'
    as conversion_time,
  coalesce(b.adjusted_total, b.total_amount) as conversion_value,
  'JPY' as currency,
  b.id as booking_id,
  v.slug as venue_slug,
  b.utm_source,
  b.utm_campaign
from bookings b
join venues v on v.id = b.venue_id
where b.booking_status = 'confirmed'
  and b.payment_status in ('paid', 'partially_refunded')
  and (b.gclid is not null or b.gbraid is not null or b.wbraid is not null)
  and b.conversion_exported_at is null;

-- ---------------------------------------------------------------
-- ビューの権限を絞る
--
-- ビュー自体にはRLSを掛けられない。さらに security_invoker を付けないと
-- ビューは所有者権限で実行され、bookings のRLSを素通りしてしまう。
-- このリポジトリは「anonキーは公開される前提」で設計しているため
-- （0001_init.sql の関数と同じ方針）、明示的に読める相手を service_role だけにする。
-- ここを省くと gclid・支払額・拠点slug・UTM が未認証で取得できてしまう。
-- ---------------------------------------------------------------
revoke all on google_ads_conversions from public, anon, authenticated;
grant select on google_ads_conversions to service_role;
