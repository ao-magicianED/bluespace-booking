-- =============================================================
-- 2026-09 価格改定 シード
-- ⚠️ このファイルは migration ではない。オーナー承認後（ロールアウト手順4）に
--    Supabase SQL Editor で手動実行する。0022適用＋新コードのデプロイが前提。
-- 投入は replace_venue_price_bands RPC 経由（1トランザクション・検証つき）。
-- 京成小岩は帯なし（現行フラット維持）のため対象外。
-- 初回シード直後のロールバックは `delete from venue_price_bands;` 1文で
-- 現行フラット価格へ即時復帰できる。
-- =============================================================

do $$
declare
  v_id uuid;
begin
  -- ---------- 上野御徒町 ----------
  select id into strict v_id from venues where slug = 'ueno-okachimachi';
  perform replace_venue_price_bands(v_id, 'weekday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1140},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":1600},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2210},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":2370},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1030},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1040},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":1430},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1540}
  ]'::jsonb);
  perform replace_venue_price_bands(v_id, 'holiday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1140},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":2430},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":3500},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":3960},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1030},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1640},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":2370},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":2680}
  ]'::jsonb);

  -- ---------- 神田 ----------
  select id into strict v_id from venues where slug = 'kanda';
  perform replace_venue_price_bands(v_id, 'weekday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1130},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":1820},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2330},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":2510},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1020},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1040},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":1330},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1430}
  ]'::jsonb);
  perform replace_venue_price_bands(v_id, 'holiday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1140},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":2730},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":3300},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":3990},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1030},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1980},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":2390},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":2890}
  ]'::jsonb);

  -- ---------- 上野駅前4A ----------
  select id into strict v_id from venues where slug = 'ueno-4a';
  perform replace_venue_price_bands(v_id, 'weekday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1140},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":1690},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2590},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":1840},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1030},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1000},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":1430},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1020}
  ]'::jsonb);
  perform replace_venue_price_bands(v_id, 'holiday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1140},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":2940},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2940},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":2640},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1030},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":2060},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":2060},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1850}
  ]'::jsonb);

  -- ---------- 上野駅前4B ----------
  select id into strict v_id from venues where slug = 'ueno-4b';
  perform replace_venue_price_bands(v_id, 'weekday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1140},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":1860},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2130},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":2260},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1030},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1430},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":1640},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1750}
  ]'::jsonb);
  perform replace_venue_price_bands(v_id, 'holiday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1140},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":2250},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2820},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":3050},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1030},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":2060},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":2580},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":2790}
  ]'::jsonb);

  -- ---------- 白金高輪 ----------
  select id into strict v_id from venues where slug = 'shirokane-takanawa';
  perform replace_venue_price_bands(v_id, 'weekday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1160},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":1300},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":1570},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":1300},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1040},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1040},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":1250},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1040}
  ]'::jsonb);
  perform replace_venue_price_bands(v_id, 'holiday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1160},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":2090},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2790},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":2090},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1040},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1560},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":2080},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1560}
  ]'::jsonb);

  -- ---------- 西新宿403 ----------
  select id into strict v_id from venues where slug = 'nishi-shinjuku';
  perform replace_venue_price_bands(v_id, 'weekday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":1160},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":1440},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":1730},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":1440},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":1040},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":1040},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":1250},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":1040}
  ]'::jsonb);
  perform replace_venue_price_bands(v_id, 'holiday', '[
    {"tier":"standard","start_hour":0,"end_hour":6,"hourly_price":2120},
    {"tier":"standard","start_hour":6,"end_hour":12,"hourly_price":2120},
    {"tier":"standard","start_hour":12,"end_hour":18,"hourly_price":2630},
    {"tier":"standard","start_hour":18,"end_hour":24,"hourly_price":2440},
    {"tier":"repeat","start_hour":0,"end_hour":6,"hourly_price":2080},
    {"tier":"repeat","start_hour":6,"end_hour":12,"hourly_price":2080},
    {"tier":"repeat","start_hour":12,"end_hour":18,"hourly_price":2580},
    {"tier":"repeat","start_hour":18,"end_hour":24,"hourly_price":2390}
  ]'::jsonb);
end $$;

-- ---------- 投入後の検証（期待: 6拠点 × 2日種 × 2tier × 4帯 = 96行） ----------
select count(*) as total_rows from venue_price_bands;

-- 拠点・日種・tierごとの帯数（すべて4になること）
select v.slug, b.day_type, b.tier, count(*) as bands,
       min(b.start_hour) as min_start, max(b.end_hour) as max_end
  from venue_price_bands b join venues v on v.id = b.venue_id
 group by v.slug, b.day_type, b.tier
 order by v.slug, b.day_type, b.tier;

-- standard >= repeat の全帯確認（0件になること）
select v.slug, s.day_type, s.start_hour, s.hourly_price as standard, r.hourly_price as repeat
  from venue_price_bands s
  join venue_price_bands r
    on r.venue_id = s.venue_id and r.day_type = s.day_type
   and r.start_hour = s.start_hour and r.tier = 'repeat'
  join venues v on v.id = s.venue_id
 where s.tier = 'standard' and s.hourly_price < r.hourly_price;
