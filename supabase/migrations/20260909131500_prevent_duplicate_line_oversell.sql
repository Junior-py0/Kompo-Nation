-- A customized product can appear on separate cart lines for different names.
-- Enforce availability at reservation time so their combined quantity cannot
-- exceed stock, including during concurrent checkouts.

begin;

create or replace function public.enforce_stock_reservation_availability()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stock integer;
  v_reserved integer;
begin
  select pv.stock_quantity
  into strict v_stock
  from public.product_variants pv
  where pv.id = new.variant_id
    and pv.active
  for update;

  select coalesce(sum(sr.quantity),0)
  into v_reserved
  from public.stock_reservations sr
  where sr.variant_id = new.variant_id
    and sr.status = 'active'
    and sr.expires_at > now();

  if new.quantity < 1 or v_stock - v_reserved < new.quantity then
    raise exception 'Insufficient online stock for this product option.';
  end if;

  return new;
end;
$function$;

drop trigger if exists enforce_stock_reservation_availability_on_insert
  on public.stock_reservations;

create trigger enforce_stock_reservation_availability_on_insert
before insert on public.stock_reservations
for each row execute function public.enforce_stock_reservation_availability();

commit;
