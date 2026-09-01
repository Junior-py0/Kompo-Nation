-- MANUAL PLATFORM-COLLECTION SETTLEMENT LEDGER V1
begin;

alter table public.return_payments
  add column if not exists provider_request_id text;

create unique index if not exists return_payments_provider_request_uidx
  on public.return_payments(provider, provider_request_id)
  where provider_request_id is not null;

create table if not exists public.vendor_payouts(
  id uuid primary key default gen_random_uuid(),
  vendor_order_id uuid not null unique references public.vendor_orders(id),
  order_id uuid not null references public.orders(id),
  vendor_id uuid not null references public.vendors(id),
  payment_provider text not null check(payment_provider in('stitch','yoco')),
  gross_amount_cents bigint not null check(gross_amount_cents>=0),
  liability_deduction_cents bigint not null default 0 check(liability_deduction_cents>=0),
  paid_amount_cents bigint not null check(paid_amount_cents>=0),
  payout_reference text not null,
  note text,
  paid_at timestamptz not null default now(),
  paid_by uuid not null,
  created_at timestamptz not null default now(),
  check(paid_amount_cents + liability_deduction_cents = gross_amount_cents)
);

create index if not exists vendor_payouts_vendor_paid_idx
  on public.vendor_payouts(vendor_id,paid_at desc);

create table if not exists public.courier_settlements(
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid unique references public.shipments(id),
  return_shipment_id uuid unique references public.return_shipments(id),
  provider text not null,
  amount_cents bigint not null check(amount_cents>=0),
  settlement_reference text not null,
  note text,
  paid_at timestamptz not null default now(),
  paid_by uuid not null,
  created_at timestamptz not null default now(),
  check(num_nonnulls(shipment_id,return_shipment_id)=1)
);

create index if not exists courier_settlements_paid_idx
  on public.courier_settlements(paid_at desc);

alter table public.vendor_payouts enable row level security;
alter table public.courier_settlements enable row level security;

drop policy if exists vendor_payouts_admin_select on public.vendor_payouts;
create policy vendor_payouts_admin_select
  on public.vendor_payouts for select to authenticated
  using(public.is_platform_admin());

drop policy if exists courier_settlements_admin_select on public.courier_settlements;
create policy courier_settlements_admin_select
  on public.courier_settlements for select to authenticated
  using(public.is_platform_admin());

revoke insert,update,delete on public.vendor_payouts,public.courier_settlements
  from anon,authenticated;
grant select on public.vendor_payouts,public.courier_settlements
  to authenticated;


