-- KOMPO NATION RETURN LOGISTICS V1
begin;

alter table public.returns add column if not exists resolution_type text not null default 'refund';
alter table public.returns add column if not exists reason_code text;
alter table public.returns add column if not exists claimed_responsibility text not null default 'undetermined';
alter table public.returns add column if not exists responsibility text not null default 'undetermined';
alter table public.returns add column if not exists decision_note text;
alter table public.returns add column if not exists exchange_note text;
alter table public.returns add column if not exists approved_at timestamptz;
alter table public.returns add column if not exists received_at timestamptz;
alter table public.returns add column if not exists completed_at timestamptz;

alter table public.returns drop constraint if exists returns_resolution_type_check;
alter table public.returns add constraint returns_resolution_type_check check(resolution_type in('refund','exchange'));
alter table public.returns drop constraint if exists returns_claimed_responsibility_check;
alter table public.returns add constraint returns_claimed_responsibility_check check(claimed_responsibility in('customer','vendor','undetermined'));
alter table public.returns drop constraint if exists returns_responsibility_check;
alter table public.returns add constraint returns_responsibility_check check(responsibility in('undetermined','customer','vendor','kompo'));
alter table public.returns drop constraint if exists returns_status_check;
alter table public.returns add constraint returns_status_check check(status in('requested','under_review','approved','declined','in_transit','received','refunded','closed'));

create table if not exists public.return_shipments(
 id uuid primary key default gen_random_uuid(),
 return_id uuid not null references public.returns(id) on delete cascade,
 vendor_id uuid not null references public.vendors(id),
 leg text not null check(leg in('reverse','exchange_outbound')),
 payer text not null check(payer in('customer','vendor','kompo')),
 status text not null default 'awaiting_quote' check(status in('awaiting_quote','awaiting_payment','ready_to_book','booked','in_transit','delivered','failed','cancelled')),
 collection_address jsonb not null default '{}'::jsonb,
 delivery_address jsonb not null default '{}'::jsonb,
 collection_contact jsonb not null default '{}'::jsonb,
 delivery_contact jsonb not null default '{}'::jsonb,
 parcels jsonb not null default '[]'::jsonb,
 rate_id text, service_level_code text, provider_slug text, courier_name text, service_name text,
 courier_cost_cents bigint check(courier_cost_cents is null or courier_cost_cents>=0),
 logistics_fee_cents bigint check(logistics_fee_cents is null or logistics_fee_cents>=0),
 total_charge_cents bigint check(total_charge_cents is null or total_charge_cents>=0),
 quoted_at timestamptz, quote_expires_at timestamptz,
 provider text not null default 'bobgo', provider_shipment_id text unique,
 tracking_reference text, tracking_url text, provider_payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(return_id,leg)
);
create index if not exists return_shipments_return_idx on public.return_shipments(return_id);
create index if not exists return_shipments_vendor_idx on public.return_shipments(vendor_id);

