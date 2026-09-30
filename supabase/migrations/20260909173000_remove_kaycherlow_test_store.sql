begin;

-- Kaycherlow Moments reused the original BARAX test-store record. It never
-- received products, orders or financial activity, so remove the store and
-- its vendor-only configuration without touching the owner's Kompo account.
do $cleanup$
declare
  v_vendor_id constant uuid := '10000000-0000-4000-8000-000000000001';
  v_name text;
begin
  select business_name into v_name
  from public.vendors
  where id = v_vendor_id;

  if v_name is null then
    return;
  end if;

  if lower(trim(v_name)) not in ('kaycherlow moments', 'barax') then
    raise exception 'Test-store cleanup stopped: vendor % is now named %',
      v_vendor_id, v_name;
  end if;

  if exists (select 1 from public.products where vendor_id = v_vendor_id)
     or exists (select 1 from public.vendor_orders where vendor_id = v_vendor_id)
     or exists (select 1 from public.order_items where vendor_id = v_vendor_id)
     or exists (select 1 from public.returns where vendor_id = v_vendor_id)
     or exists (select 1 from public.order_cancellation_requests where vendor_id = v_vendor_id)
     or exists (select 1 from public.vendor_payouts where vendor_id = v_vendor_id)
     or exists (select 1 from public.vendor_liabilities where vendor_id = v_vendor_id)
     or exists (select 1 from public.vendor_liability_recoveries where vendor_id = v_vendor_id)
     or exists (select 1 from public.discount_redemptions where vendor_id = v_vendor_id) then
    raise exception 'Test-store cleanup stopped: Kaycherlow Moments has transactional history';
  end if;

  delete from public.audit_logs
  where entity_type = 'vendor' and entity_id = v_vendor_id;

  delete from public.vendors where id = v_vendor_id;
end
$cleanup$;

commit;