create or replace function public.admin_settlement_dashboard()
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_store_pending jsonb;
  v_store_paid jsonb;
  v_courier_pending jsonb;
  v_courier_paid jsonb;
  v_store_due bigint;
  v_courier_due bigint;
  v_shipping_collected bigint;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform administrator access required.';
  end if;

  with liability as(
    select vendor_id,
      coalesce(sum(greatest(0,amount_cents-recovered_cents)),0)::bigint outstanding
    from public.vendor_liabilities
    where status in('open','partial') and recovered_cents<amount_cents
    group by vendor_id
  ), base as(
    select vo.id vendor_order_id,vo.order_id,vo.vendor_id,vo.public_reference,
      vo.vendor_net_cents gross_cents,vo.fulfilment_status,vo.created_at,v.business_name,p.provider,
      coalesce(l.outstanding,0)::bigint liability_cents
    from public.vendor_orders vo
    join public.vendors v on v.id=vo.vendor_id and not v.is_platform_owned
    join public.payments p on p.order_id=vo.order_id
    left join public.vendor_payouts vp on vp.vendor_order_id=vo.id
    left join liability l on l.vendor_id=vo.vendor_id
    where p.status='success' and p.provider in('stitch','yoco') and vp.id is null
  ), ranked as(
    select b.*,
      coalesce(sum(gross_cents) over(
        partition by vendor_id order by created_at,vendor_order_id
        rows between unbounded preceding and 1 preceding
      ),0)::bigint prior_gross_cents
    from base b
  ), calculated as(
    select r.*,
      least(gross_cents,greatest(0,liability_cents-prior_gross_cents))::bigint
        liability_deduction_cents
    from ranked r
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'vendorOrderId',vendor_order_id,
    'orderId',order_id,
    'reference',public_reference,
    'vendorId',vendor_id,
    'storeName',business_name,
    'provider',provider,
    'fulfilmentStatus',fulfilment_status,
    'grossCents',gross_cents,
    'liabilityDeductionCents',liability_deduction_cents,
    'dueCents',gross_cents-liability_deduction_cents,
    'createdAt',created_at
  ) order by created_at),'[]'::jsonb)
  into v_store_pending
  from calculated;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',vp.id,
    'reference',vo.public_reference,
    'storeName',v.business_name,
    'provider',vp.payment_provider,
    'grossCents',vp.gross_amount_cents,
    'liabilityDeductionCents',vp.liability_deduction_cents,
    'paidCents',vp.paid_amount_cents,
    'payoutReference',vp.payout_reference,
    'note',vp.note,
    'paidAt',vp.paid_at
  ) order by vp.paid_at desc),'[]'::jsonb)
  into v_store_paid
  from(
    select * from public.vendor_payouts order by paid_at desc limit 100
  )vp
  join public.vendor_orders vo on vo.id=vp.vendor_order_id
  join public.vendors v on v.id=vp.vendor_id;

  with charges as(
    select 'order'::text kind,s.id shipment_id,vo.public_reference reference,
      v.business_name store_name,s.provider,s.courier_name,
      coalesce(s.cost_cents,0)::bigint due_cents,
      coalesce(vo.shipping_charge_cents,0)::bigint collected_cents,s.created_at
    from public.shipments s
    join public.vendor_orders vo on vo.id=s.vendor_order_id
    join public.vendors v on v.id=vo.vendor_id
    left join public.courier_settlements cs on cs.shipment_id=s.id
    where s.provider_shipment_id is not null and coalesce(s.cost_cents,0)>0
      and cs.id is null
    union all
    select 'return'::text kind,rs.id shipment_id,r.public_reference reference,
      v.business_name store_name,rs.provider,rs.courier_name,
      coalesce(rs.courier_cost_cents,0)::bigint due_cents,
      case when rs.payer='customer' then coalesce(rs.total_charge_cents,0) else 0 end::bigint,
      rs.created_at
    from public.return_shipments rs
    join public.returns r on r.id=rs.return_id
    join public.vendors v on v.id=rs.vendor_id
    left join public.courier_settlements cs on cs.return_shipment_id=rs.id
    where rs.provider_shipment_id is not null and coalesce(rs.courier_cost_cents,0)>0
      and cs.id is null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind',kind,
    'shipmentId',shipment_id,
    'reference',reference,
    'storeName',store_name,
    'provider',provider,
    'courierName',courier_name,
    'dueCents',due_cents,
    'collectedCents',collected_cents,
    'marginCents',collected_cents-due_cents,
    'createdAt',created_at
  ) order by created_at),'[]'::jsonb)
  into v_courier_pending
  from charges;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',cs.id,
    'kind',case when cs.shipment_id is not null then 'order' else 'return' end,
    'provider',cs.provider,
    'paidCents',cs.amount_cents,
    'settlementReference',cs.settlement_reference,
    'note',cs.note,
    'paidAt',cs.paid_at
  ) order by cs.paid_at desc),'[]'::jsonb)
  into v_courier_paid
  from(
    select * from public.courier_settlements order by paid_at desc limit 100
  )cs;

  select coalesce(sum((item->>'dueCents')::bigint),0)
    into v_store_due from jsonb_array_elements(v_store_pending) item;
  select coalesce(sum((item->>'dueCents')::bigint),0),
         coalesce(sum((item->>'collectedCents')::bigint),0)
    into v_courier_due,v_shipping_collected
    from jsonb_array_elements(v_courier_pending) item;

  return jsonb_build_object(
    'summary',jsonb_build_object(
      'storeDueCents',v_store_due,
      'courierDueCents',v_courier_due,
      'shippingCollectedCents',v_shipping_collected,
      'shippingMarginCents',v_shipping_collected-v_courier_due
    ),
    'storePayouts',v_store_pending,
    'recentStorePayouts',v_store_paid,
    'courierCharges',v_courier_pending,
    'recentCourierSettlements',v_courier_paid
  );
end;
$function$;


