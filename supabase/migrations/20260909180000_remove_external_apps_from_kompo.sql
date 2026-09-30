begin;

-- Kompo Nation is now intentionally a single-application backend. Kitora's
-- temporary shared objects are removed; the shared person's Kompo account is
-- retained and only the Kitora membership marker is deleted.
delete from public.app_memberships where app_id = 'kitora';

update auth.users
set raw_user_meta_data = raw_user_meta_data - 'app_id'
where lower(coalesce(raw_user_meta_data ->> 'app_id', '')) = 'kitora';

drop table if exists public.iot_addresses cascade;
drop table if exists public.iot_audit cascade;
drop table if exists public.iot_carts cascade;
drop table if exists public.iot_refunds cascade;
drop table if exists public.iot_payments cascade;
drop table if exists public.iot_shipments cascade;
drop table if exists public.iot_order_items cascade;
drop table if exists public.iot_orders cascade;
drop table if exists public.iot_quotes cascade;
drop table if exists public.iot_requests cascade;
drop table if exists public.iot_products cascade;
drop table if exists public.iot_settings cascade;
drop table if exists public.iot_admins cascade;

do $drop_iot_routines$
declare
  routine record;
begin
  for routine in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'iot\_%' escape '\'
  loop
    execute format('drop function if exists %s cascade', routine.signature);
  end loop;
end
$drop_iot_routines$;

alter table public.app_memberships
  drop constraint if exists app_memberships_app_id_check;
alter table public.app_memberships
  add constraint app_memberships_app_id_check check (app_id = 'kompo');

create or replace function public.has_app_membership(p_app_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
    and p_app_id = 'kompo'
    and exists (
      select 1 from public.app_memberships m
      where m.user_id = auth.uid() and m.app_id = 'kompo'
    );
$function$;

create or replace function public.capture_app_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if lower(coalesce(new.raw_user_meta_data ->> 'app_id', '')) = 'kompo' then
    insert into public.app_memberships(user_id, app_id)
    values (new.id, 'kompo')
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

commit;
