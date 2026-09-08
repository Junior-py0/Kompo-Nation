import {
  json,
  required,
  rpc,
  supabaseRequest,
} from "../_shared/runtime.ts";

function mapped(value: unknown): "shipped" | "delivered" | "cancelled" | null {
  const status=String(value||"").toLowerCase().replaceAll("-","_").replaceAll(" ","_");
  if(["collected","collection_completed","in_transit","out_for_delivery","shipped"].some((part)=>status.includes(part)))return "shipped";
  if(status==="completed"||["delivered","delivery_completed"].some((part)=>status.includes(part)))return "delivered";
  if(["cancelled","canceled","failed"].some((part)=>status.includes(part)))return "cancelled";
  return null;
}
function shipmentObject(value:any){
  for(const candidate of [value?.shipment,value?.data?.shipment,value?.data,value]){
    if(Array.isArray(candidate)&&candidate.length)return candidate[0]||{};
    if(candidate&&typeof candidate==="object"&&!Array.isArray(candidate))return candidate;
  }
  return {};
}
async function reconcileShipments(){
  const rows=await supabaseRequest("shipments?select=id,vendor_order_id,status,provider_shipment_id,tracking_reference,tracking_url&status=in.(booked,shipped)&order=updated_at.asc&limit=100");
  let checked=0,advanced=0,failed=0;
  const base=(Deno.env.get("BOBGO_API_BASE_URL")||"https://api.bobgo.co.za/v2").replace(/\/$/,"");
  for(const row of rows){
    if(!row.tracking_reference&&!row.provider_shipment_id)continue;
    try{
      const path=row.tracking_reference?`/tracking?tracking_reference=${encodeURIComponent(row.tracking_reference)}`:`/shipments?id=${encodeURIComponent(row.provider_shipment_id)}`;
      const response=await fetch(base+path,{headers:{Authorization:`Bearer ${required("BOBGO_API_TOKEN")}`},signal:AbortSignal.timeout(15000)});
      const verified=await response.json();
      if(!response.ok)throw new Error(verified?.message||"Tracking lookup failed.");
      checked+=1;
      const shipment=shipmentObject(verified);
      const events=Array.isArray(shipment.tracking_events)?[...shipment.tracking_events].sort((a,b)=>Date.parse(b?.date||b?.created_at||0)-Date.parse(a?.date||a?.created_at||0)):[];
      const next=mapped(shipment.status||shipment.shipment_status||events[0]?.status),rank:any={booked:0,shipped:1,delivered:2};
      const shouldAdvance=Boolean(next&&next!=="cancelled"&&(rank[next]||0)>(rank[row.status]||0)||next==="cancelled"&&row.status==="booked");
      const body:any={provider_payload:verified,updated_at:new Date().toISOString(),tracking_reference:shipment.tracking_reference||shipment.short_tracking_reference||row.tracking_reference,tracking_url:shipment.tracking_url||row.tracking_url};
      if(shouldAdvance){body.status=next;advanced+=1;}
      await supabaseRequest(`shipments?id=eq.${encodeURIComponent(row.id)}`,{method:"PATCH",body});
      if(shouldAdvance)await supabaseRequest(`vendor_orders?id=eq.${encodeURIComponent(row.vendor_order_id)}`,{method:"PATCH",body:{fulfilment_status:next,updated_at:new Date().toISOString()}});
    }catch(error){failed+=1;console.error("shipment reconciliation failed",row.id,error instanceof Error?error.message:String(error));}
  }
  return {checked,advanced,failed};
}
async function ensureTrackingWebhooks(){
  const base=(Deno.env.get("BOBGO_API_BASE_URL")||"https://api.bobgo.co.za/v2").replace(/\/$/,"");
  const headers={Authorization:`Bearer ${required("BOBGO_API_TOKEN")}`,"Content-Type":"application/json"};
  const delivery=`${required("SUPABASE_URL").replace(/\/$/,"")}/functions/v1/bobgo-webhook?token=${encodeURIComponent(required("BOBGO_WEBHOOK_SECRET"))}`;
  const response=await fetch(`${base}/webhooks`,{headers,signal:AbortSignal.timeout(15000)});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload?.message||payload?.error||"Bob Go webhook lookup failed.");
  const list=Array.isArray(payload)?payload:payload?.webhook_subscriptions||payload?.subscriptions||payload?.data||[];
  const topics=["tracking/updated","shipment_submission_status/updated"];
  const missing=topics.filter((topic)=>!list.some((item:any)=>item?.topic===topic&&item?.delivery_url===delivery&&item?.status==="active"));
  if(missing.length){
    const created=await fetch(`${base}/webhooks`,{method:"POST",headers,body:JSON.stringify({webhook_subscriptions:missing.map((topic)=>({delivery_url:delivery,topic,status:"active"}))}),signal:AbortSignal.timeout(15000)});
    const result=await created.json();
    if(!created.ok)throw new Error(result?.message||result?.error||"Bob Go webhook registration failed.");
  }
  return {active:topics.length,registered:missing.length};
}

