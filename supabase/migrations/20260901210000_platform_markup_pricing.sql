-- PLATFORM MARKUP PRICING V1
-- Product variant prices remain the vendor's base prices.
-- Customers see and pay the base price plus the configured marketplace markup.
-- Historical orders are intentionally unchanged because their financial snapshots
-- may already have been paid, settled, refunded or reconciled.

begin;

comment on column public.product_variants.price_cents is
  'Vendor base price in cents before the customer-facing marketplace markup.';

comment on column public.vendors.commission_rate_bps is
  'Customer-facing marketplace markup rate in basis points. Kept under the legacy column name for compatibility.';

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
  select greatest(0,p_base_cents) +
    round(
      greatest(0,p_base_cents) *
      greatest(0,p_markup_rate_bps) /
      10000.0
    )::bigint;
$function$;

update public.vendors
set commission_rate_bps = 1000,
    updated_at = now()
where commission_rate_bps <> 1000;

insert into public.marketplace_settings(key,value)
values ('default_commission_rate_bps','1000'::jsonb)
on conflict (key) do update
set value = excluded.value,
    updated_at = now();

create or replace function public.get_storefront_products()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    jsonb_agg(x.product_json order by x.created_at desc),
    '[]'::jsonb
  )
  from (
    select
      p.created_at,
      jsonb_build_object(
        'id', p.id,
        'vendor_id', p.vendor_id,
        'slug', p.slug,
        'name', p.name,
        'description', p.description,
        'category', p.category,
        'tone', p.tone,
        'is_rare', p.is_rare,
        'status', p.status,
        'sales_count', p.sales_count,
        'image_url', (
          select pm.public_url
          from public.product_media pm
          where pm.product_id = p.id
          order by pm.sort_order, pm.created_at
          limit 1
        ),
        'variants', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', pv.id,
              'sku', pv.sku,
              'size', pv.size,
              'colour', pv.colour,
              'price_cents', public.customer_price_cents(
                pv.price_cents,
                v.commission_rate_bps
              ),
              'stock', greatest(
                pv.stock_quantity - coalesce((
                  select sum(sr.quantity)
                  from public.stock_reservations sr
                  where sr.variant_id = pv.id
                    and sr.status = 'active'
                    and sr.expires_at > now()
                ), 0),
                0
              ),
              'active', pv.active
            )
            order by pv.size, pv.colour
          )
          from public.product_variants pv
          where pv.product_id = p.id
            and pv.active
        ), '[]'::jsonb)
      ) as product_json
    from public.products p
    join public.vendors v on v.id = p.vendor_id
    where p.status = 'active'
      and v.status = 'active'
  ) x;
$function$;

