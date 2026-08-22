-- KOMPO NATION — STEP 11B.3 STORE NETWORK CLEANUP
-- Goal:
--   1. Keep BARAX as the test brand.
--   2. Keep/rename LE 26 -> Le Two 6.
--   3. Create/keep King of Kasi Tribes.
--   4. Assign BARAX to ramashilokgotsofatso@gmail.com as owner.
--   5. Remove every other store from the operational marketplace.
--
-- Safety:
--   - Stores with NO order/return/cancellation history are hard-deleted.
--   - Stores WITH history are retired + suspended instead of destroying
--     historical orders/payment records.
--
-- Run this entire file once in Supabase SQL Editor.

begin;

alter table public.vendors
  add column if not exists retired_at timestamptz;


do $$
declare
  v_test_vendor_id uuid;
  v_le_two_6_id uuid;
  v_kok_id uuid;
  v_owner_id uuid;
begin
  -- ==========================================================
  -- 1. TEST BRAND = BARAX
  -- ==========================================================
  select id
  into v_test_vendor_id
  from public.vendors
  where lower(trim(business_name)) = 'barax'
     or lower(trim(slug)) = 'barax'
  order by created_at
  limit 1;

  if v_test_vendor_id is null then
    raise exception 'BARAX was not found. Cleanup stopped before changing store data.';
  end if;

  update public.vendors
  set
    retired_at = null,
    status = 'active',
    updated_at = now()
  where id = v_test_vendor_id;


  -- ==========================================================
  -- 2. LE TWO 6
  -- Reuse the current LE 26 record.
  -- ==========================================================
  select id
  into v_le_two_6_id
  from public.vendors
  where lower(trim(business_name)) in (
      'le 26',
      'le two 6',
      'le two six'
    )
     or lower(trim(slug)) in (
      'le-26',
      'le-two-6',
      'le-two-six'
    )
  order by created_at
  limit 1;

  if v_le_two_6_id is null then
    insert into public.vendors(
      slug,
      business_name,
      description,
      short_description,
      mark,
      accent,
      commission_rate_bps,
      status,
      is_platform_owned,
      featured_override,
      retired_at
    )
    values(
      'le-two-6',
      'Le Two 6',
      '',
      '',
      'L26',
      'stone',
      1000,
      'active',
      false,
      null,
      null
    )
    returning id into v_le_two_6_id;
  else
    -- Free the preferred slug only if an unrelated row currently owns it.
    if exists (
      select 1
      from public.vendors
      where slug = 'le-two-6'
        and id <> v_le_two_6_id
    ) then
      raise exception 'The slug le-two-6 is already owned by another store. Cleanup stopped.';
    end if;

    update public.vendors
    set
      business_name = 'Le Two 6',
      slug = 'le-two-6',
      mark = 'L26',
      status = 'active',
      retired_at = null,
      updated_at = now()
    where id = v_le_two_6_id;
  end if;


  -- ==========================================================
  -- 3. KING OF KASI TRIBES (KOK)
  -- Do not invent brand copy or assets; create only the shell.
  -- ==========================================================
  select id
  into v_kok_id
  from public.vendors
  where lower(trim(business_name)) in (
      'king of kasi tribes',
      'king of kasi tribes (kok)',
      'kok'
    )
     or lower(trim(slug)) in (
      'king-of-kasi-tribes',
      'kok'
    )
  order by created_at
  limit 1;

  if v_kok_id is null then
    if exists (
      select 1
      from public.vendors
      where slug = 'king-of-kasi-tribes'
    ) then
      raise exception 'The slug king-of-kasi-tribes is already owned by another store. Cleanup stopped.';
    end if;

    insert into public.vendors(
      slug,
      business_name,
      description,
      short_description,
      mark,
      accent,
      commission_rate_bps,
      status,
      is_platform_owned,
      featured_override,
      retired_at
    )
    values(
      'king-of-kasi-tribes',
      'King of Kasi Tribes',
      '',
      '',
      'KOK',
      'stone',
      1000,
      'active',
      false,
      null,
      null
    )
    returning id into v_kok_id;
  else
    update public.vendors
    set
      business_name = 'King of Kasi Tribes',
      mark = 'KOK',
      status = 'active',
      retired_at = null,
      updated_at = now()
    where id = v_kok_id;
  end if;


  -- ==========================================================
  -- 4. ASSIGN THE TEST BRAND TO THE OWNER EMAIL
  -- ==========================================================
  select id
  into v_owner_id
  from auth.users
  where lower(email) = lower('ramashilokgotsofatso@gmail.com')
  limit 1;

  if v_owner_id is null then
    raise exception 'The Kompo Nation account ramashilokgotsofatso@gmail.com was not found. Cleanup stopped.';
  end if;

  insert into public.profiles(id, full_name)
  values(
    v_owner_id,
    coalesce(
      nullif(trim((
        select raw_user_meta_data ->> 'full_name'
        from auth.users
        where id = v_owner_id
      )), ''),
      'Kgotsofatjo'
    )
  )
  on conflict (id)
  do nothing;

  insert into public.vendor_members(
    vendor_id,
    user_id,
    role,
    status
  )
  values(
    v_test_vendor_id,
    v_owner_id,
    'owner',
    'active'
  )
  on conflict (vendor_id, user_id)
  do update set
    role = 'owner',
    status = 'active';


  -- ==========================================================
  -- 5. RETIRE UNWANTED STORES THAT HAVE HISTORY
  -- We preserve history so paid/test orders remain internally valid.
  -- ==========================================================
  update public.products p
  set
    status = 'archived',
    updated_at = now()
  where p.vendor_id not in (
      v_test_vendor_id,
      v_le_two_6_id,
      v_kok_id
    )
    and exists (
      select 1
      from public.vendor_orders vo
      where vo.vendor_id = p.vendor_id

      union all

      select 1
      from public.order_items oi
      where oi.vendor_id = p.vendor_id

      union all

      select 1
      from public.returns r
      where r.vendor_id = p.vendor_id

      union all

      select 1
      from public.order_cancellation_requests c
      where c.vendor_id = p.vendor_id
    );

  update public.vendors v
  set
    status = 'suspended',
    retired_at = coalesce(v.retired_at, now()),
    featured_override = false,
    updated_at = now()
  where v.id not in (
      v_test_vendor_id,
      v_le_two_6_id,
      v_kok_id
    )
    and (
      exists (
        select 1 from public.vendor_orders vo
        where vo.vendor_id = v.id
      )
      or exists (
        select 1 from public.order_items oi
        where oi.vendor_id = v.id
      )
      or exists (
        select 1 from public.returns r
        where r.vendor_id = v.id
      )
      or exists (
        select 1 from public.order_cancellation_requests c
        where c.vendor_id = v.id
      )
    );


  -- ==========================================================
  -- 6. HARD-DELETE UNWANTED STORES WITH NO HISTORY
  -- Clean product dependencies first because those FKs are intentional.
  -- ==========================================================
  delete from public.wishlist_items wi
  where wi.product_id in (
    select p.id
    from public.products p
    where p.vendor_id not in (
        v_test_vendor_id,
        v_le_two_6_id,
        v_kok_id
      )
      and not exists (
        select 1 from public.vendor_orders vo
        where vo.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.order_items oi
        where oi.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.returns r
        where r.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.order_cancellation_requests c
        where c.vendor_id = p.vendor_id
      )
  );

  delete from public.inventory_movements im
  where im.variant_id in (
    select pv.id
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where p.vendor_id not in (
        v_test_vendor_id,
        v_le_two_6_id,
        v_kok_id
      )
      and not exists (
        select 1 from public.vendor_orders vo
        where vo.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.order_items oi
        where oi.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.returns r
        where r.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.order_cancellation_requests c
        where c.vendor_id = p.vendor_id
      )
  );

  delete from public.stock_reservations sr
  where sr.variant_id in (
    select pv.id
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where p.vendor_id not in (
        v_test_vendor_id,
        v_le_two_6_id,
        v_kok_id
      )
      and not exists (
        select 1 from public.vendor_orders vo
        where vo.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.order_items oi
        where oi.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.returns r
        where r.vendor_id = p.vendor_id
      )
      and not exists (
        select 1 from public.order_cancellation_requests c
        where c.vendor_id = p.vendor_id
      )
  );

  delete from public.products p
  where p.vendor_id not in (
      v_test_vendor_id,
      v_le_two_6_id,
      v_kok_id
    )
    and not exists (
      select 1 from public.vendor_orders vo
      where vo.vendor_id = p.vendor_id
    )
    and not exists (
      select 1 from public.order_items oi
      where oi.vendor_id = p.vendor_id
    )
    and not exists (
      select 1 from public.returns r
      where r.vendor_id = p.vendor_id
    )
    and not exists (
      select 1 from public.order_cancellation_requests c
      where c.vendor_id = p.vendor_id
    );

  delete from public.vendors v
  where v.id not in (
      v_test_vendor_id,
      v_le_two_6_id,
      v_kok_id
    )
    and not exists (
      select 1 from public.vendor_orders vo
      where vo.vendor_id = v.id
    )
    and not exists (
      select 1 from public.order_items oi
      where oi.vendor_id = v.id
    )
    and not exists (
      select 1 from public.returns r
      where r.vendor_id = v.id
    )
    and not exists (
      select 1 from public.order_cancellation_requests c
      where c.vendor_id = v.id
    );

