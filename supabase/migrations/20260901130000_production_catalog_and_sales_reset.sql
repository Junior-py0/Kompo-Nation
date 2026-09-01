begin;

-- One-time production reset requested before the first real catalogue launch.
-- Preserve identities, profiles, roles, vendors, memberships, private vendor
-- settings, customer addresses, newsletter subscribers, and marketplace config.
do $reset$
declare
  v_profiles_before bigint;
  v_addresses_before bigint;
  v_vendors_before bigint;
  v_table text;
  v_count bigint;
  v_cleanup_tables text[] := array[
    'courier_settlements',
    'vendor_payouts',
    'return_payments',
    'return_shipments',
    'returns',
    'order_cancellation_requests',
    'vendor_liability_recoveries',
    'vendor_liabilities',
    'shipments',
    'stock_reservations',
    'payments',
    'order_items',
    'vendor_orders',
    'terms_acceptances',
    'orders',
    'wishlist_items',
    'inventory_movements',
    'product_media',
    'product_variants',
    'products',
    'notification_outbox',
    'webhook_events',
    'audit_logs'
  ];
begin
  perform pg_advisory_xact_lock(hashtextextended('kompo-production-reset', 0));

  select count(*) into v_profiles_before from public.profiles;
  select count(*) into v_addresses_before from public.addresses;
  select count(*) into v_vendors_before from public.vendors;

  foreach v_table in array v_cleanup_tables loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    raise notice 'Resetting public.% (% rows)', v_table, v_count;
  end loop;

  truncate table
    public.courier_settlements,
    public.vendor_payouts,
    public.return_payments,
    public.return_shipments,
    public.returns,
    public.order_cancellation_requests,
    public.vendor_liability_recoveries,
    public.vendor_liabilities,
    public.shipments,
    public.stock_reservations,
    public.payments,
    public.order_items,
    public.vendor_orders,
    public.terms_acceptances,
    public.orders,
    public.wishlist_items,
    public.inventory_movements,
    public.product_media,
    public.product_variants,
    public.products,
    public.notification_outbox,
    public.webhook_events,
    public.audit_logs
  restart identity cascade;

  update public.vendors
  set sales_count = 0,
      updated_at = now()
  where sales_count <> 0;

  foreach v_table in array v_cleanup_tables loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    if v_count <> 0 then
      raise exception 'Production reset failed: public.% still has % rows',
        v_table,
        v_count;
    end if;
  end loop;

  if (select count(*) from public.profiles) <> v_profiles_before then
    raise exception 'Production reset changed profile records';
  end if;
  if (select count(*) from public.addresses) <> v_addresses_before then
    raise exception 'Production reset changed saved address records';
  end if;
  if (select count(*) from public.vendors) <> v_vendors_before then
    raise exception 'Production reset changed vendor/store records';
  end if;
end
$reset$;

commit;
