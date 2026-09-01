import {
  authenticatedUser,
  json,
  preflight,
  required,
  signQuote,
  supabaseRequest,
} from "../_shared/runtime.ts";

type Address = {
  company?: string;
  streetAddress: string;
  localArea?: string;
  city: string;
  province: string;
  postalCode: string;
  country?: string;
};

type CartLine = {
  productId: string;
  quantity: number;
  size: string;
  colour: string;
};

type Contact = {
  fullName: string;
  phone: string;
  email: string;
};

function mapAddress(address: Address) {
  return {
    company: address.company || "",
    street_address: address.streetAddress,
    local_area: address.localArea || "",
    city: address.city,
    zone: address.province,
    country: address.country || "ZA",
    code: address.postalCode,
  };
}

// STANDARD_PACKAGE_SHIPPING_V1
function buildStandardParcels(lines: any[], settings: any, vendorId: string) {
  const length = Number(settings?.package_length_cm);
  const width = Number(settings?.package_width_cm);
  const height = Number(settings?.package_height_cm);
  const tare = Math.max(0, Number(settings?.package_tare_weight_kg || 0));
  const capacity = Math.max(1, Math.floor(Number(settings?.package_item_capacity || 3)));
  if (![length,width,height].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Set the store's standard shipping package dimensions before requesting delivery rates.");

  const units: any[] = [];
  for (const item of lines) {
    const quantity = Math.max(0, Math.floor(Number(item?.line?.quantity || 0)));
    const weightKg = Number(item?.variant?.weight_kg);
    if (!Number.isFinite(weightKg) || weightKg <= 0) throw new Error(`${item?.product?.name || "An item"} needs a valid item weight before shipping can be quoted.`);
    for (let index = 0; index < quantity; index += 1) units.push({ name:item.product.name, sku:item.variant.sku, weightKg });
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
      custom_parcel_reference: `${vendorId.slice(0,8)}-P${parcels.length + 1}`,
    });
  }
  return parcels;
}

