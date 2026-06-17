-- 0010: クーポン使用回数の原子的消化（1回限りクーポンのすり抜け防止）
-- 同じ1回限りクーポンで複数pendingを作って両方支払うケースに備え、
-- used_count < max_uses を条件にした原子的UPDATEへ変更し、消化できたかを返す。
drop function if exists increment_coupon_use(text);
create or replace function increment_coupon_use(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update coupons
     set used_count = used_count + 1
   where upper(code) = upper(p_code)
     and (max_uses is null or used_count < max_uses);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
revoke execute on function increment_coupon_use(text) from public, anon, authenticated;
grant execute on function increment_coupon_use(text) to service_role;
