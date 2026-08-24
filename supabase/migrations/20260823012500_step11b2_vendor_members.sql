-- KOMPO NATION — STEP 11B.2
-- Fix no-store vendor state + add safe Admin Store Members functions.
-- Run this entire file once in Supabase SQL Editor.
-- No orders, products, payments or historical records are deleted.

begin;

-- ============================================================
-- 1. ADMIN: ASSIGN A USER TO A STORE BY EMAIL
-- Admins should never need to copy/paste UUIDs.
-- ============================================================

create or replace function public.admin_assign_vendor_member_by_email(
  p_vendor_id uuid,
  p_email text,
  p_role text,
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_email text;
  v_full_name text;
begin
  if not public.is_platform_admin() then
    raise exception 'Admin access required.';
  end if;

  if not exists (
    select 1
    from public.vendors
    where id = p_vendor_id
  ) then
    raise exception 'Store not found.';
  end if;

  if trim(coalesce(p_email, '')) = ''
     or position('@' in p_email) <= 1 then
    raise exception 'Enter a valid Kompo Nation account email.';
  end if;

  if p_role not in ('owner', 'manager', 'fulfilment', 'catalogue') then
    raise exception 'Invalid store role.';
  end if;

  if p_status not in ('invited', 'active', 'suspended') then
    raise exception 'Invalid membership status.';
  end if;

  select
    u.id,
    u.email,
    coalesce(
      nullif(trim(coalesce(p.full_name, '')), ''),
      nullif(trim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), ''),
      split_part(u.email, '@', 1)
    )
  into
    v_user_id,
    v_email,
    v_full_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'No Kompo Nation account exists for that email. Ask the person to create and confirm an account first.';
  end if;

  insert into public.profiles(id, full_name)
  values(v_user_id, coalesce(v_full_name, ''))
  on conflict (id)
  do update set
    full_name = case
      when trim(coalesce(public.profiles.full_name, '')) = ''
      then excluded.full_name
      else public.profiles.full_name
    end,
    updated_at = now();

  insert into public.vendor_members(
    vendor_id,
    user_id,
    role,
    status
  )
  values(
    p_vendor_id,
    v_user_id,
    p_role,
    p_status
  )
  on conflict (vendor_id, user_id)
  do update set
    role = excluded.role,
    status = excluded.status;

  return jsonb_build_object(
    'user_id', v_user_id,
    'email', v_email,
    'full_name', v_full_name,
    'role', p_role,
    'status', p_status
  );
end;
$function$;


-- ============================================================
-- 2. ADMIN: LIST A STORE'S MEMBERS WITH HUMAN-READABLE DETAILS
-- ============================================================

create or replace function public.admin_list_vendor_members(
  p_vendor_id uuid
)
returns table(
  user_id uuid,
  email text,
  full_name text,
  role text,
  status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not public.is_platform_admin() then
    raise exception 'Admin access required.';
  end if;

  return query
  select
    vm.user_id,
    u.email::text,
    coalesce(
      nullif(trim(coalesce(p.full_name, '')), ''),
      split_part(u.email, '@', 1)
    )::text as full_name,
    vm.role::text,
    vm.status::text,
    vm.created_at
  from public.vendor_members vm
  join auth.users u on u.id = vm.user_id
  left join public.profiles p on p.id = vm.user_id
  where vm.vendor_id = p_vendor_id
  order by
    case vm.role
      when 'owner' then 1
      when 'manager' then 2
      when 'catalogue' then 3
      when 'fulfilment' then 4
      else 5
    end,
    lower(u.email);
end;
$function$;


-- ============================================================
-- 3. EXECUTE PERMISSIONS
-- Both functions still perform an internal platform-admin check.
-- ============================================================

revoke all on function public.admin_assign_vendor_member_by_email(
  uuid,text,text,text
) from public, anon, authenticated;

grant execute on function public.admin_assign_vendor_member_by_email(
  uuid,text,text,text
) to authenticated;

revoke all on function public.admin_list_vendor_members(uuid)
from public, anon, authenticated;

grant execute on function public.admin_list_vendor_members(uuid)
to authenticated;

commit;


-- ============================================================
-- POST-RUN AUDIT
-- Send this table back before committing the frontend patch.
-- ============================================================

select
  p.proname as function_name,
  p.oid::regprocedure::text as signature,
  p.prosecdef as security_definer
from pg_proc p
where p.pronamespace = 'public'::regnamespace
  and p.proname in (
    'admin_assign_vendor_member_by_email',
    'admin_list_vendor_members',
    'admin_upsert_vendor_member',
    'admin_remove_vendor_member'
  )
order by p.proname;


-- Optional visibility check: store membership counts only.
select
  v.business_name,
  count(vm.user_id) as member_count,
  count(vm.user_id) filter (where vm.status = 'active') as active_member_count
from public.vendors v
left join public.vendor_members vm on vm.vendor_id = v.id
group by v.id, v.business_name
order by v.business_name;
