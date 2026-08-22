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
      "collection_country_code))," +
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

          parcels: group.lines.map(
            ({
              line,
              product,
              variant,
            }) => ({
              description:
                `${product.name} × ${line.quantity}`,

              submitted_length_cm:
                Number(variant.length_cm),

              submitted_width_cm:
                Number(variant.width_cm),

              submitted_height_cm:
                Number(variant.height_cm),

              submitted_weight_kg:
                Number(variant.weight_kg) *
                Number(line.quantity),

              custom_parcel_reference:
                variant.sku,
            }),
          ),

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
              `Courier rates failed for ${vendor.business_name}.`,
          );
        }

        const availableRates =
          Array.isArray(rates)
            ? rates
            : Array.isArray(rates?.rates)
            ? rates.rates
            : [];

        const rate = availableRates
          .map(
            (
              item: any,
              index: number,
            ) => ({
              rateId: String(
                item.id ||
                  `${
                    item.provider_slug ||
                    "courier"
                  }-${index}`,
              ),

              serviceLevelCode:
                String(
                  item.service_level_code ||
                    item.service_level_id ||
                    "ECO",
                ),

              providerSlug:
                String(
                  item.provider_slug ||
                    item.provider ||
                    "",
                ),

              courierName:
                String(
                  item.provider_name ||
                    item.courier_name ||
                    item.provider_slug ||
                    "Courier",
                ),

              serviceName:
                String(
                  item.service_level_name ||
                    item.service_name ||
                    "Courier delivery",
                ),

              amountCents:
                Math.round(
                  Number(
                    item.rate ||
                      item.total ||
                      item.amount ||
                      0,
                  ) * 100,
                ),
            }),
          )
          .filter(
            (item: any) =>
              item.amountCents > 0,
          )
          .sort(
            (a: any, b: any) =>
              a.amountCents -
              b.amountCents,
          )[0];

        if (!rate) {
          throw new Error(
            `No courier service is available for ${vendor.business_name}.`,
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

      const signed = {
        vendorId,
        rateId: selected.rateId,
        serviceLevelCode:
          selected.serviceLevelCode,
        providerSlug:
          selected.providerSlug,
        amountCents:
          selected.amountCents,
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
