-- 0006: 予約人数・領収書宛名変更1回制限・入退室案内
-- party_size: 予約時の利用人数（既存予約はnull）
alter table bookings add column if not exists party_size int
  check (party_size is null or (party_size between 1 and 100));

-- receipt_name_changed_at: 宛名を「変更」した日時。1回変更したら以降は変更不可
alter table bookings add column if not exists receipt_name_changed_at timestamptz;

-- access_info: 入退室のご案内（鍵・入室方法など）。確定予約者のみに表示するためvenuesに持つ
alter table venues add column if not exists access_info text not null default '';