create or replace function public.create_payment_checkout(
  p_provider text,
  p_customer_id uuid,
  p_lines jsonb,
  p_address jsonb,
  p_contact jsonb,
  p_quotes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order_id uuid := gen_random_uuid();
  v_order_ref text := 'KN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_vendor record;
  v_line jsonb;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_vendor_order_id uuid;
  v_vendor_ref text;
  v_quote jsonb;
  v_qty integer;
  v_reserved integer;
  v_markup_rate_bps integer;
  v_customer_unit_price bigint;
  v_merch bigint := 0;
  v_shipping bigint := 0;
  v_vendor_base bigint;
  v_vendor_merch bigint;
  v_vendor_commission bigint;
  v_vendor_shipping bigint;
  v_total bigint;
  v_expires timestamptz := now() + interval '15 minutes';
  v_private public.vendor_private_settings%rowtype;
  v_splits jsonb := '[]'::jsonb;
begin
  if p_provider not in ('paystack', 'stitch', 'yoco') then
    raise exception 'Unsupported payment provider';
  end if;

  if p_customer_id is null
     or p_lines is null
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'Customer and cart are required';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_customer_id
  ) then
    raise exception 'Customer profile not found';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := (v_line->>'quantity')::integer;

    select p.*
    into strict v_product
    from public.products p
    where p.id = (v_line->>'productId')::uuid
      and p.status = 'active';

    select pv.*
    into strict v_variant
    from public.product_variants pv
    where pv.product_id = v_product.id
      and pv.size = v_line->>'size'
      and pv.colour = v_line->>'colour'
      and pv.active
    for update;

    select v.commission_rate_bps
    into strict v_markup_rate_bps
    from public.vendors v
    where v.id = v_product.vendor_id
      and v.status = 'active';

    select coalesce(sum(quantity),0)
    into v_reserved
    from public.stock_reservations
    where variant_id = v_variant.id
      and status = 'active'
      and expires_at > now();

    if v_qty < 1
       or v_variant.stock_quantity - v_reserved < v_qty then
      raise exception 'Insufficient online stock for %', v_product.name;
    end if;

    v_customer_unit_price := public.customer_price_cents(
      v_variant.price_cents,
      v_markup_rate_bps
    );
    v_merch := v_merch + v_customer_unit_price * v_qty;
  end loop;

  select coalesce(sum((quote->>'amountCents')::bigint),0)
  into v_shipping
  from jsonb_array_elements(p_quotes) quote;

  v_total := v_merch + v_shipping;

  insert into public.orders(
    id,public_reference,customer_id,customer_name,customer_email,
    customer_phone,delivery_address,merchandise_total_cents,
    shipping_total_cents,total_cents,reservation_expires_at
  )
  values (
    v_order_id,v_order_ref,p_customer_id,p_contact->>'fullName',
    p_contact->>'email',p_contact->>'phone',p_address,v_merch,
    v_shipping,v_total,v_expires
  );

  for v_vendor in
    select distinct v.*
    from jsonb_array_elements(p_lines) line
    join public.products p on p.id = (line->>'productId')::uuid
    join public.vendors v on v.id = p.vendor_id
  loop
    if v_vendor.status <> 'active' then
      raise exception 'Store is not accepting orders';
    end if;

    select * into v_private
    from public.vendor_private_settings
    where vendor_id = v_vendor.id;

    if p_provider = 'paystack'
       and not v_vendor.is_platform_owned
       and (
         v_private.paystack_subaccount_code is null
         or not coalesce(v_private.paystack_split_approved,false)
       ) then
      raise exception 'Store Paystack split is not approved';
    end if;

    select quote into v_quote
    from jsonb_array_elements(p_quotes) quote
    where quote->>'vendorId' = v_vendor.id::text
    limit 1;

    if v_quote is null then
      raise exception 'Delivery quote missing for %', v_vendor.business_name;
    end if;

    v_vendor_shipping := (v_quote->>'amountCents')::bigint;

    select
      sum(pv.price_cents * (line->>'quantity')::integer)::bigint,
      sum(
        public.customer_price_cents(
          pv.price_cents,
          v_vendor.commission_rate_bps
        ) * (line->>'quantity')::integer
      )::bigint
    into v_vendor_base,v_vendor_merch
    from jsonb_array_elements(p_lines) line
    join public.products p on p.id = (line->>'productId')::uuid
    join public.product_variants pv
      on pv.product_id = p.id
     and pv.size = line->>'size'
     and pv.colour = line->>'colour'
    where p.vendor_id = v_vendor.id;

    v_vendor_commission := v_vendor_merch - v_vendor_base;
    v_vendor_ref := v_order_ref || '-' ||
      upper(substr(replace(v_vendor.id::text,'-',''),1,3));

    insert into public.vendor_orders(
      order_id,vendor_id,public_reference,merchandise_total_cents,
      commission_total_cents,vendor_net_cents,shipping_charge_cents,
      shipping_quote
    )
    values (
      v_order_id,v_vendor.id,v_vendor_ref,v_vendor_merch,
      v_vendor_commission,v_vendor_base,v_vendor_shipping,v_quote
    )
    returning id into v_vendor_order_id;

    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      select p.* into v_product
      from public.products p
      where p.id = (v_line->>'productId')::uuid
        and p.vendor_id = v_vendor.id;

      if found then
        v_qty := (v_line->>'quantity')::integer;

        select * into strict v_variant
        from public.product_variants
        where product_id = v_product.id
          and size = v_line->>'size'
          and colour = v_line->>'colour';

        v_customer_unit_price := public.customer_price_cents(
          v_variant.price_cents,
          v_vendor.commission_rate_bps
        );

        insert into public.order_items(
          order_id,vendor_order_id,vendor_id,product_id,variant_id,
          product_name,variant_description,sku,unit_price_cents,quantity,
          line_total_cents,commission_rate_bps,commission_cents,
          vendor_net_cents
        )
        values (
          v_order_id,v_vendor_order_id,v_vendor.id,v_product.id,v_variant.id,
          v_product.name,v_variant.size || ' / ' || v_variant.colour,
          v_variant.sku,v_customer_unit_price,v_qty,
          v_customer_unit_price * v_qty,v_vendor.commission_rate_bps,
          (v_customer_unit_price - v_variant.price_cents) * v_qty,
          v_variant.price_cents * v_qty
        );

        insert into public.stock_reservations(
          order_id,variant_id,quantity,expires_at
        )
        values (v_order_id,v_variant.id,v_qty,v_expires);
      end if;
    end loop;

    if p_provider = 'paystack'
       and not v_vendor.is_platform_owned then
      v_splits := v_splits || jsonb_build_array(
        jsonb_build_object(
          'subaccount',v_private.paystack_subaccount_code,
          'share',v_vendor_base
        )
      );
    end if;
  end loop;

  insert into public.payments(order_id,provider,amount_cents)
  values (v_order_id,p_provider,v_total);

  return jsonb_build_object(
    'orderId',v_order_id,
    'publicReference',v_order_ref,
    'amountCents',v_total,
    'customerName',p_contact->>'fullName',
    'customerEmail',p_contact->>'email',
    'customerPhone',p_contact->>'phone',
    'provider',p_provider,
    'splits',v_splits,
    'expiresAt',v_expires
  );
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

    select
      p.vendor_id,
      public.customer_price_cents(pv.price_cents,v.commission_rate_bps)
    into strict v_line_vendor_id,v_line_price
    from public.products p
    join public.vendors v on v.id = p.vendor_id
    join public.product_variants pv on pv.product_id = p.id
    where p.id = (v_line->>'productId')::uuid
      and p.status = 'active'
      and v.status = 'active'
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

  select business_name into v_store_name
  from public.vendors
  where id = v_code.vendor_id;

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
  v_vendor_net bigint;
  v_claimed integer;
  v_splits jsonb := '[]'::jsonb;
  v_store_name text;
