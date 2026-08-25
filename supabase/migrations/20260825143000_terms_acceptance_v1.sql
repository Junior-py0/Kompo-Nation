-- KOMPO NATION TERMS ACCEPTANCE V1
-- Terms version: 1.0
-- Effective date: 25 August 2026

begin;


create table if not exists public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null
    references auth.users(id)
    on delete cascade,

  terms_version text not null,

  acceptance_context text not null
    check (
      acceptance_context in (
        'signup',
        'checkout',
        'vendor',
        'account'
      )
    ),

  accepted_at timestamptz
    not null
    default now(),

  order_id uuid
    references public.orders(id)
    on delete set null,

  source text
    not null
    default 'web'
);


create index if not exists
terms_acceptances_user_version_context_idx
on public.terms_acceptances(
  user_id,
  terms_version,
  acceptance_context,
  accepted_at desc
);


create index if not exists
terms_acceptances_order_idx
on public.terms_acceptances(order_id)
where order_id is not null;


alter table public.terms_acceptances
enable row level security;


drop policy if exists
terms_acceptances_select_own
on public.terms_acceptances;


create policy terms_acceptances_select_own
on public.terms_acceptances
for select
to authenticated
using (
  user_id = auth.uid()
  or public.is_platform_admin()
);


revoke insert, update, delete
on public.terms_acceptances
from anon, authenticated;


grant select
on public.terms_acceptances
to authenticated;


-- ------------------------------------------------------------
-- Authenticated users deliberately accept the CURRENT terms.
-- A new record is inserted every time. We keep history.
-- ------------------------------------------------------------

create or replace function
public.accept_current_terms(
  p_context text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_id uuid;
begin

  if v_user_id is null then
    raise exception
      'Authentication required.';
  end if;


  if p_context not in (
    'checkout',
    'vendor',
    'account'
  ) then
    raise exception
      'Invalid terms acceptance context.';
  end if;


  insert into public.terms_acceptances (
    user_id,
    terms_version,
    acceptance_context,
    accepted_at,
    source
  )
  values (
    v_user_id,
    '1.0',
    p_context,
    now(),
    'web'
  )
  returning id
  into v_id;


  return v_id;
end;
$function$;


revoke all
on function public.accept_current_terms(text)
from public;


grant execute
on function public.accept_current_terms(text)
to authenticated;


-- ------------------------------------------------------------
-- Used by the vendor portal to gate access.
-- ------------------------------------------------------------

create or replace function
public.has_current_terms_acceptance(
  p_context text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    auth.uid() is not null
    and exists (
      select 1
      from public.terms_acceptances ta
      where ta.user_id = auth.uid()
        and ta.terms_version = '1.0'
        and ta.acceptance_context = p_context
    );
$function$;


revoke all
on function
public.has_current_terms_acceptance(text)
from public;


grant execute
on function
public.has_current_terms_acceptance(text)
to authenticated;


-- ------------------------------------------------------------
-- Capture signup clickwrap from Supabase Auth metadata.
-- This works even where email confirmation means signup
-- does not immediately return a browser session.
-- ------------------------------------------------------------

create or replace function
public.capture_signup_terms_acceptance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_version text;
  v_accepted text;
  v_accepted_at timestamptz;
begin

  v_version :=
    new.raw_user_meta_data
      ->> 'terms_version';

  v_accepted :=
    new.raw_user_meta_data
      ->> 'terms_accepted';


  if (
    v_version = '1.0'
    and lower(
      coalesce(
        v_accepted,
        'false'
      )
    ) = 'true'
  ) then

    v_accepted_at :=
      coalesce(
        (
          new.raw_user_meta_data
            ->> 'terms_accepted_at'
        )::timestamptz,
        now()
      );


    insert into
    public.terms_acceptances (
      user_id,
      terms_version,
      acceptance_context,
      accepted_at,
      source
    )
    values (
      new.id,
      '1.0',
      'signup',
      v_accepted_at,
      'supabase_auth_signup'
    );

  end if;


  return new;
end;
$function$;


drop trigger if exists
capture_signup_terms_acceptance_trigger
on auth.users;


create trigger
capture_signup_terms_acceptance_trigger
after insert on auth.users
for each row
execute function
public.capture_signup_terms_acceptance();


commit;
