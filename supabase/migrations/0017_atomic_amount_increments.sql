-- 0017: 金額カラム（refunded_amount / extra_paid_amount）加算の原子化
--
-- 問題: これまでは「アプリ側でSELECTしたbookingの値 + delta」をJSで計算してから
-- UPDATEしていた（例: refunded_amount: (booking.refunded_amount ?? 0) + actualRefunded）。
-- 同一予約に対して2つの処理がほぼ同時に走ると（例: セルフキャンセルと管理者操作の競合、
-- 延長決済Webhookの再送等）、両方とも同じ古い値を読んでから書き込むため、片方の加算が
-- 失われる（lost update）。
--
-- 対策: 加算そのものをDB側の単一UPDATE文で完結させる。Postgresは1つのUPDATE文の中で
-- 行ロックを取ってSET句を評価するため、同時に2つのUPDATEが同じ行に届いても
-- 片方がコミットしてからもう片方が実行される＝両方の加算が正しく反映される。

create or replace function increment_extra_paid_amount(p_booking_id uuid, p_delta int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new int;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'invalid_delta';
  end if;

  update bookings
     set extra_paid_amount = extra_paid_amount + p_delta,
         updated_at = now()
   where id = p_booking_id
  returning extra_paid_amount into v_new;

  if v_new is null then
    raise exception 'booking_not_found';
  end if;

  return v_new;
end;
$$;

-- refunded_amountの加算と同時に payment_status も再計算する。
-- 「実際に支払われた総額（total_amount + extra_paid_amount）」を全額返金しきったときだけ
-- refunded、それ以外は partially_refunded とする（src/lib/adjustment.ts の
-- paymentStatusAfterRefund() と同じ判定式。JS側の関数はテスト・ドキュメント用に残しているが、
-- 実際の書き込みはこの関数を経由するため、判定式を変更する際は両方直すこと）。
create or replace function increment_refunded_amount(p_booking_id uuid, p_delta int)
returns table(refunded_amount int, payment_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_refunded int;
  v_status text;
begin
  if p_delta is null or p_delta <= 0 then
    raise exception 'invalid_delta';
  end if;

  update bookings b
     set refunded_amount = b.refunded_amount + p_delta,
         payment_status = case
           when (b.refunded_amount + p_delta) >= (b.total_amount + b.extra_paid_amount) then 'refunded'
           else 'partially_refunded'
         end,
         updated_at = now()
   where b.id = p_booking_id
  returning b.refunded_amount, b.payment_status
    into v_refunded, v_status;

  if v_refunded is null then
    raise exception 'booking_not_found';
  end if;

  refunded_amount := v_refunded;
  payment_status := v_status;
  return next;
end;
$$;

revoke execute on function increment_extra_paid_amount(uuid, int) from public, anon, authenticated;
grant execute on function increment_extra_paid_amount(uuid, int) to service_role;
revoke execute on function increment_refunded_amount(uuid, int) from public, anon, authenticated;
grant execute on function increment_refunded_amount(uuid, int) to service_role;
