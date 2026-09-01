-- Store-scoped discount codes with atomic checkout usage reservations.
begin;

create table if not exists public.discount_codes (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  code text not null,
  name text,
  discount_type text not null check (discount_type in ('percentage','fixed')),
  percentage_bps integer,
  fixed_amount_cents bigint,
  minimum_subtotal_cents bigint not null default 0 check (minimum_subtotal_cents >= 0),
  usage_limit integer not null check (usage_limit > 0),
  used_count integer not null default 0 check (used_count >= 0),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discount_codes_code_format check (code = upper(code) and code ~ '^[A-Z0-9][A-Z0-9_-]{2,31}$'),
  constraint discount_codes_value_check check (
    (discount_type = 'percentage' and percentage_bps between 1 and 10000 and fixed_amount_cents is null)
    or
    (discount_type = 'fixed' and fixed_amount_cents > 0 and percentage_bps is null)
  ),
  constraint discount_codes_window_check check (expires_at is null or expires_at > starts_at)
);

create unique index if not exists discount_codes_code_unique
  on public.discount_codes(code);
create index if not exists discount_codes_vendor_created_idx
  on public.discount_codes(vendor_id, created_at desc);

alter table public.orders
  add column if not exists merchandise_subtotal_cents bigint,
  add column if not exists discount_total_cents bigint not null default 0,
  add column if not exists discount_code_id uuid references public.discount_codes(id) on delete set null,
  add column if not exists discount_code text;

update public.orders
set merchandise_subtotal_cents = merchandise_total_cents
where merchandise_subtotal_cents is null;

alter table public.orders
  alter column merchandise_subtotal_cents set not null;

alter table public.vendor_orders
  add column if not exists merchandise_subtotal_cents bigint,
  add column if not exists discount_total_cents bigint not null default 0,
  add column if not exists discount_code_id uuid references public.discount_codes(id) on delete set null,
  add column if not exists discount_code text;

update public.vendor_orders
set merchandise_subtotal_cents = merchandise_total_cents
where merchandise_subtotal_cents is null;

alter table public.vendor_orders
  alter column merchandise_subtotal_cents set not null;

alter table public.order_items
  add column if not exists subtotal_cents bigint,
  add column if not exists discount_cents bigint not null default 0;

update public.order_items
set subtotal_cents = line_total_cents
where subtotal_cents is null;

alter table public.order_items
  alter column subtotal_cents set not null;

-- The existing checkout function inserts only the original columns. Populate
-- the immutable pre-discount values before NOT NULL validation so both the
-- legacy no-code path and the v3 discount wrapper remain compatible.
create or replace function public.set_order_discount_defaults()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if tg_table_name = 'order_items' then
    new.subtotal_cents := coalesce(new.subtotal_cents,new.line_total_cents);
    new.discount_cents := coalesce(new.discount_cents,0);
  else
    new.merchandise_subtotal_cents := coalesce(new.merchandise_subtotal_cents,new.merchandise_total_cents);
    new.discount_total_cents := coalesce(new.discount_total_cents,0);
  end if;
  return new;
end;
$function$;

drop trigger if exists set_order_discount_defaults_on_order on public.orders;
create trigger set_order_discount_defaults_on_order
before insert on public.orders
for each row execute function public.set_order_discount_defaults();

drop trigger if exists set_order_discount_defaults_on_vendor_order on public.vendor_orders;
create trigger set_order_discount_defaults_on_vendor_order
before insert on public.vendor_orders
for each row execute function public.set_order_discount_defaults();

drop trigger if exists set_order_discount_defaults_on_order_item on public.order_items;
create trigger set_order_discount_defaults_on_order_item
before insert on public.order_items
for each row execute function public.set_order_discount_defaults();

create table if not exists public.discount_redemptions (
  id uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id) on delete restrict,
  customer_id uuid not null references public.profiles(id) on delete restrict,
  discount_cents bigint not null check (discount_cents > 0),
  status text not null default 'reserved' check (status in ('reserved','redeemed','released')),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (discount_code_id, order_id),
  unique (order_id)
);

