const { authenticatedUser, json, required, supabaseRequest } = require("./lib/runtime");

const mapAddress = (address) => ({ company: address.company || "", street_address: address.streetAddress, local_area: address.localArea || "", city: address.city, zone: address.province, country: address.country || "ZA", code: address.postalCode });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const { token } = await authenticatedUser(event);
    const { vendorOrderId } = JSON.parse(event.body || "{}");
    if (!vendorOrderId) return json(400, { error: "Vendor order is required." });
    const visible = await supabaseRequest(`vendor_orders?select=id&id=eq.${encodeURIComponent(vendorOrderId)}&limit=1`, { service: false, token });
    if (!visible.length) return json(403, { error: "This account cannot book that package." });
    const select = "id,public_reference,fulfilment_status,merchandise_total_cents,shipping_quote,vendors(id,business_name,vendor_private_settings(contact_email,contact_phone,collection_street_address,collection_local_area,collection_city,collection_province,collection_postal_code,collection_country_code)),orders(customer_name,customer_email,customer_phone,delivery_address),order_items(quantity,product_name,sku,product_variants(weight_kg,length_cm,width_cm,height_cm))";
    const rows = await supabaseRequest(`vendor_orders?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(vendorOrderId)}&limit=1`);
    const order = rows[0];
    if (!order || !["packed","ready_for_collection"].includes(order.fulfilment_status)) return json(409, { error: "Package must be packed before collection can be booked." });
    const existing = await supabaseRequest(`shipments?select=*&vendor_order_id=eq.${encodeURIComponent(vendorOrderId)}&limit=1`);
    if (existing.length && existing[0].provider_shipment_id) return json(200, { ok: true, shipment: existing[0], alreadyBooked: true });
    const vendor = Array.isArray(order.vendors) ? order.vendors[0] : order.vendors;
    const privateSettings = Array.isArray(vendor.vendor_private_settings) ? vendor.vendor_private_settings[0] : vendor.vendor_private_settings;
    const parent = Array.isArray(order.orders) ? order.orders[0] : order.orders;
    if (!privateSettings?.collection_street_address || !privateSettings.contact_phone || !privateSettings.contact_email) return json(409, { error: "Complete the store collection address and contact details first." });
    const destination = parent.delivery_address;
    const quote = order.shipping_quote || {};
    const payload = {
      collection_address: mapAddress({ company: vendor.business_name, streetAddress: privateSettings.collection_street_address, localArea: privateSettings.collection_local_area || "", city: privateSettings.collection_city, province: privateSettings.collection_province, postalCode: privateSettings.collection_postal_code, country: privateSettings.collection_country_code || "ZA" }),
      collection_contact_name: vendor.business_name, collection_contact_mobile_number: privateSettings.contact_phone, collection_contact_email: privateSettings.contact_email,
      delivery_address: mapAddress(destination), delivery_contact_name: parent.customer_name, delivery_contact_mobile_number: parent.customer_phone, delivery_contact_email: parent.customer_email,
      parcels: order.order_items.map((item) => { const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants; return { description: `${item.product_name} × ${item.quantity}`, submitted_length_cm: Number(variant.length_cm), submitted_width_cm: Number(variant.width_cm), submitted_height_cm: Number(variant.height_cm), submitted_weight_kg: Number(variant.weight_kg) * Number(item.quantity), custom_parcel_reference: item.sku }; }),
      declared_value: Number(order.merchandise_total_cents) / 100, timeout: 20000, custom_order_number: order.public_reference, service_level_code: quote.serviceLevelCode, provider_slug: quote.providerSlug,
    };
    const response = await fetch(`${(process.env.BOBGO_API_BASE_URL || "https://api.sandbox.bobgo.co.za/v2").replace(/\/$/, "")}/shipments`, { method: "POST", headers: { Authorization: `Bearer ${required("BOBGO_API_TOKEN")}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const shipment = await response.json();
    if (!response.ok) throw new Error(shipment.message || "Bob Go did not accept the booking.");
    const row = { vendor_order_id: vendorOrderId, provider: "bobgo", provider_shipment_id: String(shipment.id || shipment.shipment_id), tracking_reference: shipment.tracking_reference || shipment.tracking_number || null, tracking_url: shipment.tracking_url || null, courier_name: shipment.provider_name || shipment.courier_name || quote.courierName || null, service_name: shipment.service_level_name || quote.serviceName || null, status: "booked", cost_cents: quote.amountCents || null, provider_payload: shipment, updated_at: new Date().toISOString() };
    const saved = await supabaseRequest("shipments?on_conflict=vendor_order_id", { method: "POST", body: row, headers: { Prefer: "resolution=merge-duplicates,return=representation" } });
    await supabaseRequest(`vendor_orders?id=eq.${encodeURIComponent(vendorOrderId)}`, { method: "PATCH", body: { fulfilment_status: "booked", updated_at: new Date().toISOString() } });
    return json(200, { ok: true, shipment: saved[0] || row, alreadyBooked: false });
  } catch (error) { return json(502, { error: error.message }); }
};
