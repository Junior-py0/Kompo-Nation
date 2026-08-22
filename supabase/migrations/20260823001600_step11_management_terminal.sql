-- KOMPO NATION - STEP 11 MANAGEMENT TERMINAL DATABASE UPGRADE
-- Run this entire file once in Supabase SQL Editor.
-- Based on the live audit captured on 23 Aug 2026.
-- It preserves orders, payments, customers, vendors and historical sales.

begin;

-- 1. Allow the planned R2 test product.
alter table public.product_variants
  drop constraint if exists product_variants_price_cents_check;

alter table public.product_variants
  add constraint product_variants_price_cents_check
  check (price_cents >= 100);

-- 2. Real clothing product creation:
--    user supplies normal product information, sizes and colours;
--    the database creates a stable URL slug and automatic SKUs.
create or replace function public.save_product_v2(
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
  p_status text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_product_id uuid := gen_random_uuid();
  v_base_slug text;
  v_slug text;
  v_size text;
  v_colour text;
  v_sku text;
begin
  if not (public.is_platform_admin() or public.is_vendor_member(p_vendor_id)) then
    raise exception 'You do not have catalogue permission for this store.';
  end if;

  if trim(coalesce(p_name, '')) = '' then raise exception 'Product name is required.'; end if;
  if trim(coalesce(p_category, '')) = '' then raise exception 'Category is required.'; end if;
  if trim(coalesce(p_description, '')) = '' then raise exception 'Description is required.'; end if;
  if p_price_cents < 100 then raise exception 'Price must be at least R1.00.'; end if;
  if p_stock_quantity < 0 then raise exception 'Stock cannot be negative.'; end if;
  if coalesce(array_length(p_sizes,1),0) = 0 then raise exception 'Choose at least one size.'; end if;
  if coalesce(array_length(p_colours,1),0) = 0 then raise exception 'Choose at least one colour.'; end if;
  if p_status not in ('draft','active') then raise exception 'New products must be draft or active.'; end if;

  v_base_slug := trim(both '-' from regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_base_slug = '' then v_base_slug := 'product'; end if;
  v_slug := v_base_slug;

  while exists (select 1 from public.products where slug = v_slug) loop
    v_slug := v_base_slug || '-' || substr(md5(gen_random_uuid()::text),1,6);
  end loop;

  insert into public.products(
    id,vendor_id,slug,name,description,category,tone,is_rare,status
  ) values (
    v_product_id,p_vendor_id,v_slug,trim(p_name),trim(p_description),
    trim(p_category),'sage',coalesce(p_is_rare,false),p_status
  );

  foreach v_size in array p_sizes loop
    v_size := trim(v_size);
    if v_size = '' then continue; end if;

    foreach v_colour in array p_colours loop
      v_colour := trim(v_colour);
      if v_colour = '' then continue; end if;

      v_sku := 'KN-' ||
        upper(substr(replace(v_product_id::text,'-',''),1,6)) || '-' ||
        upper(substr(md5(v_size || '|' || v_colour || '|' || gen_random_uuid()::text),1,6));

      insert into public.product_variants(
        product_id,sku,size,colour,price_cents,stock_quantity,
        weight_kg,length_cm,width_cm,height_cm,active
      ) values (
        v_product_id,v_sku,v_size,v_colour,p_price_cents,p_stock_quantity,
        p_weight_kg,p_length_cm,p_width_cm,p_height_cm,true
      );
    end loop;
  end loop;

  if not exists (select 1 from public.product_variants where product_id = v_product_id) then
    raise exception 'No valid size and colour combinations were supplied.';
  end if;

  return v_product_id;
end;
$function$;

-- 3. Edit product information without changing the slug.
create or replace function public.update_product_details(
  p_product_id uuid,
  p_name text,
  p_category text,
  p_description text,
  p_is_rare boolean,
  p_status text
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
  from public.products
  where id = p_product_id;

  if v_vendor_id is null then raise exception 'Product not found.'; end if;
  if not (public.is_platform_admin() or public.is_vendor_member(v_vendor_id)) then
    raise exception 'You do not have catalogue permission for this product.';
  end if;
  if p_status not in ('draft','active','archived') then raise exception 'Invalid product status.'; end if;

  update public.products
  set name = trim(p_name),
      category = trim(p_category),
      description = trim(p_description),
      is_rare = coalesce(p_is_rare,false),
      status = p_status,
      updated_at = now()
  where id = p_product_id;
end;
$function$;

-- 4. Add another size / colour later.
create or replace function public.add_product_variant(
  p_product_id uuid,
  p_size text,
  p_colour text,
  p_price_cents bigint,
  p_stock_quantity integer,
  p_weight_kg numeric,
  p_length_cm numeric,
  p_width_cm numeric,
  p_height_cm numeric
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vendor_id uuid;
  v_variant_id uuid := gen_random_uuid();
  v_sku text;
begin
  select vendor_id into v_vendor_id from public.products where id = p_product_id;
  if v_vendor_id is null then raise exception 'Product not found.'; end if;

  if not (public.is_platform_admin() or public.is_vendor_member(v_vendor_id)) then
    raise exception 'You do not have catalogue permission for this product.';
  end if;

  if trim(coalesce(p_size,'')) = '' or trim(coalesce(p_colour,'')) = '' then
    raise exception 'Size and colour are required.';
  end if;
  if p_price_cents < 100 then raise exception 'Price must be at least R1.00.'; end if;
  if p_stock_quantity < 0 then raise exception 'Stock cannot be negative.'; end if;

  v_sku := 'KN-' ||
    upper(substr(replace(p_product_id::text,'-',''),1,6)) || '-' ||
    upper(substr(md5(p_size || '|' || p_colour || '|' || gen_random_uuid()::text),1,6));

  insert into public.product_variants(
    id,product_id,sku,size,colour,price_cents,stock_quantity,
    weight_kg,length_cm,width_cm,height_cm,active
  ) values (
    v_variant_id,p_product_id,v_sku,trim(p_size),trim(p_colour),
    p_price_cents,p_stock_quantity,p_weight_kg,p_length_cm,p_width_cm,p_height_cm,true
  );

  if p_stock_quantity <> 0 then
    insert into public.inventory_movements(
      variant_id,quantity_delta,reason,reference_type,reference_id
    ) values (
      v_variant_id,p_stock_quantity,'initial_stock','product_variant',v_variant_id
    );
  end if;

  return v_variant_id;
end;
$function$;

-- 5. Set stock and record the movement.
create or replace function public.set_variant_stock(
  p_variant_id uuid,
  p_new_quantity integer,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vendor_id uuid;
  v_old_quantity integer;
  v_delta integer;
begin
  if p_new_quantity < 0 then raise exception 'Stock cannot be negative.'; end if;

  select p.vendor_id,pv.stock_quantity
  into v_vendor_id,v_old_quantity
  from public.product_variants pv
  join public.products p on p.id = pv.product_id
  where pv.id = p_variant_id
  for update of pv;

  if v_vendor_id is null then raise exception 'Variant not found.'; end if;
  if not (public.is_platform_admin() or public.is_vendor_member(v_vendor_id)) then
    raise exception 'You do not have inventory permission for this store.';
  end if;

  v_delta := p_new_quantity - v_old_quantity;
  if v_delta = 0 then return; end if;

  update public.product_variants
  set stock_quantity = p_new_quantity, updated_at = now()
  where id = p_variant_id;

  insert into public.inventory_movements(
    variant_id,quantity_delta,reason,reference_type,reference_id
  ) values (
    p_variant_id,v_delta,
    coalesce(nullif(trim(p_reason),''),'manual_adjustment'),
    'product_variant',p_variant_id
  );
end;
$function$;

-- 6. Archive a product.
create or replace function public.archive_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vendor_id uuid;
begin
  select vendor_id into v_vendor_id from public.products where id = p_product_id;
  if v_vendor_id is null then raise exception 'Product not found.'; end if;

  if not (public.is_platform_admin() or public.is_vendor_member(v_vendor_id)) then
    raise exception 'You do not have catalogue permission for this product.';
  end if;

  update public.products
  set status = 'archived', updated_at = now()
  where id = p_product_id;
end;
$function$;

-- 7. Delete only unused products; sold products must be archived.
create or replace function public.delete_unused_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_vendor_id uuid;
  v_sales bigint;
begin
  select vendor_id,sales_count into v_vendor_id,v_sales
  from public.products
  where id = p_product_id;

  if v_vendor_id is null then raise exception 'Product not found.'; end if;

  if not (public.is_platform_admin() or public.is_vendor_member(v_vendor_id)) then
    raise exception 'You do not have catalogue permission for this product.';
  end if;

  if v_sales > 0 or exists (
    select 1 from public.order_items where product_id = p_product_id
  ) then
    raise exception 'This product has order history and must be archived instead of deleted.';
  end if;

  delete from public.products where id = p_product_id;
end;
$function$;

-- 8. Saved-address default setter.
create or replace function public.set_default_address(p_address_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not exists (
    select 1 from public.addresses
    where id = p_address_id and customer_id = auth.uid()
  ) then
    raise exception 'Address not found.';
  end if;

  update public.addresses
  set is_default = false
  where customer_id = auth.uid();

  update public.addresses
  set is_default = true
  where id = p_address_id and customer_id = auth.uid();
end;
$function$;

-- 9. Admin can assign an existing Kompo Nation user to a store.
create or replace function public.admin_upsert_vendor_member(
  p_vendor_id uuid,
  p_user_id uuid,
  p_role text,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then raise exception 'Admin access required.'; end if;
  if p_role not in ('owner','manager','fulfilment','catalogue') then raise exception 'Invalid vendor role.'; end if;
  if p_status not in ('invited','active','suspended') then raise exception 'Invalid membership status.'; end if;

  insert into public.vendor_members(vendor_id,user_id,role,status)
  values (p_vendor_id,p_user_id,p_role,p_status)
  on conflict (vendor_id,user_id)
  do update set role = excluded.role, status = excluded.status;
end;
$function$;

create or replace function public.admin_remove_vendor_member(
  p_vendor_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then raise exception 'Admin access required.'; end if;
  delete from public.vendor_members
  where vendor_id = p_vendor_id and user_id = p_user_id;
end;
$function$;

-- 10. Product image storage policies.
-- Portal path convention: vendor-id/product-id/random-filename.ext
drop policy if exists product_images_public_read on storage.objects;
create policy product_images_public_read
on storage.objects for select to public
using (bucket_id = 'product-images');

drop policy if exists product_images_member_insert on storage.objects;
create policy product_images_member_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'product-images'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.vendor_members vm
      where vm.user_id = auth.uid()
        and vm.status = 'active'
        and vm.vendor_id::text = (storage.foldername(name))[1]
    )
  )
);

drop policy if exists product_images_member_update on storage.objects;
create policy product_images_member_update
on storage.objects for update to authenticated
using (
  bucket_id = 'product-images'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.vendor_members vm
      where vm.user_id = auth.uid()
        and vm.status = 'active'
        and vm.vendor_id::text = (storage.foldername(name))[1]
    )
  )
)
with check (
  bucket_id = 'product-images'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.vendor_members vm
      where vm.user_id = auth.uid()
        and vm.status = 'active'
        and vm.vendor_id::text = (storage.foldername(name))[1]
    )
  )
);

drop policy if exists product_images_member_delete on storage.objects;
create policy product_images_member_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'product-images'
  and (
    public.is_platform_admin()
    or exists (
      select 1 from public.vendor_members vm
      where vm.user_id = auth.uid()
        and vm.status = 'active'
        and vm.vendor_id::text = (storage.foldername(name))[1]
    )
  )
);