end
$$;

commit;


-- ============================================================
-- POST-RUN AUDIT 1: OPERATIONAL STORES
-- This should show exactly BARAX, King of Kasi Tribes, Le Two 6.
-- ============================================================

select
  v.id,
  v.business_name,
  v.slug,
  v.status,
  v.retired_at,
  count(vm.user_id) filter (where vm.status = 'active') as active_members
from public.vendors v
left join public.vendor_members vm on vm.vendor_id = v.id
where v.retired_at is null
group by
  v.id,
  v.business_name,
  v.slug,
  v.status,
  v.retired_at
order by v.business_name;


-- ============================================================
-- POST-RUN AUDIT 2: TEST BRAND OWNER
-- Should show BARAX + ramashilokgotsofatso@gmail.com + owner + active.
-- ============================================================

select
  v.business_name,
  u.email,
  vm.role,
  vm.status
from public.vendor_members vm
join public.vendors v on v.id = vm.vendor_id
join auth.users u on u.id = vm.user_id
where lower(v.business_name) = 'barax'
  and lower(u.email) = lower('ramashilokgotsofatso@gmail.com');


-- ============================================================
-- POST-RUN AUDIT 3: RETIRED HISTORY-ONLY STORES
-- Zero rows is ideal. Rows here are intentionally retained ONLY
-- because historical order/payment integrity references them.
-- They will be hidden from the operational Admin/Storefront UI.
-- ============================================================

select
  v.business_name,
  v.status,
  v.retired_at,
  (select count(*) from public.vendor_orders vo where vo.vendor_id = v.id) as vendor_orders,
  (select count(*) from public.order_items oi where oi.vendor_id = v.id) as order_items
from public.vendors v
where v.retired_at is not null
order by v.business_name;
