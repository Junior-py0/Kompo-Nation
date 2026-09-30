-- CUSTOM EMBROIDERY PRODUCTS V1
-- Existing products remain standard. Vendors can opt future products into a
-- required, per-line embroidered name that is snapshotted onto the order item.

begin;

alter table public.products
  add column if not exists is_customizable boolean not null default false;

alter table public.order_items
  add column if not exists customization_text text;

alter table public.order_items
  drop constraint if exists order_items_customization_text_check;

alter table public.order_items
  add constraint order_items_customization_text_check
  check (
    customization_text is null
    or char_length(customization_text) between 1 and 30
  );

comment on column public.products.is_customizable is
  'When true, buyers must supply a name for custom embroidery.';

comment on column public.order_items.customization_text is
  'Immutable buyer-entered embroidery text captured at checkout.';

create or replace function public.save_product_v3(
  p_vendor_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_price_cents bigint,
  p_sizes text[],
  p_colours text[],
  p_stock_quantity integer,
  p_weight_kg numeric,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric,
  p_is_rare boolean,
  p_is_customizable boolean,
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product_id uuid;
begin
  v_product_id := public.save_product_v2(
    p_vendor_id,p_name,p_category,p_description,p_price_cents,p_sizes,
    p_colours,p_stock_quantity,p_weight_kg,p_length_cm,p_width_cm,
    p_height_cm,p_is_rare,p_status
  );

  update public.products
  set is_customizable = coalesce(p_is_customizable,false),
      updated_at = now()
  where id = v_product_id;

  return v_product_id;
end;
$function$;

create or replace function public.update_product_details_v2(
  p_product_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_is_rare boolean,
  p_is_customizable boolean,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.update_product_details(
    p_product_id,p_name,p_category,p_description,p_is_rare,p_status
  );

  update public.products
  set is_customizable = coalesce(p_is_customizable,false),
      updated_at = now()
  where id = p_product_id;
end;
$function$;

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
        'is_customizable', p.is_customizable,
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

create or replace function public.create_payment_checkout_v4(
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
  v_line jsonb;
  v_is_customizable boolean;
  v_customization text;
  v_checkout jsonb;
  v_order_id uuid;
  v_updated integer;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) = 0 then
    raise exception 'Customer and cart are required';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select p.is_customizable
    into strict v_is_customizable
    from public.products p
    where p.id = (v_line->>'productId')::uuid
      and p.status = 'active';

    v_customization := nullif(
      btrim(regexp_replace(coalesce(v_line->>'customizationText',''), '[\r\n\t]+', ' ', 'g')),
      ''
    );

    if v_is_customizable and v_customization is null then
      raise exception 'Enter the name to embroider for every custom product.';
    end if;

    if v_is_customizable and char_length(v_customization) > 30 then
      raise exception 'Embroidery names may contain up to 30 characters.';
    end if;

    if v_is_customizable and v_customization ~ '[[:cntrl:]]' then
      raise exception 'The embroidery name contains unsupported characters.';
    end if;

    if not v_is_customizable and v_customization is not null then
      raise exception 'Customization was supplied for a standard product.';
    end if;
  end loop;

  v_checkout := public.create_payment_checkout_v3(
    p_provider,p_customer_id,p_lines,p_address,p_contact,p_quotes,p_discount_code
  );
  v_order_id := (v_checkout->>'orderId')::uuid;

  with input_lines as (
    select
      (line->>'productId')::uuid as product_id,
      line->>'size' as size,
      line->>'colour' as colour,
      nullif(
        btrim(regexp_replace(coalesce(line->>'customizationText',''), '[\r\n\t]+', ' ', 'g')),
        ''
      ) as customization_text,
      row_number() over (
        partition by line->>'productId', line->>'size', line->>'colour'
        order by ordinality
      ) as occurrence
    from jsonb_array_elements(p_lines) with ordinality as supplied(line, ordinality)
  ),
  saved_lines as (
    select
      oi.id,
      oi.product_id,
      pv.size,
      pv.colour,
      row_number() over (
        partition by oi.product_id, pv.size, pv.colour
        order by oi.created_at, oi.id
      ) as occurrence
    from public.order_items oi
    join public.product_variants pv on pv.id = oi.variant_id
    where oi.order_id = v_order_id
  )
  update public.order_items oi
  set customization_text = input_lines.customization_text
  from saved_lines
  join input_lines
    on input_lines.product_id = saved_lines.product_id
   and input_lines.size = saved_lines.size
   and input_lines.colour = saved_lines.colour
   and input_lines.occurrence = saved_lines.occurrence
  where oi.id = saved_lines.id;

  get diagnostics v_updated = row_count;
  if v_updated <> jsonb_array_length(p_lines) then
    raise exception 'The custom order details could not be matched to every item.';
  end if;

  return v_checkout;
end;
$function$;

revoke all on function public.save_product_v3(
  uuid,text,text,text,bigint,text[],text[],integer,numeric,numeric,numeric,numeric,boolean,boolean,text
) from public, anon;
grant execute on function public.save_product_v3(
  uuid,text,text,text,bigint,text[],text[],integer,numeric,numeric,numeric,numeric,boolean,boolean,text
) to authenticated;

revoke all on function public.update_product_details_v2(
  uuid,text,text,text,boolean,boolean,text
) from public, anon;
grant execute on function public.update_product_details_v2(
  uuid,text,text,text,boolean,boolean,text
) to authenticated;

revoke all on function public.create_payment_checkout_v4(
  text,uuid,jsonb,jsonb,jsonb,jsonb,text
) from public, anon, authenticated;
grant execute on function public.create_payment_checkout_v4(
  text,uuid,jsonb,jsonb,jsonb,jsonb,text
) to service_role;

revoke all on function public.get_storefront_products() from public, anon, authenticated;
grant execute on function public.get_storefront_products() to anon, authenticated;

commit;
