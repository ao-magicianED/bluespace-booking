-- 0015: 実収額の過小計上バグ修正（realizedRevenue）
--
-- 問題: adjusted_total は増額・減額の両方で更新されるが意味が異なる。
--   増額時: adjusted_total = 実際に払われた新総額
--   減額時: adjusted_total = 返金後の目標金額（差額は refunded_amount にも計上済み）
-- そのため「adjusted_total - refunded_amount」だと減額（時間短縮・料金減額）で
-- 返金分が二重に差し引かれ、実収額が過小計上されていた。
--
-- 対策: 「実際に追加で払われた累計額」を extra_paid_amount として別管理する。
--   実収額 = total_amount + extra_paid_amount - refunded_amount
-- extra_paid_amount は増額（price_increase完了・延長決済完了）の時だけ加算し、
-- 減額（返金）では一切変更しない。これにより二重控除が起きなくなる。
alter table bookings
  add column if not exists extra_paid_amount int not null default 0;

comment on column bookings.extra_paid_amount is
  '追加請求(price_increase)完了・予約延長決済完了で積み上がる、当初total_amountを超えて実際に支払われた累計額。減額(返金)では変更しない。';

-- 既存データの補正: 完了済みの増額調整・承認済みの延長/増額変更申請から積み上げる
update bookings b
set extra_paid_amount = b.extra_paid_amount + sub.total
from (
  select booking_id, sum(amount_delta) as total
  from booking_adjustments
  where adjustment_type = 'price_increase' and status = 'completed'
  group by booking_id
) sub
where b.id = sub.booking_id;

update bookings b
set extra_paid_amount = b.extra_paid_amount + sub.total
from (
  select booking_id, sum(extra_amount) as total
  from booking_change_requests
  where status = 'approved' and extra_amount > 0
  group by booking_id
) sub
where b.id = sub.booking_id;
