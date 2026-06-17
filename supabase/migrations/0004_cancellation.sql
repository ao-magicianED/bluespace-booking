-- =============================================================
-- フェーズ2-③: キャンセル機能（venueごとの段階制ポリシー）
-- =============================================================

-- 各拠点でポリシーを上書き可能。null=システムデフォルト適用
-- {"tiers": [{"days_before": 8, "percent": 0}, {"days_before": 2, "percent": 50}, {"days_before": 0, "percent": 100}]}
-- 解釈: 利用日のN日前以上ならN行目のpercent（顧客負担%）。
--       N=8で0%（全額返金）/ N=2で50% / N=0で100%（返金なし）
alter table venues add column if not exists cancellation_policy jsonb;

-- インスタベース標準準拠の段階制を全拠点デフォルト適用
update venues set cancellation_policy = '{
  "tiers": [
    {"days_before": 8, "percent": 0},
    {"days_before": 2, "percent": 50},
    {"days_before": 0, "percent": 100}
  ]
}'::jsonb where cancellation_policy is null;