create table if not exists public.return_payments(
 id uuid primary key default gen_random_uuid(),
 return_shipment_id uuid not null unique references public.return_shipments(id) on delete cascade,
 return_id uuid not null references public.returns(id) on delete cascade,
 customer_id uuid not null references public.profiles(id),
 provider text not null default 'paystack', provider_reference text unique,
 amount_cents bigint not null check(amount_cents>=0), currency text not null default 'ZAR',
 status text not null default 'pending' check(status in('pending','success','failed','review')),
 provider_payload jsonb not null default '{}'::jsonb, paid_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.vendor_liabilities(
 id uuid primary key default gen_random_uuid(),
 vendor_id uuid not null references public.vendors(id),
 return_id uuid not null references public.returns(id) on delete cascade,
 return_shipment_id uuid references public.return_shipments(id) on delete set null,
 kind text not null check(kind in('return_logistics','exchange_logistics','refund_principal')),
 description text not null, amount_cents bigint not null check(amount_cents>0),
 recovered_cents bigint not null default 0 check(recovered_cents>=0 and recovered_cents<=amount_cents),
 status text not null default 'open' check(status in('open','partial','recovered','waived')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(return_id,kind)
);
create index if not exists vendor_liabilities_vendor_idx on public.vendor_liabilities(vendor_id,status,created_at);

create table if not exists public.vendor_liability_recoveries(
 id uuid primary key default gen_random_uuid(),
 liability_id uuid not null references public.vendor_liabilities(id) on delete cascade,
 vendor_id uuid not null references public.vendors(id),
 order_id uuid not null references public.orders(id) on delete cascade,
 vendor_order_id uuid not null references public.vendor_orders(id) on delete cascade,
 amount_cents bigint not null check(amount_cents>0),
 status text not null default 'pending' check(status in('pending','settled','released')),
 expires_at timestamptz not null, created_at timestamptz not null default now(), settled_at timestamptz,
 unique(liability_id,order_id)
);

alter table public.return_shipments enable row level security;
alter table public.return_payments enable row level security;
alter table public.vendor_liabilities enable row level security;
alter table public.vendor_liability_recoveries enable row level security;

drop policy if exists return_shipments_customer_select on public.return_shipments;
create policy return_shipments_customer_select on public.return_shipments for select to authenticated using(
 exists(select 1 from public.returns r where r.id=return_shipments.return_id and r.customer_id=auth.uid())
);
drop policy if exists return_shipments_vendor_select on public.return_shipments;
create policy return_shipments_vendor_select on public.return_shipments for select to authenticated using(
 public.is_platform_admin() or public.is_vendor_member(return_shipments.vendor_id)
);
drop policy if exists return_payments_customer_select on public.return_payments;
create policy return_payments_customer_select on public.return_payments for select to authenticated using(customer_id=auth.uid() or public.is_platform_admin());
drop policy if exists vendor_liabilities_vendor_select on public.vendor_liabilities;
create policy vendor_liabilities_vendor_select on public.vendor_liabilities for select to authenticated using(public.is_platform_admin() or public.is_vendor_member(vendor_id));
drop policy if exists vendor_recoveries_vendor_select on public.vendor_liability_recoveries;
create policy vendor_recoveries_vendor_select on public.vendor_liability_recoveries for select to authenticated using(public.is_platform_admin() or public.is_vendor_member(vendor_id));

revoke insert,update,delete on public.return_shipments,public.return_payments,public.vendor_liabilities,public.vendor_liability_recoveries from anon,authenticated;
grant select on public.return_shipments,public.return_payments,public.vendor_liabilities,public.vendor_liability_recoveries to authenticated;

create or replace function public.request_return_v2(
 p_vendor_order_id uuid,p_resolution_type text,p_reason_code text,p_note text,p_exchange_note text default null
) returns uuid language plpgsql security definer set search_path='' as $f$
declare u uuid:=auth.uid(); vo public.vendor_orders%rowtype; rid uuid; claim text; label text;
begin
 if u is null then raise exception 'Authentication required.'; end if;
 select v.* into vo from public.vendor_orders v join public.orders o on o.id=v.order_id
 where v.id=p_vendor_order_id and o.customer_id=u;
 if vo.id is null then raise exception 'Order package not found.'; end if;
 if vo.fulfilment_status<>'delivered' then raise exception 'A return can be requested after delivery.'; end if;
 if p_resolution_type not in('refund','exchange') then raise exception 'Choose refund or exchange.'; end if;
 if p_reason_code not in('wrong_size_ordered','change_of_mind','wrong_size_received','wrong_item_received','defective','not_as_described','other')
 then raise exception 'Choose a valid return reason.'; end if;
 if p_resolution_type='exchange' and trim(coalesce(p_exchange_note,''))='' then raise exception 'Tell the store which replacement size or option you need.'; end if;
 if exists(select 1 from public.returns r where r.vendor_order_id=p_vendor_order_id and r.status not in('declined','refunded','closed'))
 then raise exception 'An active return already exists for this package.'; end if;
 claim:=case when p_reason_code in('wrong_size_ordered','change_of_mind') then 'customer'
             when p_reason_code in('wrong_size_received','wrong_item_received','defective','not_as_described') then 'vendor'
             else 'undetermined' end;
 label:=case p_reason_code
  when 'wrong_size_ordered' then 'Customer selected the wrong size' when 'change_of_mind' then 'Change of mind'
  when 'wrong_size_received' then 'Wrong size received' when 'wrong_item_received' then 'Wrong item received'
  when 'defective' then 'Defective item' when 'not_as_described' then 'Item not as described' else 'Other' end;
 insert into public.returns(public_reference,order_id,vendor_order_id,vendor_id,customer_id,reason,reason_code,customer_note,
 resolution_type,claimed_responsibility,responsibility,exchange_note,status,refund_amount_cents,requested_at,updated_at)
 values('KNR-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),vo.order_id,vo.id,vo.vendor_id,u,label,p_reason_code,
 nullif(trim(coalesce(p_note,'')),''),p_resolution_type,claim,'undetermined',nullif(trim(coalesce(p_exchange_note,'')),''),
 'requested',case when p_resolution_type='refund' then vo.merchandise_total_cents else 0 end,now(),now())
 returning id into rid;
 return rid;
end $f$;
revoke all on function public.request_return_v2(uuid,text,text,text,text) from public;
grant execute on function public.request_return_v2(uuid,text,text,text,text) to authenticated;

create or replace function public.can_manage_return_v2(p_return_id uuid) returns boolean
language sql stable security definer set search_path='' as $f$
 select public.is_platform_admin() or exists(select 1 from public.returns r where r.id=p_return_id and public.is_vendor_member(r.vendor_id));
$f$;
revoke all on function public.can_manage_return_v2(uuid) from public;
grant execute on function public.can_manage_return_v2(uuid) to authenticated;

create or replace function public.decide_return_v2(p_return_id uuid,p_decision text,p_responsibility text default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $f$
declare r public.returns%rowtype; admin boolean:=public.is_platform_admin();
begin
 select * into r from public.returns where id=p_return_id for update;
 if r.id is null then raise exception 'Return request not found.'; end if;
 if not(admin or public.is_vendor_member(r.vendor_id)) then raise exception 'Return management access required.'; end if;
 if r.status not in('requested','under_review') then raise exception 'This return has already been reviewed.'; end if;
 if p_decision='decline' then update public.returns set status='declined',decision_note=nullif(trim(coalesce(p_note,'')),''),updated_at=now() where id=r.id;
   return jsonb_build_object('status','declined'); end if;
 if p_decision='escalate' then update public.returns set status='under_review',responsibility='undetermined',decision_note=nullif(trim(coalesce(p_note,'')),''),updated_at=now() where id=r.id;
   return jsonb_build_object('status','under_review'); end if;
 if p_decision<>'approve' or p_responsibility not in('customer','vendor','kompo') then raise exception 'Choose a valid return decision and responsibility.'; end if;
 if p_responsibility='kompo' and not admin then raise exception 'Only Kompo Nation admin can assign platform responsibility.'; end if;
 if not admin and r.claimed_responsibility='vendor' and p_responsibility='customer' then
   update public.returns set status='under_review',responsibility='undetermined',decision_note='Responsibility disputed by the store.',updated_at=now() where id=r.id;
   return jsonb_build_object('status','under_review','escalated',true);
 end if;
 update public.returns set status='approved',responsibility=p_responsibility,decision_note=nullif(trim(coalesce(p_note,'')),''),approved_at=now(),updated_at=now() where id=r.id;
 return jsonb_build_object('status','approved','responsibility',p_responsibility);
end $f$;
revoke all on function public.decide_return_v2(uuid,text,text,text) from public;
grant execute on function public.decide_return_v2(uuid,text,text,text) to authenticated;

create or replace function public.mark_return_received_v2(p_return_id uuid) returns void
language plpgsql security definer set search_path='' as $f$
declare r public.returns%rowtype;
begin
 select * into r from public.returns where id=p_return_id for update;
 if r.id is null or not(public.is_platform_admin() or public.is_vendor_member(r.vendor_id)) then raise exception 'Return management access required.'; end if;
 if not exists(select 1 from public.return_shipments s where s.return_id=r.id and s.leg='reverse' and s.provider_shipment_id is not null and s.status in('booked','in_transit','delivered'))
 then raise exception 'The reverse courier shipment has not been booked.'; end if;
 update public.return_shipments set status='delivered',updated_at=now() where return_id=r.id and leg='reverse';
 update public.returns set status='received',received_at=now(),updated_at=now() where id=r.id;
end $f$;
revoke all on function public.mark_return_received_v2(uuid) from public;
grant execute on function public.mark_return_received_v2(uuid) to authenticated;

create or replace function public.confirm_return_refund_v2(p_return_id uuid) returns void
language plpgsql security definer set search_path='' as $f$
declare r public.returns%rowtype; vo public.vendor_orders%rowtype; owned boolean;
begin
 if not public.is_platform_admin() then raise exception 'Admin access required.'; end if;
 select * into r from public.returns where id=p_return_id for update;
 if r.id is null or r.resolution_type<>'refund' or r.status<>'received' then raise exception 'Returned goods must be received first.'; end if;
 select * into vo from public.vendor_orders where id=r.vendor_order_id;
 select is_platform_owned into owned from public.vendors where id=r.vendor_id;
 if not coalesce(owned,false) and vo.vendor_net_cents>0 then
  insert into public.vendor_liabilities(vendor_id,return_id,kind,description,amount_cents)
  values(r.vendor_id,r.id,'refund_principal','Vendor net for refunded merchandise '||r.public_reference,vo.vendor_net_cents)
  on conflict(return_id,kind) do nothing;
 end if;
 update public.returns set status='refunded',completed_at=now(),updated_at=now() where id=r.id;
end $f$;
revoke all on function public.confirm_return_refund_v2(uuid) from public;
grant execute on function public.confirm_return_refund_v2(uuid) to authenticated;

create or replace function public.close_exchange_return_v2(p_return_id uuid) returns void
language plpgsql security definer set search_path='' as $f$
declare r public.returns%rowtype;
begin
 select * into r from public.returns where id=p_return_id for update;
 if r.id is null or not(public.is_platform_admin() or public.is_vendor_member(r.vendor_id)) then raise exception 'Return management access required.'; end if;
 if r.resolution_type<>'exchange' or not exists(select 1 from public.return_shipments s where s.return_id=r.id and s.leg='exchange_outbound' and s.status='delivered')
 then raise exception 'Replacement delivery is not marked delivered.'; end if;
 update public.returns set status='closed',completed_at=now(),updated_at=now() where id=r.id;
end $f$;
revoke all on function public.close_exchange_return_v2(uuid) from public;
grant execute on function public.close_exchange_return_v2(uuid) to authenticated;

create or replace function public.reserve_vendor_liability_recoveries(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare role_name text:=coalesce(current_setting('request.jwt.claim.role',true),''); vo record; l record; remain bigint; reserved bigint; outstanding bigint; take bigint; exp timestamptz; result jsonb;
begin
 if role_name<>'service_role' then raise exception 'Service role required.'; end if;
 update public.vendor_liability_recoveries set status='released' where status='pending' and expires_at<=now();
 select coalesce(jsonb_agg(jsonb_build_object('subaccount',x.subaccount,'deductionCents',x.deduction)),'[]'::jsonb) into result
 from(select vps.paystack_subaccount_code subaccount,sum(r.amount_cents)::bigint deduction
      from public.vendor_liability_recoveries r join public.vendor_private_settings vps on vps.vendor_id=r.vendor_id
      where r.order_id=p_order_id and r.status='pending' and r.expires_at>now()
      group by vps.paystack_subaccount_code)x;
 if jsonb_array_length(result)>0 then return result; end if;
 select coalesce(reservation_expires_at,now()+interval '20 minutes') into exp from public.orders where id=p_order_id;
 if exp is null then raise exception 'Checkout order not found.'; end if;
 for vo in select x.id vendor_order_id,x.vendor_id,x.vendor_net_cents,vps.paystack_subaccount_code
   from public.vendor_orders x join public.vendors v on v.id=x.vendor_id
   join public.vendor_private_settings vps on vps.vendor_id=x.vendor_id
   where x.order_id=p_order_id and not v.is_platform_owned and nullif(trim(coalesce(vps.paystack_subaccount_code,'')),'') is not null loop
   remain:=greatest(0,vo.vendor_net_cents);
   for l in select * from public.vendor_liabilities where vendor_id=vo.vendor_id and status in('open','partial') and recovered_cents<amount_cents order by created_at for update loop
    exit when remain<=0;
    select coalesce(sum(amount_cents),0) into reserved from public.vendor_liability_recoveries where liability_id=l.id and status='pending' and expires_at>now();
    outstanding:=greatest(0,l.amount_cents-l.recovered_cents-reserved); if outstanding<=0 then continue; end if;
    take:=least(remain,outstanding);
    insert into public.vendor_liability_recoveries(liability_id,vendor_id,order_id,vendor_order_id,amount_cents,expires_at)
    values(l.id,vo.vendor_id,p_order_id,vo.vendor_order_id,take,exp) on conflict(liability_id,order_id) do nothing;
    remain:=remain-take;
   end loop;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('subaccount',x.subaccount,'deductionCents',x.deduction)),'[]'::jsonb) into result
 from(select vps.paystack_subaccount_code subaccount,sum(r.amount_cents)::bigint deduction
      from public.vendor_liability_recoveries r join public.vendor_private_settings vps on vps.vendor_id=r.vendor_id
      where r.order_id=p_order_id and r.status='pending' and r.expires_at>now()
      group by vps.paystack_subaccount_code)x;
 return result;
end $f$;
revoke all on function public.reserve_vendor_liability_recoveries(uuid) from public;
grant execute on function public.reserve_vendor_liability_recoveries(uuid) to service_role;

create or replace function public.settle_vendor_liability_recoveries_by_reference(p_public_reference text) returns void
language plpgsql security definer set search_path='' as $f$
declare role_name text:=coalesce(current_setting('request.jwt.claim.role',true),''); oid uuid; r record;
begin
 if role_name<>'service_role' then raise exception 'Service role required.'; end if;
 select id into oid from public.orders where public_reference=p_public_reference;
 if oid is null then raise exception 'Order not found.'; end if;
 for r in select * from public.vendor_liability_recoveries where order_id=oid and status='pending' for update loop
  update public.vendor_liabilities set recovered_cents=least(amount_cents,recovered_cents+r.amount_cents),
  status=case when recovered_cents+r.amount_cents>=amount_cents then 'recovered' else 'partial' end,updated_at=now() where id=r.liability_id;
  update public.vendor_liability_recoveries set status='settled',settled_at=now() where id=r.id;
 end loop;
end $f$;
revoke all on function public.settle_vendor_liability_recoveries_by_reference(text) from public;
grant execute on function public.settle_vendor_liability_recoveries_by_reference(text) to service_role;

create or replace function public.finalize_return_payment(p_provider_reference text,p_amount_cents bigint,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $f$
declare role_name text:=coalesce(current_setting('request.jwt.claim.role',true),''); pay public.return_payments%rowtype;
begin
 if role_name<>'service_role' then raise exception 'Service role required.'; end if;
 select * into pay from public.return_payments where provider_reference=p_provider_reference for update;
 if pay.id is null then raise exception 'Return payment not found.'; end if;
 if pay.status='success' then return jsonb_build_object('returnShipmentId',pay.return_shipment_id,'returnId',pay.return_id); end if;
 if p_amount_cents<>pay.amount_cents then update public.return_payments set status='review',provider_payload=p_payload,updated_at=now() where id=pay.id; raise exception 'Return payment amount mismatch.'; end if;
 update public.return_payments set status='success',provider_payload=p_payload,paid_at=now(),updated_at=now() where id=pay.id;
 update public.return_shipments set status='ready_to_book',updated_at=now() where id=pay.return_shipment_id and payer='customer';
 return jsonb_build_object('returnShipmentId',pay.return_shipment_id,'returnId',pay.return_id);
end $f$;
revoke all on function public.finalize_return_payment(text,bigint,jsonb) from public;
grant execute on function public.finalize_return_payment(text,bigint,jsonb) to service_role;

commit;
