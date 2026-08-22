begin;

alter table public.vendor_private_settings
  add column if not exists paystack_subaccount_code text;

alter table public.vendor_private_settings
  add column if not exists paystack_split_approved boolean
  not null default false;


create or replace function public.create_paystack_checkout(
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
  v_merch bigint := 0;
  v_shipping bigint := 0;
  v_vendor_merch bigint;
  v_vendor_commission bigint;
  v_vendor_shipping bigint;
  v_total bigint;
  v_expires timestamptz := now() + interval '15 minutes';
  v_private public.vendor_private_settings%rowtype;
  v_splits jsonb := '[]'::jsonb;
begin
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

  for v_line in
    select *
    from jsonb_array_elements(p_lines)
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

    select coalesce(sum(quantity),0)
    into v_reserved
    from public.stock_reservations
    where variant_id = v_variant.id
      and status = 'active'
      and expires_at > now();

    if v_qty < 1
       or v_variant.stock_quantity - v_reserved < v_qty then
      raise exception
        'Insufficient online stock for %',
        v_product.name;
    end if;

    v_merch :=
      v_merch + v_variant.price_cents * v_qty;
  end loop;

  select coalesce(
    sum((quote->>'amountCents')::bigint),
    0
  )
  into v_shipping
  from jsonb_array_elements(p_quotes) quote;

  v_total := v_merch + v_shipping;

  insert into public.orders(
    id,
    public_reference,
    customer_id,
    customer_name,
    customer_email,
    customer_phone,
    delivery_address,
    merchandise_total_cents,
    shipping_total_cents,
    total_cents,
    reservation_expires_at
  )
  values (
    v_order_id,
    v_order_ref,
    p_customer_id,
    p_contact->>'fullName',
    p_contact->>'email',
    p_contact->>'phone',
    p_address,
    v_merch,
    v_shipping,
    v_total,
    v_expires
  );

  for v_vendor in
    select distinct v.*
    from jsonb_array_elements(p_lines) line
    join public.products p
      on p.id = (line->>'productId')::uuid
    join public.vendors v
      on v.id = p.vendor_id
  loop
    if v_vendor.status <> 'active' then
      raise exception 'Store is not accepting orders';
    end if;

    select *
    into v_private
    from public.vendor_private_settings
    where vendor_id = v_vendor.id;

    if not v_vendor.is_platform_owned
       and (
         v_private.paystack_subaccount_code is null
         or not coalesce(v_private.paystack_split_approved,false)
       ) then
      raise exception 'Store Paystack split is not approved';
    end if;

    select quote
    into v_quote
    from jsonb_array_elements(p_quotes) quote
    where quote->>'vendorId' = v_vendor.id::text
    limit 1;

    if v_quote is null then
      raise exception
        'Delivery quote missing for %',
        v_vendor.business_name;
    end if;

    v_vendor_shipping :=
      (v_quote->>'amountCents')::bigint;

    select sum(
      pv.price_cents *
      (line->>'quantity')::integer
    )::bigint
    into v_vendor_merch
    from jsonb_array_elements(p_lines) line
    join public.products p
      on p.id = (line->>'productId')::uuid
    join public.product_variants pv
      on pv.product_id = p.id
     and pv.size = line->>'size'
     and pv.colour = line->>'colour'
    where p.vendor_id = v_vendor.id;

    v_vendor_commission :=
      round(
        v_vendor_merch *
        v_vendor.commission_rate_bps /
        10000.0
      );

    v_vendor_ref :=
      v_order_ref || '-' ||
      upper(
        substr(
          replace(v_vendor.id::text,'-',''),
          1,
          3
        )
      );

    insert into public.vendor_orders(
      order_id,
      vendor_id,
      public_reference,
      merchandise_total_cents,
      commission_total_cents,
      vendor_net_cents,
      shipping_charge_cents,
      shipping_quote
    )
    values (
      v_order_id,
      v_vendor.id,
      v_vendor_ref,
      v_vendor_merch,
      v_vendor_commission,
      v_vendor_merch - v_vendor_commission,
      v_vendor_shipping,
      v_quote
    )
    returning id
    into v_vendor_order_id;

    for v_line in
      select *
      from jsonb_array_elements(p_lines)
    loop
      select p.*
      into v_product
      from public.products p
      where p.id = (v_line->>'productId')::uuid
        and p.vendor_id = v_vendor.id;

      if found then
        v_qty := (v_line->>'quantity')::integer;

        select *
        into strict v_variant
        from public.product_variants
        where product_id = v_product.id
          and size = v_line->>'size'
          and colour = v_line->>'colour';

        insert into public.order_items(
          order_id,
          vendor_order_id,
          vendor_id,
          product_id,
          variant_id,
          product_name,
          variant_description,
          sku,
          unit_price_cents,
          quantity,
          line_total_cents,
          commission_rate_bps,
          commission_cents,
          vendor_net_cents
        )
        values (
          v_order_id,
          v_vendor_order_id,
          v_vendor.id,
          v_product.id,
          v_variant.id,
          v_product.name,
          v_variant.size || ' / ' || v_variant.colour,
          v_variant.sku,
          v_variant.price_cents,
          v_qty,
          v_variant.price_cents * v_qty,
          v_vendor.commission_rate_bps,
          round(
            v_variant.price_cents *
            v_qty *
            v_vendor.commission_rate_bps /
            10000.0
          ),
          v_variant.price_cents * v_qty -
          round(
            v_variant.price_cents *
            v_qty *
            v_vendor.commission_rate_bps /
            10000.0
          )
        );

        insert into public.stock_reservations(
          order_id,
          variant_id,
          quantity,
          expires_at
        )
        values (
          v_order_id,
          v_variant.id,
          v_qty,
          v_expires
        );
      end if;
    end loop;

    if not v_vendor.is_platform_owned then
      v_splits :=
        v_splits ||
        jsonb_build_array(
          jsonb_build_object(
            'subaccount',
            v_private.paystack_subaccount_code,
            'share',
            v_vendor_merch - v_vendor_commission
          )
        );
    end if;
  end loop;

  insert into public.payments(
    order_id,
    provider,
    amount_cents
  )
  values (
    v_order_id,
    'paystack',
    v_total
  );

  return jsonb_build_object(
    'orderId', v_order_id,
    'publicReference', v_order_ref,
    'amountCents', v_total,
    'customerName', p_contact->>'fullName',
    'customerEmail', p_contact->>'email',
    'customerPhone', p_contact->>'phone',
    'splits', v_splits,
    'expiresAt', v_expires
  );
end;
$function$;


create or replace function public.finalize_paystack_payment(
  p_public_reference text,
  p_provider_reference text,
  p_amount_cents bigint,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_reservation public.stock_reservations%rowtype;
  v_vo public.vendor_orders%rowtype;
begin
  select *
  into strict v_order
  from public.orders
  where public_reference = p_public_reference
  for update;

  select *
  into strict v_payment
  from public.payments
  where order_id = v_order.id
  for update;

  if v_payment.provider <> 'paystack' then
    raise exception 'Order does not belong to Paystack';
  end if;

  if v_order.status in (
    'paid',
    'processing',
    'partially_shipped',
    'shipped',
    'delivered'
  ) then
    return jsonb_build_object(
      'alreadyFinalized', true,
      'orderId', v_order.id
    );
  end if;

  if v_order.status <> 'pending_payment'
     or v_order.reservation_expires_at < now()
     or not exists (
       select 1
       from public.stock_reservations
       where order_id = v_order.id
         and status = 'active'
     ) then

    update public.orders
    set status = 'payment_review',
        updated_at = now()
    where id = v_order.id;

    update public.payments
    set status = 'review',
        provider_reference = p_provider_reference,
        provider_payload = p_payload,
        updated_at = now()
    where id = v_payment.id;

    return jsonb_build_object(
      'alreadyFinalized', false,
      'paymentReview', true,
      'reason', 'reservation_expired',
      'orderId', v_order.id
    );
  end if;

  if v_order.total_cents <> p_amount_cents then
    update public.orders
    set status = 'payment_review',
        updated_at = now()
    where id = v_order.id;

    update public.payments
    set status = 'review',
        provider_reference = p_provider_reference,
        provider_payload = p_payload,
        updated_at = now()
    where id = v_payment.id;

    return jsonb_build_object(
      'alreadyFinalized', false,
      'paymentReview', true,
      'reason', 'amount_mismatch',
      'orderId', v_order.id
    );
  end if;

  if exists (
    select 1
    from public.stock_reservations sr
    join public.product_variants pv
      on pv.id = sr.variant_id
    where sr.order_id = v_order.id
      and sr.status = 'active'
      and pv.stock_quantity < sr.quantity
  ) then
    update public.orders
    set status = 'payment_review',
        updated_at = now()
    where id = v_order.id;

    update public.payments
    set status = 'review',
        provider_reference = p_provider_reference,
        provider_payload = p_payload,
        updated_at = now()
    where id = v_payment.id;

    return jsonb_build_object(
      'alreadyFinalized', false,
      'paymentReview', true,
      'reason', 'stock_unavailable',
      'orderId', v_order.id
    );
  end if;

  for v_reservation in
    select *
    from public.stock_reservations
    where order_id = v_order.id
      and status = 'active'
    for update
  loop
    if v_reservation.expires_at < now() then
      update public.orders
      set status = 'payment_review',
          updated_at = now()
      where id = v_order.id;

      update public.payments
      set status = 'review',
          provider_reference = p_provider_reference,
          provider_payload = p_payload,
          updated_at = now()
      where id = v_payment.id;

      return jsonb_build_object(
        'alreadyFinalized', false,
        'paymentReview', true,
        'reason', 'reservation_expired',
        'orderId', v_order.id
      );
    end if;

    update public.product_variants
    set stock_quantity =
          stock_quantity - v_reservation.quantity,
        updated_at = now()
    where id = v_reservation.variant_id
      and stock_quantity >= v_reservation.quantity;

    if not found then
      update public.orders
      set status = 'payment_review',
          updated_at = now()
      where id = v_order.id;

      update public.payments
      set status = 'review',
          provider_reference = p_provider_reference,
          provider_payload = p_payload,
          updated_at = now()
      where id = v_payment.id;

      return jsonb_build_object(
        'alreadyFinalized', false,
        'paymentReview', true,
        'reason', 'stock_unavailable',
        'orderId', v_order.id
      );
    end if;

    update public.stock_reservations
    set status = 'converted'
    where id = v_reservation.id;

    insert into public.inventory_movements(
      variant_id,
      quantity_delta,
      reason,
      reference_type,
      reference_id
    )
    values (
      v_reservation.variant_id,
      -v_reservation.quantity,
      'sale',
      'order',
      v_order.id
    );
  end loop;

  update public.orders
  set status = 'paid',
      paid_at = now(),
      updated_at = now()
  where id = v_order.id;

  update public.vendor_orders
  set fulfilment_status = 'new',
      fulfilment_due_at = now() + interval '24 hours',
      updated_at = now()
  where order_id = v_order.id;

  update public.payments
  set status = 'success',
      provider_reference = p_provider_reference,
      provider_payload = p_payload,
      paid_at = now(),
      updated_at = now()
  where id = v_payment.id;

  update public.products p
  set sales_count = p.sales_count + x.qty
  from (
    select
      product_id,
      sum(quantity)::bigint qty
    from public.order_items
    where order_id = v_order.id
    group by product_id
  ) x
  where p.id = x.product_id;

  update public.vendors v
  set sales_count = v.sales_count + x.qty
  from (
    select
      vendor_id,
      sum(quantity)::bigint qty
    from public.order_items
    where order_id = v_order.id
    group by vendor_id
  ) x
  where v.id = x.vendor_id;

  for v_vo in
    select *
    from public.vendor_orders
    where order_id = v_order.id
  loop
    insert into public.notification_outbox(
      recipient_address,
      template_key,
      payload,
      dedupe_key
    )
    select
      contact_email,
      'vendor_new_order',
      jsonb_build_object(
        'reference',
        v_vo.public_reference
      ),
      'vendor-order:' || v_vo.id
    from public.vendor_private_settings
    where vendor_id = v_vo.vendor_id
      and contact_email is not null
    on conflict (dedupe_key)
    do nothing;
  end loop;

  insert into public.notification_outbox(
    recipient_address,
    template_key,
    payload,
    dedupe_key
  )
  values (
    v_order.customer_email,
    'customer_payment_confirmed',
    jsonb_build_object(
      'reference',
      v_order.public_reference
    ),
    'customer-payment:' || v_order.id
  )
  on conflict (dedupe_key)
  do nothing;

  return jsonb_build_object(
    'alreadyFinalized', false,
    'orderId', v_order.id
  );
end;
$function$;


revoke all
on function public.create_paystack_checkout(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb
)
from public, anon, authenticated;

grant execute
on function public.create_paystack_checkout(
  uuid,
  jsonb,
  jsonb,
  jsonb,
  jsonb
)
to service_role;


revoke all
on function public.finalize_paystack_payment(
  text,
  text,
  bigint,
  jsonb
)
from public, anon, authenticated;

grant execute
on function public.finalize_paystack_payment(
  text,
  text,
  bigint,
  jsonb
)
to service_role;

commit;
