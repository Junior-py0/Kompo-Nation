begin;

alter table public.vendor_private_settings
  add column if not exists package_length_cm numeric,
  add column if not exists package_width_cm numeric,
  add column if not exists package_height_cm numeric,
  add column if not exists package_tare_weight_kg numeric not null default 0,
  add column if not exists package_item_capacity integer not null default 3;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_private_settings_package_length_check'
      and conrelid = 'public.vendor_private_settings'::regclass
  ) then
    alter table public.vendor_private_settings
      add constraint vendor_private_settings_package_length_check
      check (package_length_cm is null or package_length_cm > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_private_settings_package_width_check'
      and conrelid = 'public.vendor_private_settings'::regclass
  ) then
    alter table public.vendor_private_settings
      add constraint vendor_private_settings_package_width_check
      check (package_width_cm is null or package_width_cm > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_private_settings_package_height_check'
      and conrelid = 'public.vendor_private_settings'::regclass
  ) then
    alter table public.vendor_private_settings
      add constraint vendor_private_settings_package_height_check
      check (package_height_cm is null or package_height_cm > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_private_settings_package_tare_check'
      and conrelid = 'public.vendor_private_settings'::regclass
  ) then
    alter table public.vendor_private_settings
      add constraint vendor_private_settings_package_tare_check
      check (package_tare_weight_kg >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'vendor_private_settings_package_capacity_check'
      and conrelid = 'public.vendor_private_settings'::regclass
  ) then
    alter table public.vendor_private_settings
      add constraint vendor_private_settings_package_capacity_check
      check (package_item_capacity between 1 and 50);
  end if;
end
$$;

comment on column public.vendor_private_settings.package_length_cm is 'Default shipping package outside length in centimetres.';
comment on column public.vendor_private_settings.package_width_cm is 'Default shipping package outside width in centimetres.';
comment on column public.vendor_private_settings.package_height_cm is 'Default shipping package outside height in centimetres.';
comment on column public.vendor_private_settings.package_tare_weight_kg is 'Empty/default packaging weight in kilograms.';
comment on column public.vendor_private_settings.package_item_capacity is 'Simple item-count capacity used to split a vendor order into parcels.';

commit;