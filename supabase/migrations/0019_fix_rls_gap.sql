-- 0019: booking_adjustments / booking_change_requests のRLS有効化漏れを修正
-- 0011/0012作成時にRLS有効化文が抜けていた（他の全テーブルは0001以降一貫してRLS有効）。
-- アクセスはNext.jsサーバーのservice_roleキー経由のみ（service_roleはRLSをバイパスするため
-- ポリシー追加は不要。0001/0013/0018と同方針）。

alter table booking_adjustments enable row level security;
alter table booking_change_requests enable row level security;