begin
  select * into strict v_order
  from public.orders
  where id = p_order_id
    and customer_id = p_customer_id
    and status = 'pending_payment'
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
  where order_id = p_order_id
    and vendor_id = v_code.vendor_id
  for update;

  if not found then raise exception 'This code only applies to items from its store.'; end if;
  if v_vendor_order.discount_code_id is not null then raise exception 'This order already has a discount code.'; end if;
  if v_vendor_order.merchandise_total_cents < v_code.minimum_subtotal_cents then
    raise exception 'The eligible store subtotal no longer meets this code''s minimum spend.';
  end if;

  select count(*)::integer into v_claimed
  from public.discount_redemptions
  where discount_code_id = v_code.id
    and (status = 'redeemed' or (status = 'reserved' and expires_at > now()));

  if v_claimed >= v_code.usage_limit then raise exception 'This discount code has reached its usage limit.'; end if;

  v_discount := case
    when v_code.discount_type = 'percentage' then
      round(v_vendor_order.merchandise_total_cents * v_code.percentage_bps / 10000.0)
    else least(v_vendor_order.merchandise_total_cents,v_code.fixed_amount_cents)
  end;

  with ranked as (
    select
      oi.id,
      oi.subtotal_cents,
      row_number() over (order by oi.id) as item_number,
      count(*) over () as item_count
    from public.order_items oi
    where oi.order_id = p_order_id
      and oi.vendor_id = v_code.vendor_id
  ), allocated as (
    select
      r.*,
      case
        when r.item_number = r.item_count then
          v_discount - coalesce(
            sum(floor(v_discount * r.subtotal_cents::numeric /
              v_vendor_order.merchandise_total_cents))
              over (order by r.item_number rows between unbounded preceding and 1 preceding),
            0
          )::bigint
        else floor(
          v_discount * r.subtotal_cents::numeric /
          v_vendor_order.merchandise_total_cents
        )::bigint
      end as item_discount
    from ranked r
  ), priced as (
    select
      a.*,
      a.subtotal_cents - a.item_discount as discounted_total,
      round(
        (a.subtotal_cents - a.item_discount) * 10000.0 /
        (10000 + oi.commission_rate_bps)
      )::bigint as discounted_vendor_net
    from allocated a
    join public.order_items oi on oi.id = a.id
  )
  update public.order_items oi
  set
    discount_cents = p.item_discount,
    line_total_cents = p.discounted_total,
    commission_cents = p.discounted_total - p.discounted_vendor_net,
    vendor_net_cents = p.discounted_vendor_net
  from priced p
  where oi.id = p.id;

  select
    coalesce(sum(line_total_cents),0),
    coalesce(sum(commission_cents),0),
    coalesce(sum(vendor_net_cents),0)
  into v_discounted_merch,v_commission,v_vendor_net
  from public.order_items
  where vendor_order_id = v_vendor_order.id;

  update public.vendor_orders
  set
    merchandise_subtotal_cents = v_vendor_order.merchandise_total_cents,
    discount_total_cents = v_discount,
    discount_code_id = v_code.id,
    discount_code = v_code.code,
    merchandise_total_cents = v_discounted_merch,
    commission_total_cents = v_commission,
    vendor_net_cents = v_vendor_net,
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
  )
  values (
    v_code.id,p_order_id,v_code.vendor_id,p_customer_id,v_discount,
    'reserved',v_order.reservation_expires_at
  );

  update public.payments
  set amount_cents = v_order.total_cents,
      updated_at = now()
  where order_id = p_order_id;

  if p_provider = 'paystack' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'subaccount',vps.paystack_subaccount_code,
      'share',vo.vendor_net_cents
    ) order by vo.id),'[]'::jsonb)
    into v_splits
    from public.vendor_orders vo
    join public.vendors v
      on v.id = vo.vendor_id
     and not v.is_platform_owned
    join public.vendor_private_settings vps
      on vps.vendor_id = vo.vendor_id
    where vo.order_id = p_order_id
      and vo.vendor_net_cents > 0
      and nullif(trim(coalesce(vps.paystack_subaccount_code,'')),'') is not null;
  end if;

  select business_name into v_store_name
  from public.vendors
  where id = v_code.vendor_id;

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

revoke all on function public.customer_price_cents(bigint,integer)
from public, anon, authenticated;
grant execute on function public.customer_price_cents(bigint,integer)
to anon, authenticated, service_role;

revoke all on function public.get_storefront_products()
from public;
grant execute on function public.get_storefront_products()
to anon, authenticated;

revoke all on function public.preview_discount_code(text,jsonb)
from public, anon, authenticated;
grant execute on function public.preview_discount_code(text,jsonb)
to authenticated;

revoke all on function public.apply_store_discount_to_order(uuid,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.apply_store_discount_to_order(uuid,uuid,text,text)
to service_role;

commit;