create or replace function public.admin_mark_vendor_order_paid(
  p_vendor_order_id uuid,
  p_reference text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_vo public.vendor_orders%rowtype;
  v_payment public.payments%rowtype;
  v_existing public.vendor_payouts%rowtype;
  v_liability public.vendor_liabilities%rowtype;
  v_gross bigint;
  v_remaining bigint;
  v_deduction bigint:=0;
  v_take bigint;
  v_reference text:=nullif(trim(coalesce(p_reference,'')),'');
  v_id uuid;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform administrator access required.';
  end if;

  select * into v_vo from public.vendor_orders
    where id=p_vendor_order_id for update;
  if v_vo.id is null then raise exception 'Store package not found.'; end if;
  if exists(select 1 from public.vendors where id=v_vo.vendor_id and is_platform_owned) then
    raise exception 'Platform-owned store packages do not need a vendor payout.';
  end if;

  select * into v_payment from public.payments
    where order_id=v_vo.order_id for update;
  if v_payment.id is null or v_payment.status<>'success'
     or v_payment.provider not in('stitch','yoco') then
    raise exception 'Only successful platform-collected payments can be paid manually.';
  end if;

  select * into v_existing from public.vendor_payouts
    where vendor_order_id=v_vo.id;
  if v_existing.id is not null then
    return jsonb_build_object('alreadyPaid',true,'payoutId',v_existing.id);
  end if;

  v_gross:=greatest(0,v_vo.vendor_net_cents);
  v_remaining:=v_gross;

  for v_liability in
    select * from public.vendor_liabilities
    where vendor_id=v_vo.vendor_id and status in('open','partial')
      and recovered_cents<amount_cents
    order by created_at,id for update
  loop
    exit when v_remaining<=0;
    v_take:=least(v_remaining,v_liability.amount_cents-v_liability.recovered_cents);
    if v_take<=0 then continue; end if;

    update public.vendor_liabilities
      set recovered_cents=recovered_cents+v_take,
          status=case when recovered_cents+v_take>=amount_cents then 'recovered' else 'partial' end,
          updated_at=now()
      where id=v_liability.id;

    insert into public.vendor_liability_recoveries(
      liability_id,vendor_id,order_id,vendor_order_id,amount_cents,status,
      expires_at,created_at,settled_at
    ) values(
      v_liability.id,v_vo.vendor_id,v_vo.order_id,v_vo.id,v_take,'settled',
      now(),now(),now()
    )
    on conflict(liability_id,order_id) do update
      set amount_cents=excluded.amount_cents,status='settled',
          expires_at=now(),settled_at=now();

    v_remaining:=v_remaining-v_take;
    v_deduction:=v_deduction+v_take;
  end loop;

  if v_reference is null then
    if v_remaining=0 then v_reference:='LIABILITY-OFFSET';
    else raise exception 'Enter the bank or payout reference.';
    end if;
  end if;

  insert into public.vendor_payouts(
    vendor_order_id,order_id,vendor_id,payment_provider,
    gross_amount_cents,liability_deduction_cents,paid_amount_cents,
    payout_reference,note,paid_by
  ) values(
    v_vo.id,v_vo.order_id,v_vo.vendor_id,v_payment.provider,
    v_gross,v_deduction,v_remaining,v_reference,nullif(trim(coalesce(p_note,'')),''),auth.uid()
  ) returning id into v_id;

  return jsonb_build_object(
    'alreadyPaid',false,'payoutId',v_id,'grossCents',v_gross,
    'liabilityDeductionCents',v_deduction,'paidCents',v_remaining
  );
end;
$function$;


create or replace function public.admin_mark_courier_paid(
  p_kind text,
  p_shipment_id uuid,
  p_reference text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  v_reference text:=nullif(trim(coalesce(p_reference,'')),'');
  v_provider text;
  v_amount bigint;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform administrator access required.';
  end if;
  if p_kind not in('order','return') then raise exception 'Invalid courier charge type.'; end if;
  if v_reference is null then raise exception 'Enter the Bob Go invoice, wallet, or payment reference.'; end if;

  if p_kind='order' then
    if exists(select 1 from public.courier_settlements where shipment_id=p_shipment_id) then
      return jsonb_build_object('alreadyPaid',true);
    end if;
    select provider,coalesce(cost_cents,0) into v_provider,v_amount
      from public.shipments where id=p_shipment_id and provider_shipment_id is not null for update;
    if v_provider is null or v_amount<=0 then raise exception 'Booked courier charge not found.'; end if;
    insert into public.courier_settlements(
      shipment_id,provider,amount_cents,settlement_reference,note,paid_by
    ) values(
      p_shipment_id,v_provider,v_amount,v_reference,nullif(trim(coalesce(p_note,'')),''),auth.uid()
    ) returning id into v_id;
  else
    if exists(select 1 from public.courier_settlements where return_shipment_id=p_shipment_id) then
      return jsonb_build_object('alreadyPaid',true);
    end if;
    select provider,coalesce(courier_cost_cents,0) into v_provider,v_amount
      from public.return_shipments where id=p_shipment_id and provider_shipment_id is not null for update;
    if v_provider is null or v_amount<=0 then raise exception 'Booked return courier charge not found.'; end if;
    insert into public.courier_settlements(
      return_shipment_id,provider,amount_cents,settlement_reference,note,paid_by
    ) values(
      p_shipment_id,v_provider,v_amount,v_reference,nullif(trim(coalesce(p_note,'')),''),auth.uid()
    ) returning id into v_id;
  end if;

  return jsonb_build_object('alreadyPaid',false,'settlementId',v_id,'paidCents',v_amount);
end;
$function$;

revoke all on function public.admin_settlement_dashboard() from public;
revoke all on function public.admin_mark_vendor_order_paid(uuid,text,text) from public;
revoke all on function public.admin_mark_courier_paid(text,uuid,text,text) from public;
grant execute on function public.admin_settlement_dashboard() to authenticated;
grant execute on function public.admin_mark_vendor_order_paid(uuid,text,text) to authenticated;
grant execute on function public.admin_mark_courier_paid(text,uuid,text,text) to authenticated;

commit;