async function reconcileIotShipments(){
  const rows=await supabaseRequest("iot_shipments?select=order_id,status,provider_id,tracking_reference,tracking_url,label_url&status=in.(booked,shipped)&order=updated_at.asc&limit=100");
  let checked=0,advanced=0,failed=0;
  const base=(Deno.env.get("IOT_BOBGO_API_BASE_URL")||Deno.env.get("BOBGO_API_BASE_URL")||"https://api.bobgo.co.za/v2").replace(/\/$/,"");
  const token=Deno.env.get("IOT_BOBGO_API_TOKEN")||required("BOBGO_API_TOKEN");
  for(const row of rows){
    if(!row.tracking_reference&&!row.provider_id)continue;
    try{
      const path=row.tracking_reference?`/tracking?tracking_reference=${encodeURIComponent(row.tracking_reference)}`:`/shipments?id=${encodeURIComponent(row.provider_id)}`;
      const response=await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      const verified=await response.json();
      if(!response.ok)throw new Error(verified?.message||verified?.error||"Tracking lookup failed.");
      checked+=1;
      const shipment=shipmentObject(verified);
      const events=Array.isArray(shipment.tracking_events)?[...shipment.tracking_events].sort((a,b)=>Date.parse(b?.date||b?.created_at||0)-Date.parse(a?.date||a?.created_at||0)):[];
      const next=mapped(shipment.status||shipment.shipment_status||events[0]?.status),rank:any={booked:0,shipped:1,delivered:2};
      const shouldAdvance=Boolean(next&&next!=="cancelled"&&(rank[next]||0)>(rank[row.status]||0)||next==="cancelled"&&row.status==="booked");
      const body:any={payload:verified,updated_at:new Date().toISOString(),tracking_reference:shipment.tracking_reference||shipment.short_tracking_reference||row.tracking_reference,tracking_url:shipment.tracking_url||row.tracking_url,label_url:shipment.waybill_url||shipment.label_url||row.label_url};
      if(shouldAdvance){body.status=next;advanced+=1;}
      await supabaseRequest(`iot_shipments?order_id=eq.${encodeURIComponent(row.order_id)}`,{method:"PATCH",body});
      if(shouldAdvance)await supabaseRequest(`iot_orders?id=eq.${encodeURIComponent(row.order_id)}&status=in.(paid,processing,shipped)`,{method:"PATCH",body:{status:next,updated_at:new Date().toISOString()}});
    }catch(error){failed+=1;console.error("Kitora shipment reconciliation failed",row.order_id,error instanceof Error?error.message:String(error));}
  }
  return {checked,advanced,failed};
}

async function ensureIotTrackingWebhooks(){
  const base=(Deno.env.get("IOT_BOBGO_API_BASE_URL")||Deno.env.get("BOBGO_API_BASE_URL")||"https://api.bobgo.co.za/v2").replace(/\/$/,"");
  const token=Deno.env.get("IOT_BOBGO_API_TOKEN")||required("BOBGO_API_TOKEN");
  const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};
  const delivery=`${required("SUPABASE_URL").replace(/\/$/,"")}/functions/v1/iot-bobgo-webhook?token=${encodeURIComponent(required("IOT_BOBGO_WEBHOOK_SECRET"))}`;
  const response=await fetch(`${base}/webhooks`,{headers,signal:AbortSignal.timeout(15000)});
  const payload=await response.json();
  if(!response.ok)throw new Error(payload?.message||payload?.error||"Bob Go webhook lookup failed.");
  const list=Array.isArray(payload)?payload:payload?.webhook_subscriptions||payload?.subscriptions||payload?.data||[];
  const topics=["tracking/updated","shipment_submission_status/updated"];
  const missing=topics.filter((topic)=>!list.some((item:any)=>item?.topic===topic&&item?.delivery_url===delivery&&item?.status==="active"));
  if(missing.length){
    const created=await fetch(`${base}/webhooks`,{method:"POST",headers,body:JSON.stringify({webhook_subscriptions:missing.map((topic)=>({delivery_url:delivery,topic,status:"active"}))}),signal:AbortSignal.timeout(15000)});
    const result=await created.json();
    if(!created.ok)throw new Error(result?.message||result?.error||"Bob Go webhook registration failed.");
  }
  return {active:topics.length,registered:missing.length};
}

Deno.serve(
  async (request: Request) => {
    if (request.method !== "POST") {
      return json(request, 405, {
        error:
          "Method not allowed.",
      });
    }

    try {
      const authorization =
        request.headers.get(
          "authorization",
        ) || "";

      if (
        authorization !==
        `Bearer ${
          required(
            "CRON_SECRET",
          )
        }`
      ) {
        return json(request, 401, {
          error: "Unauthorized.",
        });
      }

      const released =
        await rpc(
          "release_expired_reservations",
          {},
        );

      const shipments = await reconcileShipments();
      const iotShipments = await reconcileIotShipments();
      let webhooks;
      try{webhooks=await ensureTrackingWebhooks();}
      catch(error){console.error("webhook registration check failed",error instanceof Error?error.message:String(error));webhooks={error:true};}
      let iotWebhooks;
      try{iotWebhooks=await ensureIotTrackingWebhooks();}
      catch(error){console.error("Kitora webhook registration check failed",error instanceof Error?error.message:String(error));iotWebhooks={error:true};}

      return json(request, 200, {
        ok: true,
        released,
        shipments,
        webhooks,
        iotShipments,
        iotWebhooks,
      });
    } catch (error) {
      console.error(
        "release-reservations failed:",
        error,
      );

      return json(request, 500, {
        error:
          error instanceof Error
            ? error.message
            : "Reservation cleanup failed.",
      });
    }
  },
);
