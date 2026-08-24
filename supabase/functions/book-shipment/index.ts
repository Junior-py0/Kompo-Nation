import {
  authenticatedUser,
  json,
  preflight,
  required,
  supabaseRequest,
} from "../_shared/runtime.ts";

function mapAddress(address: any) {
  return {
    company: address?.company || "",
    street_address: address?.streetAddress || "",
    local_area: address?.localArea || "",
    city: address?.city || "",
    zone: address?.province || "",
    country: address?.country || "ZA",
    code: address?.postalCode || "",
  };
}

// STANDARD_PACKAGE_SHIPPING_V1
function buildBookedParcels(orderItems: any[], settings: any, reference: string) {
  const length = Number(settings?.package_length_cm);
  const width = Number(settings?.package_width_cm);
  const height = Number(settings?.package_height_cm);
  const tare = Math.max(0, Number(settings?.package_tare_weight_kg || 0));
  const capacity = Math.max(1, Math.floor(Number(settings?.package_item_capacity || 3)));
  if (![length,width,height].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Set the store's standard shipping package dimensions before booking collection.");

  const units: any[] = [];
  for (const item of orderItems || []) {
    const variant = Array.isArray(item.product_variants) ? item.product_variants[0] : item.product_variants;
    const weightKg = Number(variant?.weight_kg);
    const quantity = Math.max(0, Math.floor(Number(item.quantity || 0)));
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error(`${item.product_name || "An item"} needs a valid item weight before collection can be booked.`);
    for (let index = 0; index < quantity; index += 1) units.push({ name:item.product_name, sku:item.sku, weightKg });
  }

  const parcels: any[] = [];
  for (let start = 0; start < units.length; start += capacity) {
    const chunk = units.slice(start, start + capacity);
    const names = [...new Set(chunk.map((unit) => unit.name))].join(", ");
    parcels.push({
      description: `${chunk.length} item${chunk.length === 1 ? "" : "s"}: ${names}`.slice(0, 180),
      submitted_length_cm: length,
      submitted_width_cm: width,
      submitted_height_cm: height,
      submitted_weight_kg: Number((tare + chunk.reduce((sum, unit) => sum + unit.weightKg, 0)).toFixed(3)),
      custom_parcel_reference: `${reference}-P${parcels.length + 1}`,
    });
  }
  return parcels;
}

Deno.serve(async (request: Request) => {
  const cors = preflight(request);
  if (cors) return cors;

  if (request.method !== "POST") {
    return json(request, 405, {
      error: "Method not allowed.",
    });
  }

  try {
    const { token } =
      await authenticatedUser(request);

    const body = await request.json();
    const vendorOrderId =
      String(body.vendorOrderId || "");

    if (!vendorOrderId) {
      return json(request, 400, {
        error: "Vendor order is required.",
      });
    }

    // First check access using the signed-in user's RLS.
    const visible = await supabaseRequest(
      `vendor_orders?select=id&id=eq.${
        encodeURIComponent(vendorOrderId)
      }&limit=1`,
      {
        service: false,
        token,
      },
    );

    if (!visible.length) {
      return json(request, 403, {
        error:
          "This account cannot book that package.",
      });
    }

    const select =
      "id,public_reference,fulfilment_status," +
      "merchandise_total_cents,shipping_quote," +
      "vendors(id,business_name," +
      "vendor_private_settings(" +
      "contact_email,contact_phone," +
      "collection_street_address," +
      "collection_local_area,collection_city," +
      "collection_province," +
      "collection_postal_code," +
      "collection_country_code,package_length_cm,package_width_cm,package_height_cm,package_tare_weight_kg,package_item_capacity))," +
      "orders(customer_name,customer_email," +
      "customer_phone,delivery_address)," +
      "order_items(quantity,product_name,sku," +
      "product_variants(weight_kg,length_cm," +
      "width_cm,height_cm))";

    const rows = await supabaseRequest(
      `vendor_orders?select=${
        encodeURIComponent(select)
      }&id=eq.${
        encodeURIComponent(vendorOrderId)
      }&limit=1`,
    );

    const order = rows?.[0];

    if (
      !order ||
      !["packed", "ready_for_collection"]
        .includes(order.fulfilment_status)
    ) {
      return json(request, 409, {
        error:
          "Package must be packed before collection can be booked.",
      });
    }

    const existing = await supabaseRequest(
      `shipments?select=*&vendor_order_id=eq.${
        encodeURIComponent(vendorOrderId)
      }&limit=1`,
    );

    if (
      existing.length &&
      existing[0].provider_shipment_id
    ) {
      return json(request, 200, {
        ok: true,
        shipment: existing[0],
        alreadyBooked: true,
      });
    }

    const vendor =
      Array.isArray(order.vendors)
        ? order.vendors[0]
        : order.vendors;

    const privateSettings =
      Array.isArray(
          vendor?.vendor_private_settings
        )
        ? vendor.vendor_private_settings[0]
        : vendor?.vendor_private_settings;

    const parent =
      Array.isArray(order.orders)
        ? order.orders[0]
        : order.orders;

    if (
      !vendor ||
      !parent ||
      !privateSettings
        ?.collection_street_address ||
      !privateSettings.contact_phone ||
      !privateSettings.contact_email
    ) {
      return json(request, 409, {
        error:
          "Complete the store collection address and contact details first.",
      });
    }

    const destination =
      parent.delivery_address;

    const quote =
      order.shipping_quote || {};

    const parcels = buildBookedParcels(order.order_items, privateSettings, order.public_reference || vendorOrderId);

    const payload = {
      collection_address: mapAddress({
        company: vendor.business_name,

        streetAddress:
          privateSettings
            .collection_street_address,

        localArea:
          privateSettings
            .collection_local_area || "",

        city:
          privateSettings.collection_city,

        province:
          privateSettings
            .collection_province,

        postalCode:
          privateSettings
            .collection_postal_code,

        country:
          privateSettings
            .collection_country_code ||
          "ZA",
      }),

      collection_contact_name:
        vendor.business_name,

      collection_contact_mobile_number:
        privateSettings.contact_phone,

      collection_contact_email:
        privateSettings.contact_email,

      delivery_address:
        mapAddress(destination),

      delivery_contact_name:
        parent.customer_name,

      delivery_contact_mobile_number:
        parent.customer_phone,

      delivery_contact_email:
        parent.customer_email,

      parcels,

      declared_value:
        Number(
          order.merchandise_total_cents,
        ) / 100,

      timeout: 20000,

      custom_order_number:
        order.public_reference,

      service_level_code:
        quote.serviceLevelCode,

      provider_slug:
        quote.providerSlug,
    };

    const bobGoBase = (
      Deno.env.get(
        "BOBGO_API_BASE_URL",
      ) ||
      "https://api.sandbox.bobgo.co.za/v2"
    ).replace(/\/$/, "");

    const response = await fetch(
      `${bobGoBase}/shipments`,
      {
        method: "POST",
        headers: {
          Authorization:
            `Bearer ${
              required(
                "BOBGO_API_TOKEN",
              )
            }`,
          "Content-Type":
            "application/json",
        },
        body:
          JSON.stringify(payload),
      },
    );

    const shipment =
      await response.json();

    if (!response.ok) {
      throw new Error(
        shipment?.message ||
        "Bob Go did not accept the booking.",
      );
    }

    const providerShipmentId =
      shipment.id ||
      shipment.shipment_id;

    if (!providerShipmentId) {
      throw new Error(
        "Bob Go returned no shipment identity.",
      );
    }

    const row = {
      vendor_order_id:
        vendorOrderId,

      provider: "bobgo",

      provider_shipment_id:
        String(providerShipmentId),

      tracking_reference:
        shipment.tracking_reference ||
        shipment.tracking_number ||
        null,

      tracking_url:
        shipment.tracking_url ||
        null,

      courier_name:
        shipment.provider_name ||
        shipment.courier_name ||
        quote.courierName ||
        null,

      service_name:
        shipment.service_level_name ||
        quote.serviceName ||
        null,

      status: "booked",

      cost_cents:
        quote.amountCents || null,

      provider_payload:
        shipment,

      updated_at:
        new Date().toISOString(),
    };

    const saved =
      await supabaseRequest(
        "shipments?on_conflict=vendor_order_id",
        {
          method: "POST",
          body: row,
          headers: {
            Prefer:
              "resolution=merge-duplicates,return=representation",
          },
        },
      );

    await supabaseRequest(
      `vendor_orders?id=eq.${
        encodeURIComponent(
          vendorOrderId,
        )
      }`,
      {
        method: "PATCH",
        body: {
          fulfilment_status:
            "booked",
          updated_at:
            new Date()
              .toISOString(),
        },
      },
    );

    return json(request, 200, {
      ok: true,
      shipment:
        saved?.[0] || row,
      alreadyBooked: false,
    });
  } catch (error) {
    console.error(
      "book-shipment failed:",
      error,
    );

    return json(request, 502, {
      error:
        error instanceof Error
          ? error.message
          : "Shipment booking failed.",
    });
  }
});
