-- KOMPO NATION — STEP 11A.3
-- Store creation cleanup + variant-aware storefront + storage-policy cleanup
-- Run this entire file ONCE in Supabase SQL Editor.
-- It is safe for existing orders/products and does not delete business data.

begin;

-- ============================================================
-- 1. ATOMIC ADMIN STORE CREATION
-- Normal users should never have to understand URL slugs.
-- The database generates a stable unique slug from the store name.
-- ============================================================

create or replace function public.admin_create_vendor_v2(
  p_business_name text,
  p_contact_email text,
  p_commission_rate_bps integer,
  p_short_description text,
  p_description text,
  p_mark text,
  p_accent text,
  p_is_platform_owned boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vendor_id uuid := gen_random_uuid();
  v_base_slug text;
  v_slug text;
begin
  if not public.is_platform_admin() then
    raise exception 'Admin access required.';
  end if;

  if trim(coalesce(p_business_name, '')) = '' then
    raise exception 'Business name is required.';
  end if;

  if trim(coalesce(p_contact_email, '')) = ''
     or position('@' in p_contact_email) <= 1 then
    raise exception 'A valid contact email is required.';
  end if;

  if p_commission_rate_bps < 0 or p_commission_rate_bps > 4000 then
    raise exception 'Commission must be between 0%% and 40%%.';
  end if;

  if trim(coalesce(p_short_description, '')) = '' then
    raise exception 'Short description is required.';
  end if;

  if trim(coalesce(p_description, '')) = '' then
    raise exception 'Full description is required.';
  end if;

  if char_length(trim(coalesce(p_mark, ''))) < 1
     or char_length(trim(coalesce(p_mark, ''))) > 3 then
    raise exception 'Store badge must contain 1 to 3 characters.';
  end if;

  if p_accent not in ('sage', 'mist', 'sand', 'stone') then
    raise exception 'Invalid brand palette.';
  end if;

  v_base_slug := trim(both '-' from regexp_replace(
    lower(trim(p_business_name)),
    '[^a-z0-9]+',
    '-',
    'g'
  ));

  if v_base_slug = '' then
    v_base_slug := 'store';
  end if;

  v_slug := v_base_slug;

  while exists (
    select 1
    from public.vendors
    where slug = v_slug
  ) loop
    v_slug := v_base_slug || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
  end loop;

  insert into public.vendors(
    id,
    slug,
    business_name,
    description,
    short_description,
    mark,
    accent,
    commission_rate_bps,
    status,
    is_platform_owned
  )
  values(
    v_vendor_id,
    v_slug,
    trim(p_business_name),
    trim(p_description),
    trim(p_short_description),
    upper(trim(p_mark)),
    p_accent,
    p_commission_rate_bps,
    'pending',
    coalesce(p_is_platform_owned, false)
  );

  insert into public.vendor_private_settings(
    vendor_id,
    contact_email
  )
  values(
    v_vendor_id,
    lower(trim(p_contact_email))
  );

  return v_vendor_id;
end;
$function$;


-- ============================================================
-- 2. ADMIN STORE EDITING
-- Slugs stay stable after creation so public store links do not break.
-- ============================================================

create or replace function public.admin_update_vendor_v2(
  p_vendor_id uuid,
  p_business_name text,
  p_contact_email text,
  p_commission_rate_bps integer,
  p_short_description text,
  p_description text,
  p_mark text,
  p_accent text,
  p_is_platform_owned boolean,
  p_featured_override boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Admin access required.';
  end if;

  if not exists (
    select 1 from public.vendors where id = p_vendor_id
  ) then
    raise exception 'Store not found.';
  end if;

  if trim(coalesce(p_business_name, '')) = '' then
    raise exception 'Business name is required.';
  end if;

  if trim(coalesce(p_contact_email, '')) = ''
     or position('@' in p_contact_email) <= 1 then
    raise exception 'A valid contact email is required.';
  end if;

  if p_commission_rate_bps < 0 or p_commission_rate_bps > 4000 then
    raise exception 'Commission must be between 0%% and 40%%.';
  end if;

  if char_length(trim(coalesce(p_mark, ''))) < 1
     or char_length(trim(coalesce(p_mark, ''))) > 3 then
    raise exception 'Store badge must contain 1 to 3 characters.';
  end if;

  if p_accent not in ('sage', 'mist', 'sand', 'stone') then
    raise exception 'Invalid brand palette.';
  end if;

  update public.vendors
  set
    business_name = trim(p_business_name),
    short_description = trim(p_short_description),
    description = trim(p_description),
    mark = upper(trim(p_mark)),
    accent = p_accent,
    commission_rate_bps = p_commission_rate_bps,
    is_platform_owned = coalesce(p_is_platform_owned, false),
    featured_override = p_featured_override,
    updated_at = now()
  where id = p_vendor_id;

  insert into public.vendor_private_settings(
    vendor_id,
    contact_email
  )
  values(
    p_vendor_id,
    lower(trim(p_contact_email))
  )
  on conflict (vendor_id)
  do update set
    contact_email = excluded.contact_email,
    updated_at = now();
end;
$function$;


-- ============================================================
-- 3. VARIANT-AWARE PUBLIC STOREFRONT DATA
-- Returns only public catalogue information.
-- Available stock subtracts active, unexpired checkout reservations.
-- ============================================================

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
              'price_cents', pv.price_cents,
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


-- ============================================================
-- 4. REMOVE OBSOLETE DUPLICATE STORAGE POLICIES
-- Step 11 created product_images_member_* policies that cover
-- active vendor_members plus platform admins. These old names are
-- now redundant and can create confusing OR-policy behaviour.
-- ============================================================

drop policy if exists product_images_vendor_insert on storage.objects;
drop policy if exists product_images_vendor_update on storage.objects;
drop policy if exists product_images_vendor_delete on storage.objects;


-- ============================================================
-- 5. FUNCTION PERMISSIONS
-- ============================================================

revoke all on function public.admin_create_vendor_v2(
  text,text,integer,text,text,text,text,boolean
) from public, anon, authenticated;

grant execute on function public.admin_create_vendor_v2(
  text,text,integer,text,text,text,text,boolean
) to authenticated;

revoke all on function public.admin_update_vendor_v2(
  uuid,text,text,integer,text,text,text,text,boolean,boolean
) from public, anon, authenticated;

grant execute on function public.admin_update_vendor_v2(
  uuid,text,text,integer,text,text,text,text,boolean,boolean
) to authenticated;

revoke all on function public.get_storefront_products()
from public;

grant execute on function public.get_storefront_products()
to anon, authenticated;

commit;


-- ============================================================
-- POST-RUN AUDIT
-- Send this result back before committing.
-- ============================================================

with checks as (
  select
    'function'::text as check_type,
    p.proname::text as name,
    p.oid::regprocedure::text as detail
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in (
      'admin_create_vendor_v2',
      'admin_update_vendor_v2',
      'get_storefront_products'
    )

  union all

  select
    'storage_policy',
    policyname,
    cmd || ' :: roles=' || array_to_string(roles, ',')
  from pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname like 'product_images_%'

  union all

  select
    'storefront_sample',
    'active products returned',
    jsonb_array_length(public.get_storefront_products())::text
)

select *
from checks
order by check_type, name;


-- The following should return ZERO rows.
select
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname in (
    'product_images_vendor_insert',
    'product_images_vendor_update',
    'product_images_vendor_delete'
  );
