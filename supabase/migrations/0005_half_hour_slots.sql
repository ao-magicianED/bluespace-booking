-- 0005_half_hour_slots.sql
-- スロット単位を30分に変更するためのマイグレーション
-- min_hours / max_hours を numeric に変更し、0.5刻みを許可する

-- 1. min_hours の型を numeric に変更（0.5以上を許可）
ALTER TABLE venues ALTER COLUMN min_hours TYPE numeric(3,1) USING min_hours::numeric(3,1);
ALTER TABLE venues ALTER COLUMN min_hours SET DEFAULT 0.5;
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_min_hours_check;
ALTER TABLE venues ADD CONSTRAINT venues_min_hours_check CHECK (min_hours >= 0.5);

-- 2. max_hours の型を numeric に変更
ALTER TABLE venues ALTER COLUMN max_hours TYPE numeric(3,1) USING max_hours::numeric(3,1);
ALTER TABLE venues DROP CONSTRAINT IF EXISTS venues_max_hours_check;
ALTER TABLE venues ADD CONSTRAINT venues_max_hours_check CHECK (max_hours >= min_hours);

-- 3. 既存データを更新: min_hours を 0.5 に変更（30分から予約可能に）
UPDATE venues SET min_hours = 0.5 WHERE min_hours = 1;

-- Note: no_double_booking 排他制約は tstzrange(start_at, end_at, '[)') ベースのため
-- 30分単位でも正しく機能する。変更不要。
