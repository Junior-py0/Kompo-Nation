begin;

create table if not exists public.app_memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  app_id text not null check (app_id = 'kompo'),
  created_at timestamptz not null default now(),
  primary key (user_id, app_id)
);

alter table public.app_memberships enable row level security;

drop policy if exists app_memberships_read_own on public.app_memberships;
create policy app_memberships_read_own
on public.app_memberships for select to authenticated
using (user_id = auth.uid());

revoke all on public.app_memberships from public, anon, authenticated;
grant select on public.app_memberships to authenticated;
grant all on public.app_memberships to service_role;

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
      where m.user_id = auth.uid() and m.app_id = p_app_id
    );
$function$;

revoke all on function public.has_app_membership(text) from public, anon;
grant execute on function public.has_app_membership(text) to authenticated, service_role;

create or replace function public.capture_app_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_app text := lower(coalesce(new.raw_user_meta_data ->> 'app_id', ''));
begin
  if v_app = 'kompo' then
    insert into public.app_memberships(user_id, app_id)
    values (new.id, v_app)
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

drop trigger if exists capture_app_membership_trigger on auth.users;
create trigger capture_app_membership_trigger
after insert on auth.users
for each row execute function public.capture_app_membership();

insert into public.app_memberships(user_id, app_id)
select distinct user_id, 'kompo' from public.terms_acceptances
where acceptance_context = 'signup'
on conflict do nothing;

insert into public.app_memberships(user_id, app_id)
select distinct user_id, 'kompo' from public.platform_roles
on conflict do nothing;

insert into public.app_memberships(user_id, app_id)
select distinct user_id, 'kompo' from public.vendor_members
on conflict do nothing;

insert into public.app_memberships(user_id, app_id)
select distinct customer_id, 'kompo' from public.orders
where customer_id is not null
on conflict do nothing;

do $block$
declare
  r record;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
      and rowsecurity
      and tablename <> 'app_memberships'
  loop
    execute format('drop policy if exists app_membership_boundary on public.%I', r.tablename);
    execute format(
      'create policy app_membership_boundary on public.%I as restrictive for all to authenticated using (public.has_app_membership(%L)) with check (public.has_app_membership(%L))',
      r.tablename,
      'kompo',
      'kompo'
    );
  end loop;
end;
$block$;

commit;
