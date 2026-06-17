-- サンプル拠点（テスト用）。本番では実際の拠点情報・カレンダーIDに置き換えてください。
insert into venues (slug, name, address, description, open_hour, close_hour, hourly_price, min_hours, max_hours, calendar_id, external_booking_url, active)
values (
  'keisei-koiwa',
  'ブルースペース京成小岩',
  '東京都江戸川区（京成小岩駅 徒歩3分）',
  '会議・セミナー・撮影に使える多目的レンタルスペース。Wi-Fi・モニター完備。',
  0, 24,
  1000,
  1, 8,
  '',  -- ← GoogleカレンダーIDを設定（例: xxxx@group.calendar.google.com）
  '',
  true
)
on conflict (slug) do nothing;
