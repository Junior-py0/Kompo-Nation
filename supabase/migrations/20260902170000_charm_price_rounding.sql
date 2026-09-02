-- RETAIL CHARM PRICING V1
-- Calculate the configured marketplace markup, round the result to the nearest
-- R50, then price it R1 below that threshold. The vendor base price is a hard
-- floor, so retail rounding can reduce Kompo Nation's markup but can never
-- reduce the store's undiscounted settlement.

begin;

create or replace function public.customer_price_cents(
  p_base_cents bigint,
  p_markup_rate_bps integer
)
returns bigint
language sql
immutable
strict
set search_path = ''
as $function$
  with price_target as (
    select
      greatest(0,p_base_cents) as base_cents,
      greatest(0,p_base_cents)::numeric *
        (10000 + greatest(0,p_markup_rate_bps)) /
        10000 as marked_up_cents
  )
  select greatest(
    base_cents,
    (round(marked_up_cents / 5000) * 5000 - 100)::bigint
  )
  from price_target;
$function$;

comment on function public.customer_price_cents(bigint,integer) is
  'Returns the customer retail price: vendor base plus markup, rounded to the nearest R50 and reduced by R1, without ever falling below vendor base.';

do $tests$
begin
  if public.customer_price_cents(55000,1000) <> 59900 then
    raise exception 'Charm pricing check failed: R550 plus 10%% must retail at R599';
  end if;

  if public.customer_price_cents(64091,1000) <> 69900 then
    raise exception 'Charm pricing check failed: a R705 target must retail at R699';
  end if;

  if public.customer_price_cents(66818,1000) <> 74900 then
    raise exception 'Charm pricing check failed: a R735 target must retail at R749';
  end if;

  if public.customer_price_cents(10000,0) < 10000 then
    raise exception 'Charm pricing check failed: customer price cannot fall below vendor base';
  end if;
end;
$tests$;

commit;
