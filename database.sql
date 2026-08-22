-- ============================================================================
-- KOMPO NATION DATABASE
-- Run this complete file once in a new Supabase project's SQL Editor.
-- Amounts are integer cents. Browser access is governed by row-level security.
-- ============================================================================

create extension if not exists pgcrypto;

-- ============================================================================
-- 01. ACCOUNTS, ROLES AND STORES
-- ============================================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.platform_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('owner','admin','support')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table if not exists public.vendors (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  business_name text not null,
  description text not null default '',
  short_description text not null default '',
  mark text not null default 'KN' check (char_length(mark) between 1 and 3),
  accent text not null default 'sage' check (accent in ('sage','mist','sand','stone')),
  commission_rate_bps integer not null default 1000 check (commission_rate_bps between 0 and 4000),
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  is_platform_owned boolean not null default false,
  featured_override boolean,
  sales_count bigint not null default 0 check (sales_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_members (
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'manager' check (role in ('owner','manager','fulfilment','catalogue')),
  status text not null default 'active' check (status in ('invited','active','suspended')),
  created_at timestamptz not null default now(),
  primary key (vendor_id, user_id)
);

create table if not exists public.vendor_private_settings (
  vendor_id uuid primary key references public.vendors(id) on delete cascade,
  contact_email text,
  contact_phone text,
  payfast_merchant_id text,
  payfast_split_approved boolean not null default false,
  collection_street_address text,
  collection_local_area text,
  collection_city text,
  collection_province text,
  collection_postal_code text,
  collection_country_code text not null default 'ZA',
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 02. CATALOGUE AND INVENTORY
-- ============================================================================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references public.vendors(id),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  description text not null,
  category text not null,
  tone text not null default 'sage' check (tone in ('sage','mist','sand','stone')),
  is_rare boolean not null default false,
  status text not null default 'draft' check (status in ('draft','active','archived')),
  sales_count bigint not null default 0 check (sales_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  sku text not null unique,
  size text not null,
  colour text not null,
  price_cents bigint not null check (price_cents >= 500),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  weight_kg numeric(8,3) not null default .35 check (weight_kg > 0),
  length_cm numeric(8,2) not null default 42 check (length_cm > 0),
  width_cm numeric(8,2) not null default 32 check (width_cm > 0),
  height_cm numeric(8,2) not null default 6 check (height_cm > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, size, colour)
);

create table if not exists public.product_media (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  storage_path text not null,
  public_url text,
  alt_text text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id),
  quantity_delta integer not null,
  reason text not null,
  reference_type text,
  reference_id uuid,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 03. CUSTOMER DATA
-- ============================================================================
create table if not exists public.addresses (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  label text not null,
  recipient_name text not null,
  phone text,
  street_address text not null,
  local_area text,
  city text not null,
  province text not null,
  postal_code text not null,
  country_code text not null default 'ZA',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.wishlists (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.wishlist_items (
  wishlist_id uuid not null references public.wishlists(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (wishlist_id, product_id)
);

create table if not exists public.newsletter_subscribers (
  email text primary key check (position('@' in email) > 1),
  status text not null default 'subscribed' check (status in ('subscribed','unsubscribed')),
  consented_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 04. ORDERS, PAYMENTS AND SHIPPING
-- ============================================================================
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique,
  customer_id uuid not null references public.profiles(id),
  customer_name text not null,
  customer_email text not null,
  customer_phone text not null,
  delivery_address jsonb not null,
  merchandise_total_cents bigint not null check (merchandise_total_cents >= 0),
  shipping_total_cents bigint not null check (shipping_total_cents >= 0),
  total_cents bigint not null check (total_cents >= 0),
  status text not null default 'pending_payment' check (status in ('pending_payment','paid','processing','partially_shipped','shipped','delivered','cancelled','partially_refunded','refunded','payment_review')),
  reservation_expires_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vendor_orders (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  public_reference text not null unique,
  merchandise_total_cents bigint not null,
  commission_total_cents bigint not null,
  vendor_net_cents bigint not null,
  shipping_charge_cents bigint not null,
  shipping_quote jsonb not null default '{}'::jsonb,
  fulfilment_status text not null default 'awaiting_payment' check (fulfilment_status in ('awaiting_payment','new','accepted','packing','packed','ready_for_collection','booked','shipped','delivered','cancelled')),
  fulfilment_due_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_id, vendor_id)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  vendor_order_id uuid not null references public.vendor_orders(id) on delete cascade,
  vendor_id uuid not null references public.vendors(id),
  product_id uuid references public.products(id),
  variant_id uuid references public.product_variants(id),
  product_name text not null,
  variant_description text not null,
  sku text not null,
  unit_price_cents bigint not null,
  quantity integer not null check (quantity > 0),
  line_total_cents bigint not null,
  commission_rate_bps integer not null,
  commission_cents bigint not null,
  vendor_net_cents bigint not null,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active','converted','released')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id),
  provider text not null default 'payfast',
  provider_reference text unique,
  amount_cents bigint not null,
  currency text not null default 'ZAR',
  status text not null default 'pending' check (status in ('pending','success','failed','partially_refunded','refunded','review')),
  provider_payload jsonb not null default '{}'::jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  vendor_order_id uuid not null unique references public.vendor_orders(id),
  provider text not null default 'bobgo',
  provider_shipment_id text unique,
  tracking_reference text,
  tracking_url text,
  courier_name text,
  service_name text,
  status text not null default 'quoted',
  cost_cents bigint,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  event_key text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now(),
  unique (provider, event_key)
);

-- ============================================================================
-- 05. RETURNS, NOTIFICATIONS AND SETTINGS
-- ============================================================================
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique,
  order_id uuid not null references public.orders(id),
  vendor_order_id uuid not null references public.vendor_orders(id),
  vendor_id uuid not null references public.vendors(id),
  customer_id uuid not null references public.profiles(id),
  reason text not null,
  customer_note text,
  status text not null default 'requested' check (status in ('requested','approved','declined','in_transit','received','refunded','closed')),
  refund_amount_cents bigint not null default 0,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.order_cancellation_requests (
  id uuid primary key default gen_random_uuid(),
  public_reference text not null unique,
  order_id uuid not null references public.orders(id),
  vendor_order_id uuid not null references public.vendor_orders(id),
  vendor_id uuid not null references public.vendors(id),
  customer_id uuid not null references public.profiles(id),
  reason text not null,
  status text not null default 'requested' check (status in ('requested','under_review','rejected','refunded')),
  refund_amount_cents bigint not null,
  provider_refund_reference text,
  requested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (vendor_order_id, customer_id, status)
);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'email',
  recipient_address text not null,
  template_key text not null,
  payload jsonb not null,
  dedupe_key text not null unique,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.marketplace_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 06. INDEXES
-- ============================================================================
create index if not exists products_vendor_status_idx on public.products(vendor_id, status);
create index if not exists variants_product_active_idx on public.product_variants(product_id, active);
create index if not exists orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index if not exists vendor_orders_vendor_created_idx on public.vendor_orders(vendor_id, created_at desc);
create index if not exists reservations_variant_status_idx on public.stock_reservations(variant_id, status, expires_at);
create index if not exists returns_vendor_status_idx on public.returns(vendor_id, status);
create index if not exists cancellations_vendor_status_idx on public.order_cancellation_requests(vendor_id, status);
create index if not exists outbox_status_attempt_idx on public.notification_outbox(status, next_attempt_at);

-- ============================================================================
-- 07. ACCOUNT AND AUDIT TRIGGERS
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, full_name, phone)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name',''), new.raw_user_meta_data ->> 'phone');
  insert into public.wishlists(customer_id) values (new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.limit_customer_addresses()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.addresses where customer_id = new.customer_id) >= 2 then
    raise exception 'A customer can save a maximum of two addresses';
  end if;
  if new.is_default then update public.addresses set is_default = false where customer_id = new.customer_id; end if;
  return new;
end;
$$;

drop trigger if exists addresses_limit_before_insert on public.addresses;
create trigger addresses_limit_before_insert before insert on public.addresses for each row execute function public.limit_customer_addresses();

-- ============================================================================
-- 08. AUTHORIZATION HELPERS
-- ============================================================================
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.platform_roles where user_id = auth.uid() and role in ('owner','admin'));
$$;

create or replace function public.is_vendor_member(p_vendor_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.vendor_members where vendor_id = p_vendor_id and user_id = auth.uid() and status = 'active');
$$;

create or replace function public.owns_order(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.orders where id=p_order_id and customer_id=auth.uid());
$$;

create or replace function public.is_order_vendor(p_order_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.vendor_orders where order_id=p_order_id and public.is_vendor_member(vendor_id));
$$;

-- ============================================================================
-- 09. READ VIEWS
-- ============================================================================
create or replace view public.product_catalog with (security_invoker = true) as
select p.id, p.vendor_id, p.slug, p.name, p.description, p.category, p.tone, p.is_rare,
       p.status, p.sales_count,
       coalesce(min(pv.price_cents),0)::bigint as price_cents,
       coalesce(sum(pv.stock_quantity) filter (where pv.active),0)::bigint as stock,
       coalesce(array_agg(distinct pv.size) filter (where pv.active), '{}'::text[]) as sizes,
       coalesce(array_agg(distinct pv.colour) filter (where pv.active), '{}'::text[]) as colours,
       min(pv.sku) filter (where pv.active) as sku,
       (array_agg(pm.public_url order by pm.sort_order) filter (where pm.public_url is not null))[1] as image_url
from public.products p
join public.vendors v on v.id = p.vendor_id and v.status = 'active'
left join public.product_variants pv on pv.product_id = p.id
left join public.product_media pm on pm.product_id = p.id
group by p.id;

create or replace view public.customer_order_summary with (security_invoker = true) as
select id, public_reference, customer_id, total_cents, status, created_at, paid_at
from public.orders;

-- ============================================================================
-- 10. CUSTOMER AND PORTAL FUNCTIONS
-- ============================================================================
create or replace function public.toggle_wishlist(p_product_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_wishlist_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  insert into public.wishlists(customer_id) values (auth.uid()) on conflict (customer_id) do nothing;
  select id into v_wishlist_id from public.wishlists where customer_id = auth.uid();
  if exists(select 1 from public.wishlist_items where wishlist_id = v_wishlist_id and product_id = p_product_id) then
    delete from public.wishlist_items where wishlist_id = v_wishlist_id and product_id = p_product_id;
    return false;
  end if;
  insert into public.wishlist_items(wishlist_id, product_id) values (v_wishlist_id, p_product_id);
  return true;
end;
$$;

create or replace function public.subscribe_newsletter(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_email is null or position('@' in p_email) < 2 then raise exception 'A valid email address is required'; end if;
  insert into public.newsletter_subscribers(email,status,consented_at,updated_at)
  values (lower(trim(p_email)),'subscribed',now(),now())
  on conflict (email) do update set status='subscribed',consented_at=now(),updated_at=now();
end;
$$;

create or replace function public.save_product(
  p_vendor_id uuid, p_name text, p_slug text, p_category text, p_description text,
  p_tone text, p_is_rare boolean, p_sku text, p_size text, p_colour text,
  p_price_cents bigint, p_stock_quantity integer, p_weight_kg numeric,
  p_length_cm numeric, p_width_cm numeric, p_height_cm numeric
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_product_id uuid;
begin
  if not (public.is_platform_admin() or public.is_vendor_member(p_vendor_id)) then raise exception 'Vendor access required'; end if;
  insert into public.products(vendor_id,name,slug,category,description,tone,is_rare,status)
  values (p_vendor_id,p_name,p_slug,p_category,p_description,p_tone,p_is_rare,'active') returning id into v_product_id;
  insert into public.product_variants(product_id,sku,size,colour,price_cents,stock_quantity,weight_kg,length_cm,width_cm,height_cm)
  values (v_product_id,p_sku,p_size,p_colour,p_price_cents,p_stock_quantity,p_weight_kg,p_length_cm,p_width_cm,p_height_cm);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id) values (auth.uid(),'create','product',v_product_id);
  return v_product_id;
end;
$$;

create or replace function public.move_vendor_order(p_vendor_order_id uuid, p_next_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order public.vendor_orders%rowtype; v_allowed text;
begin
  select * into strict v_order from public.vendor_orders where id = p_vendor_order_id for update;
  if not (public.is_platform_admin() or public.is_vendor_member(v_order.vendor_id)) then raise exception 'Vendor access required'; end if;
  v_allowed := case v_order.fulfilment_status when 'new' then 'accepted' when 'accepted' then 'packing' when 'packing' then 'packed' when 'packed' then 'ready_for_collection' else null end;
  if p_next_status is distinct from v_allowed then raise exception 'Invalid fulfilment transition'; end if;
  update public.vendor_orders set fulfilment_status = p_next_status, updated_at = now() where id = p_vendor_order_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail) values (auth.uid(),'status_change','vendor_order',p_vendor_order_id,jsonb_build_object('status',p_next_status));
end;
$$;

create or replace function public.admin_set_vendor_status(p_vendor_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_platform_admin() then raise exception 'Operator access required'; end if;
  if p_status not in ('pending','active','suspended') then raise exception 'Invalid store status'; end if;
  update public.vendors set status=p_status,updated_at=now() where id=p_vendor_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail) values(auth.uid(),'status_change','vendor',p_vendor_id,jsonb_build_object('status',p_status));
end;
$$;

create or replace function public.request_order_cancellation(p_vendor_order_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.vendor_orders%rowtype; v_customer uuid; v_id uuid := gen_random_uuid();
begin
  select * into strict v_order from public.vendor_orders where id=p_vendor_order_id;
  select customer_id into v_customer from public.orders where id=v_order.order_id;
  if v_customer<>auth.uid() then raise exception 'This package does not belong to your account'; end if;
  if v_order.fulfilment_status not in ('new','accepted') then raise exception 'This package has moved too far to cancel online'; end if;
  if exists(select 1 from public.order_cancellation_requests where vendor_order_id=p_vendor_order_id and status in ('requested','under_review')) then raise exception 'An open cancellation already exists'; end if;
  insert into public.order_cancellation_requests(id,public_reference,order_id,vendor_order_id,vendor_id,customer_id,reason,refund_amount_cents)
  values(v_id,'KC-'||upper(substr(replace(v_id::text,'-',''),1,10)),v_order.order_id,v_order.id,v_order.vendor_id,auth.uid(),trim(p_reason),v_order.merchandise_total_cents+v_order.shipping_charge_cents);
  return v_id;
end;
$$;

create or replace function public.request_return(p_vendor_order_id uuid, p_reason text, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_order public.vendor_orders%rowtype; v_customer uuid; v_id uuid := gen_random_uuid();
begin
  select * into strict v_order from public.vendor_orders where id=p_vendor_order_id;
  select customer_id into v_customer from public.orders where id=v_order.order_id;
  if v_customer<>auth.uid() then raise exception 'This package does not belong to your account'; end if;
  if v_order.fulfilment_status<>'delivered' then raise exception 'Only delivered packages can be returned'; end if;
  if exists(select 1 from public.returns where vendor_order_id=p_vendor_order_id and status not in ('declined','closed')) then raise exception 'An open return already exists'; end if;
  insert into public.returns(id,public_reference,order_id,vendor_order_id,vendor_id,customer_id,reason,customer_note,refund_amount_cents)
  values(v_id,'KR-'||upper(substr(replace(v_id::text,'-',''),1,10)),v_order.order_id,v_order.id,v_order.vendor_id,auth.uid(),trim(p_reason),nullif(trim(p_note),''),v_order.merchandise_total_cents);
  return v_id;
end;
$$;

create or replace function public.review_return(p_return_id uuid, p_next_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_return public.returns%rowtype; v_allowed boolean := false;
begin
  select * into strict v_return from public.returns where id=p_return_id for update;
  if not (public.is_platform_admin() or public.is_vendor_member(v_return.vendor_id)) then raise exception 'Store access required'; end if;
  v_allowed := (v_return.status='requested' and p_next_status in ('approved','declined'))
    or (v_return.status in ('approved','in_transit') and p_next_status='received')
    or (v_return.status='received' and p_next_status='refunded' and public.is_platform_admin());
  if not v_allowed then raise exception 'Invalid return transition'; end if;
  update public.returns set status=p_next_status,updated_at=now() where id=p_return_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,detail) values(auth.uid(),'status_change','return',p_return_id,jsonb_build_object('status',p_next_status));
end;
$$;

-- ============================================================================
-- 11. TRUSTED CHECKOUT FUNCTION — CALLED ONLY BY THE NETLIFY SERVER FUNCTION
-- ============================================================================
create or replace function public.create_checkout(
  p_customer_id uuid, p_lines jsonb, p_address jsonb, p_contact jsonb, p_quotes jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid := gen_random_uuid(); v_order_ref text := 'KN-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10));
  v_vendor record; v_line jsonb; v_product public.products%rowtype; v_variant public.product_variants%rowtype;
  v_vendor_order_id uuid; v_vendor_ref text; v_quote jsonb; v_qty integer; v_reserved integer;
  v_merch bigint := 0; v_shipping bigint := 0; v_vendor_merch bigint; v_vendor_commission bigint; v_vendor_shipping bigint;
  v_total bigint; v_expires timestamptz := now() + interval '15 minutes'; v_outside_count integer; v_private record;
  v_splits jsonb := '[]'::jsonb;
begin
  if p_customer_id is null or jsonb_array_length(p_lines) = 0 then raise exception 'Customer and cart are required'; end if;
  if not exists(select 1 from public.profiles where id = p_customer_id) then raise exception 'Customer profile not found'; end if;

  select count(distinct p.vendor_id) into v_outside_count
  from jsonb_array_elements(p_lines) line
  join public.products p on p.id = (line->>'productId')::uuid
  join public.vendors v on v.id = p.vendor_id
  where not v.is_platform_owned;
  if v_outside_count > 1 then raise exception 'PAYFAST_ONE_SPLIT_LIMIT'; end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    v_qty := (v_line->>'quantity')::integer;
    select p.* into strict v_product from public.products p where p.id = (v_line->>'productId')::uuid and p.status = 'active';
    select pv.* into strict v_variant from public.product_variants pv where pv.product_id = v_product.id and pv.size = v_line->>'size' and pv.colour = v_line->>'colour' and pv.active for update;
    select coalesce(sum(quantity),0) into v_reserved from public.stock_reservations where variant_id = v_variant.id and status = 'active' and expires_at > now();
    if v_qty < 1 or v_variant.stock_quantity - v_reserved < v_qty then raise exception 'Insufficient online stock for %', v_product.name; end if;
    v_merch := v_merch + v_variant.price_cents * v_qty;
  end loop;
  select coalesce(sum((quote->>'amountCents')::bigint),0) into v_shipping from jsonb_array_elements(p_quotes) quote;
  v_total := v_merch + v_shipping;

  insert into public.orders(id,public_reference,customer_id,customer_name,customer_email,customer_phone,delivery_address,merchandise_total_cents,shipping_total_cents,total_cents,reservation_expires_at)
  values (v_order_id,v_order_ref,p_customer_id,p_contact->>'fullName',p_contact->>'email',p_contact->>'phone',p_address,v_merch,v_shipping,v_total,v_expires);

  for v_vendor in
    select distinct v.* from jsonb_array_elements(p_lines) line join public.products p on p.id = (line->>'productId')::uuid join public.vendors v on v.id = p.vendor_id
  loop
    if v_vendor.status <> 'active' then raise exception 'Store is not accepting orders'; end if;
    select * into v_private from public.vendor_private_settings where vendor_id=v_vendor.id;
    if not v_vendor.is_platform_owned and (v_private.payfast_merchant_id is null or not v_private.payfast_split_approved) then raise exception 'Store payment split is not approved'; end if;
    select quote into v_quote from jsonb_array_elements(p_quotes) quote where quote->>'vendorId' = v_vendor.id::text limit 1;
    if v_quote is null then raise exception 'Delivery quote missing for %', v_vendor.business_name; end if;
    v_vendor_shipping := (v_quote->>'amountCents')::bigint;
    select sum(pv.price_cents * (line->>'quantity')::integer)::bigint into v_vendor_merch
    from jsonb_array_elements(p_lines) line join public.products p on p.id=(line->>'productId')::uuid join public.product_variants pv on pv.product_id=p.id and pv.size=line->>'size' and pv.colour=line->>'colour'
    where p.vendor_id=v_vendor.id;
    v_vendor_commission := round(v_vendor_merch * v_vendor.commission_rate_bps / 10000.0);
    v_vendor_ref := v_order_ref || '-' || upper(substr(replace(v_vendor.id::text,'-',''),1,3));
    insert into public.vendor_orders(order_id,vendor_id,public_reference,merchandise_total_cents,commission_total_cents,vendor_net_cents,shipping_charge_cents,shipping_quote)
    values (v_order_id,v_vendor.id,v_vendor_ref,v_vendor_merch,v_vendor_commission,v_vendor_merch-v_vendor_commission,v_vendor_shipping,v_quote)
    returning id into v_vendor_order_id;

    for v_line in select * from jsonb_array_elements(p_lines)
    loop
      select p.* into v_product from public.products p where p.id=(v_line->>'productId')::uuid and p.vendor_id=v_vendor.id;
      if found then
        v_qty := (v_line->>'quantity')::integer;
        select * into strict v_variant from public.product_variants where product_id=v_product.id and size=v_line->>'size' and colour=v_line->>'colour';
        insert into public.order_items(order_id,vendor_order_id,vendor_id,product_id,variant_id,product_name,variant_description,sku,unit_price_cents,quantity,line_total_cents,commission_rate_bps,commission_cents,vendor_net_cents)
        values (v_order_id,v_vendor_order_id,v_vendor.id,v_product.id,v_variant.id,v_product.name,v_variant.size||' / '||v_variant.colour,v_variant.sku,v_variant.price_cents,v_qty,v_variant.price_cents*v_qty,v_vendor.commission_rate_bps,round(v_variant.price_cents*v_qty*v_vendor.commission_rate_bps/10000.0),v_variant.price_cents*v_qty-round(v_variant.price_cents*v_qty*v_vendor.commission_rate_bps/10000.0));
        insert into public.stock_reservations(order_id,variant_id,quantity,expires_at) values (v_order_id,v_variant.id,v_qty,v_expires);
      end if;
    end loop;
    if not v_vendor.is_platform_owned then
      v_splits := v_splits || jsonb_build_array(jsonb_build_object('merchantId',v_private.payfast_merchant_id,'amountCents',v_vendor_merch-v_vendor_commission));
    end if;
  end loop;
  insert into public.payments(order_id,amount_cents) values (v_order_id,v_total);
  return jsonb_build_object('orderId',v_order_id,'publicReference',v_order_ref,'amountCents',v_total,'customerName',p_contact->>'fullName','customerEmail',p_contact->>'email','customerPhone',p_contact->>'phone','splits',v_splits,'expiresAt',v_expires);
end;
$$;

create or replace function public.finalize_payfast_payment(p_public_reference text, p_provider_reference text, p_amount_cents bigint, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_order public.orders%rowtype; v_reservation public.stock_reservations%rowtype; v_vo public.vendor_orders%rowtype;
begin
  select * into strict v_order from public.orders where public_reference=p_public_reference for update;
  if v_order.status in ('paid','processing','partially_shipped','shipped','delivered') then return jsonb_build_object('alreadyFinalized',true,'orderId',v_order.id); end if;
  if v_order.status<>'pending_payment' or v_order.reservation_expires_at<now() or not exists(select 1 from public.stock_reservations where order_id=v_order.id and status='active') then
    update public.orders set status='payment_review',updated_at=now() where id=v_order.id;
    update public.payments set status='review',provider_reference=p_provider_reference,provider_payload=p_payload,updated_at=now() where order_id=v_order.id;
    return jsonb_build_object('alreadyFinalized',false,'paymentReview',true,'orderId',v_order.id);
  end if;
  if v_order.total_cents <> p_amount_cents then
    update public.orders set status='payment_review',updated_at=now() where id=v_order.id;
    update public.payments set status='review',provider_reference=p_provider_reference,provider_payload=p_payload,updated_at=now() where order_id=v_order.id;
    raise exception 'Payment amount mismatch';
  end if;
  if exists(select 1 from public.stock_reservations sr join public.product_variants pv on pv.id=sr.variant_id where sr.order_id=v_order.id and sr.status='active' and pv.stock_quantity<sr.quantity) then
    update public.orders set status='payment_review',updated_at=now() where id=v_order.id;
    update public.payments set status='review',provider_reference=p_provider_reference,provider_payload=p_payload,updated_at=now() where order_id=v_order.id;
    return jsonb_build_object('alreadyFinalized',false,'paymentReview',true,'orderId',v_order.id);
  end if;
  for v_reservation in select * from public.stock_reservations where order_id=v_order.id and status='active' for update
  loop
    if v_reservation.expires_at < now() then raise exception 'Stock reservation expired'; end if;
    update public.product_variants set stock_quantity=stock_quantity-v_reservation.quantity,updated_at=now() where id=v_reservation.variant_id and stock_quantity>=v_reservation.quantity;
    if not found then raise exception 'Stock no longer available'; end if;
    update public.stock_reservations set status='converted' where id=v_reservation.id;
    insert into public.inventory_movements(variant_id,quantity_delta,reason,reference_type,reference_id) values(v_reservation.variant_id,-v_reservation.quantity,'sale','order',v_order.id);
  end loop;
  update public.orders set status='paid',paid_at=now(),updated_at=now() where id=v_order.id;
  update public.vendor_orders set fulfilment_status='new',fulfilment_due_at=now()+interval '24 hours',updated_at=now() where order_id=v_order.id;
  update public.payments set status='success',provider_reference=p_provider_reference,provider_payload=p_payload,paid_at=now(),updated_at=now() where order_id=v_order.id;
  update public.products p set sales_count=p.sales_count+x.qty from (select product_id,sum(quantity)::bigint qty from public.order_items where order_id=v_order.id group by product_id) x where p.id=x.product_id;
  update public.vendors v set sales_count=v.sales_count+x.qty from (select vendor_id,sum(quantity)::bigint qty from public.order_items where order_id=v_order.id group by vendor_id) x where v.id=x.vendor_id;
  for v_vo in select * from public.vendor_orders where order_id=v_order.id loop
    insert into public.notification_outbox(recipient_address,template_key,payload,dedupe_key)
    select contact_email,'vendor_new_order',jsonb_build_object('reference',v_vo.public_reference),'vendor-order:'||v_vo.id from public.vendor_private_settings where vendor_id=v_vo.vendor_id and contact_email is not null;
  end loop;
  insert into public.notification_outbox(recipient_address,template_key,payload,dedupe_key) values(v_order.customer_email,'customer_payment_confirmed',jsonb_build_object('reference',v_order.public_reference),'customer-payment:'||v_order.id);
  return jsonb_build_object('alreadyFinalized',false,'orderId',v_order.id);
end;
$$;

create or replace function public.release_expired_reservations()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  with released as (update public.stock_reservations set status='released' where status='active' and expires_at<now() returning order_id)
  select count(*) into v_count from released;
  update public.orders set status='cancelled',updated_at=now() where status='pending_payment' and reservation_expires_at<now();
  return v_count;
end;
$$;

-- ============================================================================
-- 12. ROW-LEVEL SECURITY
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.platform_roles enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_members enable row level security;
alter table public.vendor_private_settings enable row level security;
alter table public.products enable row level security;
alter table public.product_variants enable row level security;
alter table public.product_media enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.addresses enable row level security;
alter table public.wishlists enable row level security;
alter table public.wishlist_items enable row level security;
alter table public.newsletter_subscribers enable row level security;
alter table public.orders enable row level security;
alter table public.vendor_orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_reservations enable row level security;
alter table public.payments enable row level security;
alter table public.shipments enable row level security;
alter table public.webhook_events enable row level security;
alter table public.returns enable row level security;
alter table public.order_cancellation_requests enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.marketplace_settings enable row level security;
alter table public.audit_logs enable row level security;

create policy profiles_own_admin_or_fulfiller_select on public.profiles for select to authenticated using (id=auth.uid() or public.is_platform_admin() or exists(select 1 from public.returns r where r.customer_id=profiles.id and public.is_vendor_member(r.vendor_id)));
create policy profiles_own_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy roles_own_or_admin_select on public.platform_roles for select to authenticated using (user_id=auth.uid() or public.is_platform_admin());
create policy roles_admin_write on public.platform_roles for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy vendors_public_select on public.vendors for select using (status='active' or public.is_platform_admin() or public.is_vendor_member(id));
create policy vendors_admin_insert on public.vendors for insert to authenticated with check (public.is_platform_admin());
create policy vendors_admin_or_member_update on public.vendors for update to authenticated using (public.is_platform_admin() or public.is_vendor_member(id)) with check (public.is_platform_admin() or public.is_vendor_member(id));
create policy members_own_or_admin_select on public.vendor_members for select to authenticated using (user_id=auth.uid() or public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy members_admin_write on public.vendor_members for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy vendor_private_authorized_select on public.vendor_private_settings for select to authenticated using (public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy vendor_private_admin_insert on public.vendor_private_settings for insert to authenticated with check (public.is_platform_admin());
create policy vendor_private_authorized_update on public.vendor_private_settings for update to authenticated using (public.is_platform_admin() or public.is_vendor_member(vendor_id)) with check (public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy products_public_select on public.products for select using (status='active' or public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy products_member_write on public.products for all to authenticated using (public.is_platform_admin() or public.is_vendor_member(vendor_id)) with check (public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy variants_public_select on public.product_variants for select using (active and exists(select 1 from public.products p where p.id=product_id and p.status='active') or public.is_platform_admin() or exists(select 1 from public.products p where p.id=product_id and public.is_vendor_member(p.vendor_id)));
create policy variants_member_write on public.product_variants for all to authenticated using (public.is_platform_admin() or exists(select 1 from public.products p where p.id=product_id and public.is_vendor_member(p.vendor_id))) with check (public.is_platform_admin() or exists(select 1 from public.products p where p.id=product_id and public.is_vendor_member(p.vendor_id)));
create policy media_public_select on public.product_media for select using (true);
create policy media_member_write on public.product_media for all to authenticated using (public.is_platform_admin() or exists(select 1 from public.products p where p.id=product_id and public.is_vendor_member(p.vendor_id))) with check (public.is_platform_admin() or exists(select 1 from public.products p where p.id=product_id and public.is_vendor_member(p.vendor_id)));
create policy inventory_member_select on public.inventory_movements for select to authenticated using (public.is_platform_admin() or exists(select 1 from public.product_variants pv join public.products p on p.id=pv.product_id where pv.id=variant_id and public.is_vendor_member(p.vendor_id)));
create policy addresses_owner_all on public.addresses for all to authenticated using (customer_id=auth.uid()) with check (customer_id=auth.uid());
create policy wishlists_owner_all on public.wishlists for all to authenticated using (customer_id=auth.uid()) with check (customer_id=auth.uid());
create policy wishlist_items_owner_all on public.wishlist_items for all to authenticated using (exists(select 1 from public.wishlists w where w.id=wishlist_id and w.customer_id=auth.uid())) with check (exists(select 1 from public.wishlists w where w.id=wishlist_id and w.customer_id=auth.uid()));
create policy newsletter_admin_select on public.newsletter_subscribers for select to authenticated using (public.is_platform_admin());
create policy orders_authorized_select on public.orders for select to authenticated using (customer_id=auth.uid() or public.is_platform_admin() or public.is_order_vendor(id));
create policy vendor_orders_authorized_select on public.vendor_orders for select to authenticated using (public.is_platform_admin() or public.is_vendor_member(vendor_id) or public.owns_order(order_id));
create policy items_authorized_select on public.order_items for select to authenticated using (public.is_platform_admin() or public.is_vendor_member(vendor_id) or public.owns_order(order_id));
create policy payments_customer_or_admin_select on public.payments for select to authenticated using (public.is_platform_admin() or public.owns_order(order_id));
create policy shipments_authorized_select on public.shipments for select to authenticated using (public.is_platform_admin() or exists(select 1 from public.vendor_orders vo where vo.id=vendor_order_id and (public.is_vendor_member(vo.vendor_id) or exists(select 1 from public.orders o where o.id=vo.order_id and o.customer_id=auth.uid()))));
create policy returns_authorized_select on public.returns for select to authenticated using (customer_id=auth.uid() or public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy returns_customer_insert on public.returns for insert to authenticated with check (customer_id=auth.uid() and exists(select 1 from public.orders o where o.id=order_id and o.customer_id=auth.uid()));
create policy returns_admin_or_vendor_update on public.returns for update to authenticated using (public.is_platform_admin() or public.is_vendor_member(vendor_id)) with check (public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy cancellations_authorized_select on public.order_cancellation_requests for select to authenticated using (customer_id=auth.uid() or public.is_platform_admin() or public.is_vendor_member(vendor_id));
create policy cancellations_admin_update on public.order_cancellation_requests for update to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy settings_authenticated_select on public.marketplace_settings for select to authenticated using (true);
create policy settings_admin_write on public.marketplace_settings for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin());
create policy audit_admin_select on public.audit_logs for select to authenticated using (public.is_platform_admin());

-- ============================================================================
-- 13. PRIVILEGES
-- ============================================================================
revoke all on function public.create_checkout(uuid,jsonb,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_payfast_payment(text,text,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.release_expired_reservations() from public, anon, authenticated;
grant execute on function public.create_checkout(uuid,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.finalize_payfast_payment(text,text,bigint,jsonb) to service_role;
grant execute on function public.release_expired_reservations() to service_role;
grant execute on function public.toggle_wishlist(uuid), public.save_product(uuid,text,text,text,text,text,boolean,text,text,text,bigint,integer,numeric,numeric,numeric,numeric), public.move_vendor_order(uuid,text), public.admin_set_vendor_status(uuid,text), public.request_order_cancellation(uuid,text), public.request_return(uuid,text,text), public.review_return(uuid,text) to authenticated;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;
grant select on public.product_catalog to anon, authenticated;
grant select on public.customer_order_summary to authenticated;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.vendors, public.products, public.product_variants, public.product_media, public.product_catalog to anon;
grant select, insert, update, delete on public.profiles, public.platform_roles, public.vendors, public.vendor_members, public.vendor_private_settings, public.products, public.product_variants, public.product_media, public.inventory_movements, public.addresses, public.wishlists, public.wishlist_items, public.orders, public.vendor_orders, public.order_items, public.payments, public.shipments, public.returns, public.order_cancellation_requests, public.marketplace_settings, public.audit_logs to authenticated;
grant select on public.customer_order_summary to authenticated;

-- Column grants keep vendor members away from commission, status and PayFast approval fields.
revoke update on public.vendors from authenticated;
grant update (business_name,description,short_description,mark,accent) on public.vendors to authenticated;
revoke update on public.vendor_private_settings from authenticated;
grant update (contact_email,contact_phone,collection_street_address,collection_local_area,collection_city,collection_province,collection_postal_code,collection_country_code) on public.vendor_private_settings to authenticated;
revoke update on public.returns from authenticated;

-- Product images use a public bucket; write permission still follows vendor membership.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy product_images_public_read on storage.objects for select using (bucket_id='product-images');
create policy product_images_vendor_insert on storage.objects for insert to authenticated with check (
  bucket_id='product-images' and (
    public.is_platform_admin() or public.is_vendor_member(((storage.foldername(name))[1])::uuid)
  )
);
create policy product_images_vendor_update on storage.objects for update to authenticated using (
  bucket_id='product-images' and (public.is_platform_admin() or public.is_vendor_member(((storage.foldername(name))[1])::uuid))
) with check (
  bucket_id='product-images' and (public.is_platform_admin() or public.is_vendor_member(((storage.foldername(name))[1])::uuid))
);
create policy product_images_vendor_delete on storage.objects for delete to authenticated using (
  bucket_id='product-images' and (public.is_platform_admin() or public.is_vendor_member(((storage.foldername(name))[1])::uuid))
);

insert into public.marketplace_settings(key,value) values
('default_commission_rate_bps','1000'::jsonb),
('stock_reservation_minutes','15'::jsonb),
('fulfilment_reminder_hours','24'::jsonb),
('fulfilment_escalation_hours','72'::jsonb),
('automatic_homepage_ranking','true'::jsonb)
on conflict (key) do nothing;
