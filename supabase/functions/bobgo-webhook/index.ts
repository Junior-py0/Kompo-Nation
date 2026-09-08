import { json, rawBody, required, supabaseRequest } from "../_shared/runtime.ts";

type Json = Record<string, any>;
function object(value: unknown): Json { return value && typeof value === "object" ? value as Json : {}; }
function equalSecret(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) difference |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  return difference === 0;
}
function shipmentObject(value: unknown): Json {
  const root = object(value);
  for (const candidate of [root.shipment, root.data?.shipment, root.data, root]) {
    if (Array.isArray(candidate) && candidate.length) return object(candidate[0]);
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) return candidate;
  }
  return {};
}
function latestStatus(value: unknown): string {
  const shipment = shipmentObject(value);
  const events = Array.isArray(shipment.tracking_events)
    ? [...shipment.tracking_events].sort((a, b) => Date.parse(String(b?.date || b?.created_at || 0)) - Date.parse(String(a?.date || a?.created_at || 0)))
    : [];
  return String(shipment.status || shipment.shipment_status || events[0]?.status || "");
}
export function mappedStatus(value: unknown): "shipped" | "delivered" | "cancelled" | null {
  const status = String(value || "").toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (["collected", "collection_completed", "in_transit", "out_for_delivery", "shipped"].some((part) => status.includes(part))) return "shipped";
  if (status === "completed" || ["delivered", "delivery_completed"].some((part) => status.includes(part))) return "delivered";
  if (["cancelled", "canceled", "failed"].some((part) => status.includes(part))) return "cancelled";
  return null;
}
function references(payload: Json) {
  const data = object(payload.data), shipment = object(payload.shipment || data.shipment);
  return {
    providerId: String(payload.shipment_id || data.shipment_id || shipment.id || shipment.shipment_id || payload.id || ""),
    trackingReference: String(payload.shipment_tracking_reference || payload.tracking_reference || data.shipment_tracking_reference || data.tracking_reference || shipment.tracking_reference || ""),
  };
}
async function bob(path: string): Promise<Json> {
  const base = (Deno.env.get("BOBGO_API_BASE_URL") || "https://api.bobgo.co.za/v2").replace(/\/$/, "");
  const response = await fetch(base + path, { headers: { Authorization: `Bearer ${required("BOBGO_API_TOKEN")}` }, signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || body?.error || "Bob Go shipment verification failed.");
  return body;
}
async function applyUpdate(local: Json, verified: Json) {
  const source = shipmentObject(verified), next = mappedStatus(latestStatus(verified));
  const rank: Record<string, number> = { booked: 0, shipped: 1, delivered: 2 };
  const advance = next && next !== "cancelled" && (rank[next] || 0) >= (rank[String(local.status)] || 0)
    ? next : next === "cancelled" && local.status === "booked" ? next : null;
  const changes: Json = { provider_payload: verified, updated_at: new Date().toISOString() };
  if (advance) changes.status = advance;
  changes.tracking_reference = source.tracking_reference || source.short_tracking_reference || local.tracking_reference;
  changes.tracking_url = source.tracking_url || local.tracking_url;
  await supabaseRequest(`shipments?id=eq.${encodeURIComponent(local.id)}`, { method: "PATCH", body: changes });
  if (advance) await supabaseRequest(`vendor_orders?id=eq.${encodeURIComponent(local.vendor_order_id)}`, { method: "PATCH", body: { fulfilment_status: advance, updated_at: new Date().toISOString() } });
  return advance;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json(request, 405, { error: "Method not allowed." });
  try {
    const url = new URL(request.url);
    const supplied = request.headers.get("x-kompo-webhook-token") || url.searchParams.get("token") || "";
    if (!equalSecret(supplied, required("BOBGO_WEBHOOK_SECRET"))) return json(request, 401, { error: "Invalid webhook token." });
    const text = await rawBody(request);
    if (text.length > 100000) return json(request, 413, { error: "Request too large." });
    const payload = object(JSON.parse(text || "{}"));
    const { providerId, trackingReference } = references(payload);
    if (!providerId && !trackingReference) return json(request, 400, { error: "Shipment identity is missing." });
    const query = trackingReference ? `tracking_reference=eq.${encodeURIComponent(trackingReference)}` : `provider_shipment_id=eq.${encodeURIComponent(providerId)}`;
    const shipments = await supabaseRequest(`shipments?select=id,vendor_order_id,status,provider_shipment_id,tracking_reference,tracking_url&${query}&limit=1`);
    if (!shipments.length) {
      const returns = await supabaseRequest(`return_shipments?select=id,return_id,leg,status,provider_shipment_id,tracking_reference,tracking_url&${query}&limit=1`);
      if (!returns.length) return json(request, 202, { ok: true, unmatched: true });
      const local = returns[0];
      const verified = local.tracking_reference ? await bob(`/tracking?tracking_reference=${encodeURIComponent(local.tracking_reference)}`) : await bob(`/shipments?id=${encodeURIComponent(local.provider_shipment_id)}`);
      const next = mappedStatus(latestStatus(verified));
      const returnStatus = next === "shipped" ? "in_transit" : next;
      const source = shipmentObject(verified);
      const changes: Json = { provider_payload: verified, updated_at: new Date().toISOString(), tracking_reference: source.tracking_reference || source.short_tracking_reference || local.tracking_reference, tracking_url: source.tracking_url || local.tracking_url };
      if (["in_transit", "delivered", "cancelled"].includes(String(returnStatus))) changes.status = returnStatus;
      await supabaseRequest(`return_shipments?id=eq.${encodeURIComponent(local.id)}`, { method: "PATCH", body: changes });
      if (local.leg === "reverse" && returnStatus === "in_transit") await supabaseRequest(`returns?id=eq.${encodeURIComponent(local.return_id)}`, { method: "PATCH", body: { status: "in_transit", updated_at: new Date().toISOString() } });
      if (local.leg === "exchange_outbound" && returnStatus === "delivered") await supabaseRequest(`returns?id=eq.${encodeURIComponent(local.return_id)}`, { method: "PATCH", body: { status: "closed", completed_at: new Date().toISOString(), updated_at: new Date().toISOString() } });
      return json(request, 200, { ok: true, returnShipment: true, status: returnStatus || local.status });
    }
    const local = shipments[0];
    const verified = local.tracking_reference ? await bob(`/tracking?tracking_reference=${encodeURIComponent(local.tracking_reference)}`) : await bob(`/shipments?id=${encodeURIComponent(local.provider_shipment_id)}`);
    const verifiedObject = shipmentObject(verified);
    const verifiedId = String(verifiedObject.shipment_id || verifiedObject.id || "");
    const verifiedTracking = String(verifiedObject.tracking_reference || verifiedObject.short_tracking_reference || local.tracking_reference || "");
    if ((verifiedId && verifiedId !== String(local.provider_shipment_id)) || (local.tracking_reference && verifiedTracking && verifiedTracking !== local.tracking_reference)) throw new Error("Bob Go shipment identity did not match the local order.");
    const eventStatus = latestStatus(verified) || latestStatus(payload) || "update";
    const eventKey = `${local.provider_shipment_id}:${eventStatus}:${payload.event_id || payload.created_at || payload.timestamp || "current"}`;
    await supabaseRequest("webhook_events?on_conflict=provider,event_key", { method: "POST", body: { provider: "bobgo", event_key: eventKey.slice(0, 250), payload }, headers: { Prefer: "resolution=ignore-duplicates,return=minimal" } });
    const status = await applyUpdate(local, verified);
    return json(request, 200, { ok: true, status: status || local.status });
  } catch (error) {
    console.error("bobgo-webhook failed:", error);
    return json(request, 500, { error: error instanceof Error ? error.message : "Tracking update could not be verified." });
  }
});
