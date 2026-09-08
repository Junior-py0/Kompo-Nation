begin;

-- Kitora launched on 7 September 2026. Accounts created before that date
-- belong to Kompo Nation even if they predate signup terms capture.
insert into public.app_memberships(user_id, app_id)
select id, 'kompo'
from auth.users
where created_at < timestamptz '2026-09-07 00:00:00+02'
on conflict do nothing;

commit;