Deno.serve(async (request: Request) => {
  const cors = preflight(request);

  if (cors) {
    return cors;
  }

  if (request.method !== "POST") {
    return json(request, 405, {
      error: "Method not allowed.",
    });
  }

  try {
    await authenticatedUser(request);

    const body = await request.json();

    const lines: CartLine[] = body.lines || [];
    const address: Address = body.address || {};
    const contact: Contact = body.contact || {};

    if (
      !lines.length ||
      !address.streetAddress ||
      !address.postalCode ||
      !contact.email ||
      !contact.phone
    ) {
      return json(request, 400, {
        error:
          "Cart, contact and complete delivery details are required.",
      });
    }

    const ids = [
      ...new Set(
        lines.map((line) => String(line.productId)),
      ),
    ];

    const select =
      "id,vendor_id,name,status," +
      "vendors(id,business_name,status," +
      "vendor_private_settings(" +
      "contact_email," +
      "contact_phone," +
      "collection_street_address," +
      "collection_local_area," +
      "collection_city," +
      "collection_province," +
      "collection_postal_code," +
      "collection_country_code,package_length_cm,package_width_cm,package_height_cm,package_tare_weight_kg,package_item_capacity))," +
      "product_variants(" +
      "id,sku,size,colour,price_cents," +
      "stock_quantity,weight_kg,length_cm," +
      "width_cm,height_cm,active)";

    const products = await supabaseRequest(
      `products?select=${
        encodeURIComponent(select)
      }&id=in.(${ids.join(",")})`,
    );

    const groups = new Map<
      string,
      {
        vendor: any;
        lines: Array<{
          line: CartLine;
          product: any;
          variant: any;
        }>;
      }
    >();

    for (const line of lines) {
      const product = products.find(
        (item: any) =>
          String(item.id) === String(line.productId),
      );

      const variants = Array.isArray(
          product?.product_variants
        )
        ? product.product_variants
        : [];

      const variant = variants.find(
        (item: any) =>
          item.size === line.size &&
          item.colour === line.colour &&
          item.active,
      );

      if (
        !product ||
        product.status !== "active" ||
        !variant ||
        Number(line.quantity) < 1 ||
        Number(variant.stock_quantity) <
          Number(line.quantity)
      ) {
        return json(request, 409, {
          error:
            "Your bag contains an unavailable piece.",
        });
      }

      const vendorId = String(product.vendor_id);

      const group = groups.get(vendorId) || {
        vendor: product.vendors,
        lines: [],
      };

      group.lines.push({
        line,
        product,
        variant,
      });

      groups.set(vendorId, group);
    }

    const expiresAt = new Date(
      Date.now() + 15 * 60 * 1000,
    ).toISOString();

    const quotes: any[] = [];

    for (const [vendorId, group] of groups) {
      const vendor = Array.isArray(group.vendor)
        ? group.vendor[0]
        : group.vendor;

      const privateSettings = Array.isArray(
          vendor?.vendor_private_settings
        )
        ? vendor.vendor_private_settings[0]
        : vendor?.vendor_private_settings;

      if (
        !vendor ||
        vendor.status !== "active"
      ) {
        return json(request, 409, {
          error:
            "One store is not accepting orders.",
        });
      }

      let selected = {
        rateId: `fixed-${vendorId}`,
        serviceLevelCode: "ECO",
        providerSlug: "fixed",
        courierName: "Nationwide delivery",
        serviceName: "Door-to-door delivery",
        collectionCutoffTime: "",
        amountCents: Number(
          Deno.env.get(
            "DEFAULT_DELIVERY_CENTS",
          ) || "9900",
        ),
      };

      const bobGoToken = Deno.env.get(
        "BOBGO_API_TOKEN",
      );

      if (bobGoToken) {
        if (
          !privateSettings
            ?.collection_street_address ||
          !privateSettings.collection_city ||
          !privateSettings
            .collection_postal_code
        ) {
          return json(request, 409, {
            error:
              `${vendor.business_name} must complete its collection address.`,
          });
        }

        const collectionAddress: Address = {
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
              .collection_province || "",
          postalCode:
            privateSettings
              .collection_postal_code,
          country:
            privateSettings
              .collection_country_code || "ZA",
        };

        const declaredValue =
          group.lines.reduce(
            (
              sum,
              { line, variant },
            ) =>
              sum +
              Number(variant.price_cents) *
                Number(line.quantity),
            0,
          );

        const payload = {
          collection_address:
            mapAddress(collectionAddress),

          delivery_address:
            mapAddress(address),

          parcels: buildStandardParcels(group.lines, privateSettings, String(vendorId)),

          collection_contact_mobile_number:
            privateSettings.contact_phone ||
            required(
              "DEFAULT_COLLECTION_PHONE",
            ),

          collection_contact_email:
            privateSettings.contact_email ||
            required(
              "DEFAULT_COLLECTION_EMAIL",
            ),

          collection_contact_full_name:
            vendor.business_name,

          delivery_contact_mobile_number:
            contact.phone,

          delivery_contact_email:
            contact.email,

          delivery_contact_full_name:
            contact.fullName,

          declared_value:
            declaredValue / 100,

          timeout: 10000,
        };

        const bobGoBase = (
          Deno.env.get(
            "BOBGO_API_BASE_URL",
          ) ||
          "https://api.sandbox.bobgo.co.za/v2"
        ).replace(/\/$/, "");

        const response = await fetch(
          `${bobGoBase}/rates`,
          {
            method: "POST",
            headers: {
              Authorization:
                `Bearer ${bobGoToken}`,
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify(payload),
          },
        );

        const rates = await response.json();

        if (!response.ok) {
          throw new Error(
            rates?.message ||
            rates?.error ||
            `Courier rates failed for ${vendor.business_name}.`
          );
        }

        const rateOptions = (Array.isArray(rates?.provider_rate_requests)
          ? rates.provider_rate_requests
          : [])
          .flatMap((providerRequest: any) => {
            if (providerRequest?.status !== "success") return [];

            const providerSlug = String(providerRequest?.provider_slug || "");
            const courierName = String(
              providerRequest?.provider_name ||
              providerRequest?.provider_slug ||
              "Courier"
            );

            return (Array.isArray(providerRequest?.responses)
              ? providerRequest.responses
              : [])
              .filter((service: any) =>
                service?.status === "success" &&
                Number(service?.rate_amount) > 0
              )
              .map((service: any) => ({
                rateId:
                  `${providerRequest?.rate_response_id || providerSlug}:${service?.service_level_code || "service"}`,
                serviceLevelCode: String(
                  service?.service_level_code || ""
                ),
                providerSlug,
                courierName,
                serviceName: String(
                  service?.service_level?.name ||
                  service?.service_level_name ||
                  service?.service_level_code ||
                  "Courier delivery"
                ),
                amountCents: Math.round(
                  Number(service?.rate_amount || 0) * 100
                ),

                // BOBGO_COLLECTION_METADATA_V1
                collectionCutoffTime: String(
                  service?.service_level?.collection_cut_off_time || ""
                ),
              }));
          })
          .filter((item: any) =>
            item.providerSlug &&
            item.serviceLevelCode &&
            item.amountCents > 0
          )
          .sort(
            (a: any, b: any) =>
              a.amountCents - b.amountCents
          );

        const rate = rateOptions[0];

        if (!rate) {
          const providerFailures = (
            Array.isArray(rates?.provider_rate_requests)
              ? rates.provider_rate_requests
              : []
          )
            .filter((item: any) => item?.failed_reason)
            .map(
              (item: any) =>
                `${item.provider_name || item.provider_slug}: ${item.failed_reason}`
            );

          console.error(
            "BOBGO_NO_USABLE_RATE",
            JSON.stringify({
              providerCount: Array.isArray(rates?.provider_rate_requests)
                ? rates.provider_rate_requests.length
                : 0,
              failures: providerFailures,
            })
          );

          throw new Error(
            `No courier service is available for ${vendor.business_name}.`
          );
        }

        selected = rate;
      } else if (
        Deno.env.get(
          "ALLOW_FIXED_DELIVERY",
        ) !== "true"
      ) {
        return json(request, 503, {
          error:
            "Live courier quoting is not configured.",
        });
      }

      // DELIVERY_PRICING_V1
      const courierCostCents =
        Math.max(
          0,
          Number(selected.amountCents || 0),
        );

      const customerDeliveryCents =
        courierCostCents <= 10000
          ? 10000
          : courierCostCents < 16000
            ? Math.min(
                16000,
                Math.round(
                  courierCostCents * 1.10,
                ),
              )
            : courierCostCents;

      const logisticsFeeCents =
        Math.max(
          0,
          customerDeliveryCents -
            courierCostCents,
        );

      const signed = {
        vendorId,
        rateId: selected.rateId,
        serviceLevelCode:
          selected.serviceLevelCode,
        providerSlug:
          selected.providerSlug,

        // This is the amount the customer actually pays.
        // It is included in the signed quote and cannot be
        // reduced by changing browser-side checkout code.
        amountCents:
          customerDeliveryCents,

        // These components are signed as well, because settlement reporting
        // must not trust browser-editable courier cost or margin fields.
        courierCostCents,
        logisticsFeeCents,

        destinationPostalCode:
          address.postalCode,

        expiresAt,
      };

      quotes.push({
        ...signed,

        storeName:
          vendor.business_name,

        courierName:
          selected.courierName,

        serviceName:
          selected.serviceName,

        collectionCutoffTime:
          String(
            selected.collectionCutoffTime ||
            "",
          ),

        signature:
          await signQuote(signed),
      });
    }

    return json(request, 200, {
      ok: true,
      quotes,
      totalCents: quotes.reduce(
        (sum, quote) =>
          sum +
          Number(quote.amountCents),
        0,
      ),
      expiresAt,
    });
  } catch (error) {
    console.error(
      "shipping-quote failed:",
      error,
    );

    return json(request, 502, {
      error:
        error instanceof Error
          ? error.message
          : "Delivery quote failed.",
    });
  }
});
