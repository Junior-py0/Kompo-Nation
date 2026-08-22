const { json, required, signQuote, supabaseRequest } = require("./lib/runtime");

const mapAddress = (address) => ({ company: address.company || "", street_address: address.streetAddress, local_area: address.localArea || "", city: address.city, zone: address.province, country: address.country || "ZA", code: address.postalCode });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const body = JSON.parse(event.body || "{}");
    if (!body.lines?.length || !body.address?.streetAddress || !body.address?.postalCode || !body.contact?.email || !body.contact?.phone) return json(400, { error: "Cart, contact and complete delivery details are required." });
    const ids = [...new Set(body.lines.map((line) => line.productId))];
    const select = "id,vendor_id,name,status,vendors(id,business_name,status,vendor_private_settings(contact_email,contact_phone,collection_street_address,collection_local_area,collection_city,collection_province,collection_postal_code,collection_country_code)),product_variants(id,sku,size,colour,price_cents,stock_quantity,weight_kg,length_cm,width_cm,height_cm,active)";
    const products = await supabaseRequest(`products?select=${encodeURIComponent(select)}&id=in.(${ids.join(",")})`);
    const groups = new Map();
    for (const line of body.lines) {
      const product = products.find((item) => item.id === line.productId);
      const variant = product?.product_variants?.find((item) => item.size === line.size && item.colour === line.colour && item.active);
      if (!product || product.status !== "active" || !variant || line.quantity < 1 || variant.stock_quantity < line.quantity) return json(409, { error: "Your bag contains an unavailable piece." });
      const group = groups.get(product.vendor_id) || { vendor: product.vendors, lines: [] };
      group.lines.push({ line, product, variant });
      groups.set(product.vendor_id, group);
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const quotes = [];
    for (const [vendorId, group] of groups) {
      const vendor = Array.isArray(group.vendor) ? group.vendor[0] : group.vendor;
      const privateSettings = Array.isArray(vendor?.vendor_private_settings) ? vendor.vendor_private_settings[0] : vendor?.vendor_private_settings;
      if (!vendor || vendor.status !== "active") return json(409, { error: "One store is not accepting orders." });
      let selected = { rateId: `fixed-${vendorId}`, serviceLevelCode: "ECO", providerSlug: "fixed", courierName: "Nationwide delivery", serviceName: "Door-to-door delivery", amountCents: Number(process.env.DEFAULT_DELIVERY_CENTS || 9900) };
      if (process.env.BOBGO_API_TOKEN) {
        if (!privateSettings?.collection_street_address || !privateSettings.collection_city || !privateSettings.collection_postal_code) return json(409, { error: `${vendor.business_name} must complete its collection address.` });
        const collectionAddress = { company: vendor.business_name, streetAddress: privateSettings.collection_street_address, localArea: privateSettings.collection_local_area || "", city: privateSettings.collection_city, province: privateSettings.collection_province || "", postalCode: privateSettings.collection_postal_code, country: privateSettings.collection_country_code || "ZA" };
        const declaredValue = group.lines.reduce((sum, item) => sum + Number(item.variant.price_cents) * Number(item.line.quantity), 0);
        const payload = {
          collection_address: mapAddress(collectionAddress), delivery_address: mapAddress(body.address),
          parcels: group.lines.map(({ line, product, variant }) => ({ description: `${product.name} × ${line.quantity}`, submitted_length_cm: Number(variant.length_cm), submitted_width_cm: Number(variant.width_cm), submitted_height_cm: Number(variant.height_cm), submitted_weight_kg: Number(variant.weight_kg) * Number(line.quantity), custom_parcel_reference: variant.sku })),
          collection_contact_mobile_number: privateSettings.contact_phone || required("DEFAULT_COLLECTION_PHONE"), collection_contact_email: privateSettings.contact_email || required("DEFAULT_COLLECTION_EMAIL"), collection_contact_full_name: vendor.business_name,
          delivery_contact_mobile_number: body.contact.phone, delivery_contact_email: body.contact.email, delivery_contact_full_name: body.contact.fullName,
          declared_value: declaredValue / 100, timeout: 10000,
        };
        const response = await fetch(`${(process.env.BOBGO_API_BASE_URL || "https://api.sandbox.bobgo.co.za/v2").replace(/\/$/, "")}/rates`, { method: "POST", headers: { Authorization: `Bearer ${process.env.BOBGO_API_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const rates = await response.json();
        if (!response.ok) throw new Error(rates.message || `Courier rates failed for ${vendor.business_name}.`);
        const rate = rates.map((item, index) => ({ rateId: String(item.id || `${item.provider_slug || "courier"}-${index}`), serviceLevelCode: String(item.service_level_code || item.service_level_id || "ECO"), providerSlug: String(item.provider_slug || item.provider || ""), courierName: String(item.provider_name || item.courier_name || item.provider_slug || "Courier"), serviceName: String(item.service_level_name || item.service_name || "Courier delivery"), amountCents: Math.round(Number(item.rate || item.total || item.amount || 0) * 100) })).filter((item) => item.amountCents > 0).sort((a, b) => a.amountCents - b.amountCents)[0];
        if (!rate) throw new Error(`No courier service is available for ${vendor.business_name}.`);
        selected = rate;
      } else if (process.env.ALLOW_FIXED_DELIVERY !== "true") return json(503, { error: "Live courier quoting is not configured." });
      const signed = { vendorId, rateId: selected.rateId, serviceLevelCode: selected.serviceLevelCode, providerSlug: selected.providerSlug, amountCents: selected.amountCents, destinationPostalCode: body.address.postalCode, expiresAt };
      quotes.push({ ...signed, storeName: vendor.business_name, courierName: selected.courierName, serviceName: selected.serviceName, signature: signQuote(signed) });
    }
    return json(200, { ok: true, quotes, totalCents: quotes.reduce((sum, quote) => sum + quote.amountCents, 0), expiresAt });
  } catch (error) { return json(502, { error: error.message }); }
};
