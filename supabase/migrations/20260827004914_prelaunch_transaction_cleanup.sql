begin;

-- This cleanup was applied remotely before the first production sale.
-- It intentionally preserves accounts, stores, catalogue, settings, and
-- payment configuration while removing pre-launch transaction test data.
do $cleanup$
declare
  table_name text;
  cleanup_tables text[] := array[
    'return_payments',
    'return_shipments',
    'returns',
    'vendor_liability_recoveries',
    'vendor_liabilities',
    'shipments',
    'stock_reservations',
    'payments',
    'order_items',
    'vendor_orders',
    'terms_acceptances',
    'orders'
  ];
begin
  foreach table_name in array cleanup_tables
  loop
    if to_regclass(format('public.%I', table_name)) is not null then
      raise notice 'Cleaning public.%', table_name;
      execute format(
        'truncate table public.%I restart identity cascade',
        table_name
      );
    end if;
  end loop;
end
$cleanup$;

commit;
