-- 0011: 予約料金の事後調整（増額・減額）とカスタムキャンセル料
-- booking_adjustments テーブルで全ての料金変更を監査ログとして記録する。

-- 調整後の実効金額（null = 調整なし = total_amount のまま）
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adjusted_total int;

-- 料金調整の履歴テーブル
CREATE TABLE IF NOT EXISTS booking_adjustments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id),
  adjustment_type text NOT NULL CHECK (adjustment_type IN (
    'price_decrease',       -- 減額（部分返金）
    'price_increase',       -- 増額（追加請求）
    'cancel_fee_override'   -- カスタムキャンセル料
  )),
  previous_amount int NOT NULL,
  new_amount int NOT NULL,
  amount_delta int NOT NULL,   -- 増額=正、減額=負
  reason text NOT NULL DEFAULT '',
  stripe_refund_id text,
  stripe_session_id text,
  stripe_payment_intent_id text,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN (
    'pending_payment',  -- 追加請求の決済待ち
    'completed',        -- 完了
    'failed',           -- 失敗
    'expired'           -- 決済期限切れ
  )),
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adjustments_booking ON booking_adjustments(booking_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_session ON booking_adjustments(stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
