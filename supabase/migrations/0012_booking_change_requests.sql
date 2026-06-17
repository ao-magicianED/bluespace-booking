-- 予約時間変更申請テーブル
-- お客様の延長（仮押さえ→決済完了で確定）と短縮/時間ずらし（管理者承認制）、
-- および管理者の直接変更の監査ログを兼ねる。
CREATE TABLE IF NOT EXISTS booking_change_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),

  -- 申請区分
  --   self_extend      : お客様 延長（追加請求・仮押さえ→決済完了で確定）
  --   self_modify      : お客様 短縮/時間ずらし（管理者承認制）
  --   admin_modify     : 管理者 直接変更（即時反映の監査ログ）
  request_type text NOT NULL CHECK (request_type IN ('self_extend', 'self_modify', 'admin_modify')),

  -- 変更前後の時刻
  previous_start_at timestamptz NOT NULL,
  previous_end_at timestamptz NOT NULL,
  requested_start_at timestamptz NOT NULL,
  requested_end_at timestamptz NOT NULL,

  -- 料金スナップショット（申請作成時点で確定）
  previous_amount int NOT NULL,
  new_amount int NOT NULL,
  refund_amount int NOT NULL DEFAULT 0,
  extra_amount int NOT NULL DEFAULT 0,

  -- キャンセル料計算の基準時刻（申請作成時刻を保存することで、
  -- 管理者承認が遅れてもお客様が不利にならないようにする）
  cancel_fee_basis_at timestamptz NOT NULL,

  -- 状態
  --   pending          : 管理者承認待ち（self_modify）
  --   pending_payment  : 決済待ち（self_extend、Checkout発行済み）
  --   approved         : 承認・確定（時刻反映済み）
  --   rejected         : 却下
  --   expired          : 期限切れ（Checkout未決済 / 申請放置）
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pending_payment', 'approved', 'rejected', 'expired')),

  -- Stripe参照
  stripe_session_id text,
  stripe_payment_intent_id text,
  stripe_refund_id text,

  -- メモ・判断者
  reason text NOT NULL DEFAULT '',
  decided_at timestamptz,
  decided_by text,
  admin_note text NOT NULL DEFAULT '',

  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_change_requests_booking ON booking_change_requests(booking_id);
CREATE INDEX IF NOT EXISTS idx_change_requests_status ON booking_change_requests(status) WHERE status IN ('pending', 'pending_payment');
CREATE INDEX IF NOT EXISTS idx_change_requests_session ON booking_change_requests(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- 同一予約への重複申請を防ぐ（pending/pending_payment は1件まで）
CREATE UNIQUE INDEX IF NOT EXISTS idx_change_requests_one_active_per_booking
  ON booking_change_requests(booking_id)
  WHERE status IN ('pending', 'pending_payment');
