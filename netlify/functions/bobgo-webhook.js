const { json, rawBody, required, supabaseRequest } = require("./lib/runtime");

const mappedStatus = (value) => {
  const status = String(value || "").toLowerCase();
  if (["collected","in_transit","out_for_delivery","shipped"].some((part) => status.includes(part))) return "shipped";
  if (["delivered","completed"].some((part) => status.includes(part))) return "delivered";
  if (["cancelled","failed"].some((part) => status.includes(part))) return "cancelled";
  return null;
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const token = event.headers["x-kompo-webhook-token"] || new URLSearchParams(event.rawQuery || "").get("token");
    if (!token || token !== required("BOBGO_WEBHOOK_SECRET")) return json(401, { error: "Invalid webhook token." });
    const payload = JSON.parse(rawBody(event) || "{}");
    const providerId = String(payload.shipment_id || payload.id || payload.shipment?.id || "");
    const eventKey = String(payload.event_id || payload.id || `${providerId}:${payload.status || payload.tracking_status || "update"}`);
    if (!providerId) return json(400, { error: "Shipment identity is missing." });
    try { await supabaseRequest("webhook_events", { method: "POST", body: { provider: "bobgo", event_key: eventKey, payload }, headers: { Prefer: "resolution=ignore-duplicates" } }); } catch (error) { if (error.message.toLowerCase().includes("duplicate")) return json(200, { ok: true, duplicate: true }); throw error; }
    const shipments = await supabaseRequest(`shipments?select=id,vendor_order_id,status&provider_shipment_id=eq.${encodeURIComponent(providerId)}&limit=1`);
    if (!shipments.length) return json(202, { ok: true, unmatched: true });
    const shipment = shipments[0];
    const status = mappedStatus(payload.status || payload.tracking_status || payload.event);
    const changes = { provider_payload: payload, updated_at: new Date().toISOString() };
    if (status) changes.status = status;
    if (payload.tracking_reference || payload.tracking_number) changes.tracking_reference = payload.tracking_reference || payload.tracking_number;
    if (payload.tracking_url) changes.tracking_url = payload.tracking_url;
    await supabaseRequest(`shipments?id=eq.${shipment.id}`, { method: "PATCH", body: changes });
    if (status) await supabaseRequest(`vendor_orders?id=eq.${shipment.vendor_order_id}`, { method: "PATCH", body: { fulfilment_status: status, updated_at: new Date().toISOString() } });
    return json(200, { ok: true });
  } catch (error) { return json(500, { error: error.message }); }
};