-- 11. Permissions.
revoke all on function public.save_product_v2(
  uuid,text,text,text,bigint,text[],text[],integer,numeric,numeric,numeric,numeric,boolean,text
) from public, anon;
grant execute on function public.save_product_v2(
  uuid,text,text,text,bigint,text[],text[],integer,numeric,numeric,numeric,numeric,boolean,text
) to authenticated;

revoke all on function public.update_product_details(uuid,text,text,text,boolean,text) from public, anon;
grant execute on function public.update_product_details(uuid,text,text,text,boolean,text) to authenticated;

revoke all on function public.add_product_variant(
  uuid,text,text,bigint,integer,numeric,numeric,numeric,numeric
) from public, anon;
grant execute on function public.add_product_variant(
  uuid,text,text,bigint,integer,numeric,numeric,numeric,numeric
) to authenticated;

revoke all on function public.set_variant_stock(uuid,integer,text) from public, anon;
grant execute on function public.set_variant_stock(uuid,integer,text) to authenticated;

revoke all on function public.archive_product(uuid) from public, anon;
grant execute on function public.archive_product(uuid) to authenticated;

revoke all on function public.delete_unused_product(uuid) from public, anon;
grant execute on function public.delete_unused_product(uuid) to authenticated;

revoke all on function public.set_default_address(uuid) from public, anon;
grant execute on function public.set_default_address(uuid) to authenticated;

revoke all on function public.admin_upsert_vendor_member(uuid,uuid,text,text) from public, anon;
grant execute on function public.admin_upsert_vendor_member(uuid,uuid,text,text) to authenticated;

revoke all on function public.admin_remove_vendor_member(uuid,uuid) from public, anon;
grant execute on function public.admin_remove_vendor_member(uuid,uuid) to authenticated;

commit;

-- ============================================================
-- POST-RUN AUDIT
-- Copy this result back to ChatGPT before committing the Git changes.
-- ============================================================
select
  'price constraint' as check_name,
  pg_get_constraintdef(oid) as result
from pg_constraint
where conrelid = 'public.product_variants'::regclass
  and conname = 'product_variants_price_cents_check'

union all
select 'function save_product_v2', oid::regprocedure::text
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'save_product_v2'

union all
select 'function set_variant_stock', oid::regprocedure::text
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'set_variant_stock'

union all
select 'function set_default_address', oid::regprocedure::text
from pg_proc
where pronamespace = 'public'::regnamespace and proname = 'set_default_address'

union all
select 'storage policy', policyname
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'product_images_%'

order by 1,2;