create index if not exists discount_redemptions_usage_idx
  on public.discount_redemptions(discount_code_id, status, expires_at);

alter table public.discount_codes enable row level security;
alter table public.discount_redemptions enable row level security;

drop policy if exists discount_codes_authorized_select on public.discount_codes;
create policy discount_codes_authorized_select
on public.discount_codes for select to authenticated
using (public.is_platform_admin() or public.is_vendor_member(vendor_id));

drop policy if exists discount_redemptions_authorized_select on public.discount_redemptions;
create policy discount_redemptions_authorized_select
on public.discount_redemptions for select to authenticated
using (public.is_platform_admin() or public.is_vendor_member(vendor_id));

revoke all on public.discount_codes, public.discount_redemptions from anon, authenticated;
grant select on public.discount_codes, public.discount_redemptions to authenticated;
grant all on public.discount_codes, public.discount_redemptions to service_role;

create or replace function public.can_manage_vendor_discounts(p_vendor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.is_platform_admin()
    or exists (
      select 1
      from public.vendor_members vm
      where vm.vendor_id = p_vendor_id
        and vm.user_id = auth.uid()
        and vm.status = 'active'
        and vm.role in ('owner','manager')
    );
$function$;

create or replace function public.create_store_discount_code(
  p_vendor_id uuid,
  p_code text,
  p_name text,
  p_discount_type text,
  p_percentage numeric,
  p_fixed_amount_cents bigint,
  p_minimum_subtotal_cents bigint,
  p_usage_limit integer,
  p_starts_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_code text;
  v_prefix text;
  v_percentage_bps integer;
  v_id uuid;
begin
  if not public.can_manage_vendor_discounts(p_vendor_id) then
    raise exception 'Only a store owner, manager or Kompo Nation admin can create discount codes.';
  end if;

  if not exists (select 1 from public.vendors where id = p_vendor_id and retired_at is null) then
    raise exception 'Store not found.';
  end if;

  if p_discount_type not in ('percentage','fixed') then
    raise exception 'Choose a percentage or fixed discount.';
  end if;

  if p_usage_limit is null or p_usage_limit < 1 or p_usage_limit > 1000000 then
    raise exception 'Usage limit must be between 1 and 1,000,000.';
  end if;

  if coalesce(p_minimum_subtotal_cents,0) < 0 then
    raise exception 'Minimum spend cannot be negative.';
  end if;

  if p_expires_at is not null and p_expires_at <= coalesce(p_starts_at,now()) then
    raise exception 'Expiry must be after the start date.';
  end if;

  if p_discount_type = 'percentage' then
    v_percentage_bps := round(coalesce(p_percentage,0) * 100);
    if v_percentage_bps < 1 or v_percentage_bps > 10000 then
      raise exception 'Percentage discount must be greater than 0 and no more than 100.';
    end if;
  elsif coalesce(p_fixed_amount_cents,0) < 1 then
    raise exception 'Fixed discount must be greater than R0.';
  end if;

  if nullif(trim(coalesce(p_code,'')),'') is not null then
    v_code := upper(regexp_replace(trim(p_code), '\s+', '-', 'g'));
    if v_code !~ '^[A-Z0-9][A-Z0-9_-]{2,31}$' then
      raise exception 'Code must be 3–32 letters, numbers, hyphens or underscores.';
    end if;
  else
    select upper(substr(regexp_replace(coalesce(nullif(mark,''),slug), '[^A-Za-z0-9]', '', 'g'),1,8))
    into v_prefix
    from public.vendors
    where id = p_vendor_id;

    loop
      v_code := coalesce(nullif(v_prefix,''),'KOMPO') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
      exit when not exists (select 1 from public.discount_codes where code = v_code);
    end loop;
  end if;

  insert into public.discount_codes(
    vendor_id, code, name, discount_type, percentage_bps, fixed_amount_cents,
    minimum_subtotal_cents, usage_limit, starts_at, expires_at, created_by
  ) values (
    p_vendor_id,
    v_code,
    nullif(trim(coalesce(p_name,'')),''),
    p_discount_type,
    case when p_discount_type = 'percentage' then v_percentage_bps else null end,
    case when p_discount_type = 'fixed' then p_fixed_amount_cents else null end,
    coalesce(p_minimum_subtotal_cents,0),
    p_usage_limit,
    coalesce(p_starts_at,now()),
    p_expires_at,
    auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('id',v_id,'code',v_code);
exception
  when unique_violation then
    raise exception 'That discount code already exists. Generate another code or enter a different one.';
end;
$function$;

create or replace function public.set_store_discount_code_active(
  p_discount_code_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vendor_id uuid;
begin
  select vendor_id into v_vendor_id
  from public.discount_codes
  where id = p_discount_code_id;

  if v_vendor_id is null then raise exception 'Discount code not found.'; end if;
  if not public.can_manage_vendor_discounts(v_vendor_id) then
    raise exception 'Only a store owner, manager or Kompo Nation admin can change this code.';
  end if;

  update public.discount_codes
  set active = coalesce(p_active,false), updated_at = now()
  where id = p_discount_code_id;
end;
$function$;

create or replace function public.preview_discount_code(
  p_code text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_code public.discount_codes%rowtype;
  v_line jsonb;
  v_line_vendor_id uuid;
  v_line_price bigint;
  v_qty integer;
  v_subtotal bigint := 0;
  v_discount bigint;
  v_claimed integer;
  v_store_name text;
begin
  if auth.uid() is null then raise exception 'Sign in to use a discount code.'; end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then raise exception 'Your bag is empty.'; end if;

  select * into v_code
  from public.discount_codes
  where code = upper(trim(coalesce(p_code,'')));

  if not found then raise exception 'Discount code not found.'; end if;
  if not v_code.active then raise exception 'This discount code is inactive.'; end if;
  if v_code.starts_at > now() then raise exception 'This discount code is not active yet.'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'This discount code has expired.'; end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := (v_line->>'quantity')::integer;
    if v_qty < 1 then raise exception 'Invalid bag quantity.'; end if;

    select p.vendor_id, pv.price_cents
    into strict v_line_vendor_id, v_line_price
    from public.products p
    join public.product_variants pv on pv.product_id = p.id
    where p.id = (v_line->>'productId')::uuid
      and p.status = 'active'
      and pv.size = v_line->>'size'
      and pv.colour = v_line->>'colour'
      and pv.active;

    if v_line_vendor_id = v_code.vendor_id then
      v_subtotal := v_subtotal + v_line_price * v_qty;
    end if;
  end loop;

  if v_subtotal = 0 then raise exception 'This code only applies to items from its store.'; end if;
  if v_subtotal < v_code.minimum_subtotal_cents then
    raise exception 'Spend at least % on eligible store items to use this code.',
      to_char(v_code.minimum_subtotal_cents / 100.0, 'FM999999990.00');
  end if;

  select count(*)::integer into v_claimed
  from public.discount_redemptions
  where discount_code_id = v_code.id
    and (status = 'redeemed' or (status = 'reserved' and expires_at > now()));

  if v_claimed >= v_code.usage_limit then raise exception 'This discount code has reached its usage limit.'; end if;

  v_discount := case
    when v_code.discount_type = 'percentage' then round(v_subtotal * v_code.percentage_bps / 10000.0)
    else least(v_subtotal,v_code.fixed_amount_cents)
  end;

  select business_name into v_store_name from public.vendors where id = v_code.vendor_id;

  return jsonb_build_object(
    'valid',true,
    'id',v_code.id,
    'code',v_code.code,
    'name',v_code.name,
    'vendorId',v_code.vendor_id,
    'storeName',v_store_name,
    'eligibleSubtotalCents',v_subtotal,
    'discountCents',v_discount,
    'remainingUses',greatest(0,v_code.usage_limit-v_claimed)
  );
exception
  when no_data_found then
    raise exception 'One or more bag items are no longer available.';
end;
$function$;

create or replace function public.apply_store_discount_to_order(
  p_order_id uuid,
  p_customer_id uuid,
  p_code text,
  p_provider text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_code public.discount_codes%rowtype;
  v_vendor_order public.vendor_orders%rowtype;
  v_discount bigint;
  v_discounted_merch bigint;
  v_commission bigint;
  v_claimed integer;
  v_splits jsonb := '[]'::jsonb;
  v_store_name text;
begin
  select * into strict v_order
  from public.orders
  where id = p_order_id and customer_id = p_customer_id and status = 'pending_payment'
  for update;

  select * into v_code
  from public.discount_codes
  where code = upper(trim(coalesce(p_code,'')))
  for update;

  if not found then raise exception 'Discount code not found.'; end if;
  if not v_code.active then raise exception 'This discount code is inactive.'; end if;
  if v_code.starts_at > now() then raise exception 'This discount code is not active yet.'; end if;
  if v_code.expires_at is not null and v_code.expires_at <= now() then raise exception 'This discount code has expired.'; end if;

  select * into v_vendor_order
  from public.vendor_orders
  where order_id = p_order_id and vendor_id = v_code.vendor_id
  for update;

  if not found then raise exception 'This code only applies to items from its store.'; end if;
  if v_vendor_order.merchandise_total_cents < v_code.minimum_subtotal_cents then
    raise exception 'The eligible store subtotal no longer meets this code’s minimum spend.';
  end if;

  select count(*)::integer into v_claimed
  from public.discount_redemptions
  where discount_code_id = v_code.id
    and (status = 'redeemed' or (status = 'reserved' and expires_at > now()));

  if v_claimed >= v_code.usage_limit then raise exception 'This discount code has reached its usage limit.'; end if;

  v_discount := case
    when v_code.discount_type = 'percentage' then round(v_vendor_order.merchandise_total_cents * v_code.percentage_bps / 10000.0)
    else least(v_vendor_order.merchandise_total_cents,v_code.fixed_amount_cents)
  end;
  v_discounted_merch := v_vendor_order.merchandise_total_cents - v_discount;

  select round(v_discounted_merch * commission_rate_bps / 10000.0)
  into v_commission
  from public.vendors
  where id = v_code.vendor_id;

  with ranked as (
    select
      oi.id,
      oi.subtotal_cents,
      row_number() over (order by oi.id) as item_number,
      count(*) over () as item_count
    from public.order_items oi
    where oi.order_id = p_order_id and oi.vendor_id = v_code.vendor_id
  ), allocated as (
    select
      r.*,
      case
        when r.item_number = r.item_count then
          v_discount - coalesce(sum(floor(v_discount * r.subtotal_cents::numeric / v_vendor_order.merchandise_total_cents))
            over (order by r.item_number rows between unbounded preceding and 1 preceding),0)::bigint
        else floor(v_discount * r.subtotal_cents::numeric / v_vendor_order.merchandise_total_cents)::bigint
      end as item_discount
    from ranked r
  )
  update public.order_items oi
  set
    discount_cents = a.item_discount,
    line_total_cents = oi.subtotal_cents - a.item_discount,
    commission_cents = round((oi.subtotal_cents - a.item_discount) * oi.commission_rate_bps / 10000.0),
    vendor_net_cents = (oi.subtotal_cents - a.item_discount) - round((oi.subtotal_cents - a.item_discount) * oi.commission_rate_bps / 10000.0)
  from allocated a
  where oi.id = a.id;

  update public.vendor_orders
  set
    merchandise_subtotal_cents = merchandise_total_cents,
    discount_total_cents = v_discount,
    discount_code_id = v_code.id,
    discount_code = v_code.code,
    merchandise_total_cents = v_discounted_merch,
    commission_total_cents = v_commission,
    vendor_net_cents = v_discounted_merch - v_commission,
    updated_at = now()
  where id = v_vendor_order.id;

  update public.orders
  set
    merchandise_subtotal_cents = merchandise_total_cents,
    discount_total_cents = v_discount,
    discount_code_id = v_code.id,
    discount_code = v_code.code,
    merchandise_total_cents = merchandise_total_cents - v_discount,
    total_cents = total_cents - v_discount,
    updated_at = now()
  where id = p_order_id
  returning * into v_order;

  insert into public.discount_redemptions(
    discount_code_id,order_id,vendor_id,customer_id,discount_cents,status,expires_at
  ) values (
    v_code.id,p_order_id,v_code.vendor_id,p_customer_id,v_discount,'reserved',v_order.reservation_expires_at
  );

  update public.payments
  set amount_cents = v_order.total_cents, updated_at = now()
  where order_id = p_order_id;

  if p_provider = 'paystack' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'subaccount',vps.paystack_subaccount_code,
      'share',vo.vendor_net_cents
    ) order by vo.id),'[]'::jsonb)
    into v_splits
    from public.vendor_orders vo
    join public.vendors v on v.id = vo.vendor_id and not v.is_platform_owned
    join public.vendor_private_settings vps on vps.vendor_id = vo.vendor_id
    where vo.order_id = p_order_id
      and vo.vendor_net_cents > 0
      and nullif(trim(coalesce(vps.paystack_subaccount_code,'')),'') is not null;
  end if;

  select business_name into v_store_name from public.vendors where id = v_code.vendor_id;

  return jsonb_build_object(
    'amountCents',v_order.total_cents,
    'splits',v_splits,
    'discountCode',v_code.code,
    'discountCodeId',v_code.id,
    'discountStoreName',v_store_name,
    'discountTotalCents',v_discount
  );
end;
$function$;

create or replace function public.create_payment_checkout_v3(
  p_provider text,
  p_customer_id uuid,
  p_lines jsonb,
  p_address jsonb,
  p_contact jsonb,
  p_quotes jsonb,
  p_discount_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_checkout jsonb;
  v_discount jsonb;
begin
  v_checkout := public.create_payment_checkout(
    p_provider,p_customer_id,p_lines,p_address,p_contact,p_quotes
  );

  if nullif(trim(coalesce(p_discount_code,'')),'') is null then
    return v_checkout || jsonb_build_object('discountTotalCents',0);
  end if;

  v_discount := public.apply_store_discount_to_order(
    (v_checkout->>'orderId')::uuid,p_customer_id,p_discount_code,p_provider
  );
  return v_checkout || v_discount;
end;
$function$;

create or replace function public.finalize_discount_redemption()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status in ('paid','processing','partially_shipped','shipped','delivered')
     and old.status not in ('paid','processing','partially_shipped','shipped','delivered') then
    with redeemed as (
      update public.discount_redemptions
      set status = 'redeemed', redeemed_at = coalesce(redeemed_at,now())
      where order_id = new.id and status = 'reserved'
      returning discount_code_id
    )
    update public.discount_codes dc
    set used_count = dc.used_count + 1, updated_at = now()
    where dc.id in (select discount_code_id from redeemed);
  end if;
  return new;
end;
$function$;

drop trigger if exists finalize_discount_redemption_on_order on public.orders;
create trigger finalize_discount_redemption_on_order
after update of status on public.orders
for each row execute function public.finalize_discount_redemption();

revoke all on function public.can_manage_vendor_discounts(uuid) from public, anon, authenticated;
grant execute on function public.can_manage_vendor_discounts(uuid) to authenticated;

revoke all on function public.create_store_discount_code(uuid,text,text,text,numeric,bigint,bigint,integer,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.create_store_discount_code(uuid,text,text,text,numeric,bigint,bigint,integer,timestamptz,timestamptz) to authenticated;

revoke all on function public.set_store_discount_code_active(uuid,boolean) from public, anon, authenticated;
grant execute on function public.set_store_discount_code_active(uuid,boolean) to authenticated;

revoke all on function public.preview_discount_code(text,jsonb) from public, anon, authenticated;
grant execute on function public.preview_discount_code(text,jsonb) to authenticated;

revoke all on function public.apply_store_discount_to_order(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.apply_store_discount_to_order(uuid,uuid,text,text) to service_role;

revoke all on function public.create_payment_checkout_v3(text,uuid,jsonb,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.create_payment_checkout_v3(text,uuid,jsonb,jsonb,jsonb,jsonb,text) to service_role;

commit;
