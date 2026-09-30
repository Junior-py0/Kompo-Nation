import {
  authenticatedUser,
  json,
  preflight,
  required,
  rpc,
  supabaseRequest,
} from "../_shared/runtime.ts";
import {
  allowsPlatformCollection,
  configuredPaymentProvider,
  initializePayment,
} from "../_shared/payments.ts";

const encoder = new TextEncoder();

function canonicalQuote(quote: any): string {
  return [
    quote.vendorId,
    quote.rateId,
    quote.serviceLevelCode,
    quote.providerSlug,
    quote.amountCents,
    quote.courierCostCents,
    quote.logisticsFeeCents,
    quote.destinationPostalCode,
    quote.expiresAt,
  ].join("|");
}

function constantTimeEqual(
  left: string,
  right: string,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let difference = 0;

  for (let i = 0; i < left.length; i += 1) {
    difference |=
      left.charCodeAt(i) ^
      right.charCodeAt(i);
  }

  return difference === 0;
}

async function hmacHex(
  algorithm: string,
  secret: string,
  message: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      name: "HMAC",
      hash: algorithm,
    },
    false,
    ["sign"],
  );

  const signature =
    await crypto.subtle.sign(
      "HMAC",
      key,
      encoder.encode(message),
    );

  return Array.from(
    new Uint8Array(signature),
  )
    .map((byte) =>
      byte.toString(16).padStart(2, "0")
    )
    .join("");
}

async function verifyQuote(
  quote: any,
): Promise<boolean> {
  if (
    !quote?.signature ||
    !quote?.expiresAt ||
    new Date(
      quote.expiresAt,
    ).getTime() <= Date.now()
  ) {
    return false;
  }

  const expected =
    await hmacHex(
      "SHA-256",
      required(
        "QUOTE_SIGNING_SECRET",
      ),
      canonicalQuote(quote),
    );

  return constantTimeEqual(
    expected,
    String(quote.signature),
  );
}

// CHECKOUT_TERMS_SERVER_V1
const CURRENT_TERMS_VERSION =
  "1.0";


Deno.serve(
  async (request: Request) => {
    const cors =
      preflight(request);

    if (cors) return cors;

    if (
      request.method !== "POST"
    ) {
      return json(
        request,
        405,
        {
          error:
            "Method not allowed.",
        },
      );
    }

    try {
      const { user } =
        await authenticatedUser(
          request,
        );

      const body =
        await request.json();

      if (
        !Array.isArray(
          body.lines,
        ) ||
        body.lines.length === 0 ||
        !Array.isArray(
          body.quotes,
        ) ||
        body.quotes.length === 0 ||
        !body.address
          ?.postalCode ||
        !body.contact?.email ||
        !body.contact?.phone
      ) {
        return json(
          request,
          400,
          {
            error:
              "Checkout details are incomplete.",
          },
        );
      }

      if (
        body.contact.email
          .toLowerCase() !==
        String(
          user.email || "",
        ).toLowerCase()
      ) {
        return json(
          request,
          400,
          {
            error:
              "Checkout email does not match the signed-in account.",
          },
        );
      }

      // ------------------------------------------------------

      // ------------------------------------------------------
      // Current Terms acceptance.
      //
      // The acceptance ID is single-use for an order:
      // - correct signed-in user
      // - checkout context
      // - current terms version
      // - recent acceptance
      // - not already bound to another order
      // ------------------------------------------------------

      const termsAcceptanceId =
        String(
          body.termsAcceptanceId ||
          "",
        );


      if (
        body.termsVersion !==
          CURRENT_TERMS_VERSION ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(
            termsAcceptanceId,
          )
      ) {
        return json(
          request,
          428,
          {
            error:
              "Accept the current Terms of Service before continuing.",
          },
        );
      }


      const acceptanceRows =
        await supabaseRequest(
          `terms_acceptances?select=id,accepted_at,user_id,terms_version,acceptance_context,order_id&id=eq.${
            encodeURIComponent(
              termsAcceptanceId,
            )
          }&user_id=eq.${
            encodeURIComponent(
              user.id,
            )
          }&terms_version=eq.${
            encodeURIComponent(
              CURRENT_TERMS_VERSION,
            )
          }&acceptance_context=eq.checkout&order_id=is.null&limit=1`,
        );


      const acceptance =
        Array.isArray(
          acceptanceRows,
        )
          ? acceptanceRows[0]
          : null;


      const acceptedAt =
        acceptance?.accepted_at
          ? Date.parse(
              acceptance.accepted_at,
            )
          : NaN;


      if (
        !acceptance ||
        !Number.isFinite(
          acceptedAt,
        ) ||
        Date.now() - acceptedAt >
          2 * 60 * 60 * 1000
      ) {
        return json(
          request,
          428,
          {
            error:
              "Your Terms acceptance expired. Review the order and accept the Terms again.",
          },
        );
      }


      // Verify signed shipping quotes.
      // ------------------------------------------------------

      for (
        const quote
        of body.quotes
      ) {
        if (
          !(await verifyQuote(
            quote,
          )) ||
          quote
              .destinationPostalCode !==
            body.address.postalCode
        ) {
          return json(
            request,
            409,
            {
              error:
                "The delivery quote is invalid or expired. Request a new quote.",
            },
          );
        }
      }

      // ------------------------------------------------------
      // Ensure exactly one quote exists per vendor in the cart.
      // ------------------------------------------------------

      const productIds = [
        ...new Set(
          body.lines.map(
            (line: any) =>
              String(
                line.productId,
              ),
          ),
        ),
      ];

      const products =
        await supabaseRequest(
          `products?select=id,vendor_id&id=in.(${
            productIds.join(",")
          })`,
        );

      if (
        products.length !==
        productIds.length
      ) {
        return json(
          request,
          409,
          {
            error:
              "One or more products are no longer available.",
          },
        );
      }

      const expectedVendors =
        new Set(
          products.map(
            (product: any) =>
              String(
                product.vendor_id,
              ),
          ),
        );

      const paymentProvider =
        configuredPaymentProvider();

      const vendors =
        await supabaseRequest(
          `vendors?select=id,is_platform_owned&id=in.(${
            [...expectedVendors].join(",")
          })`,
        );

      if (vendors.length !== expectedVendors.size) {
        return json(
          request,
          409,
          {
            error:
              "One or more stores are no longer available.",
          },
        );
      }

      const hasExternalVendors =
        vendors.some(
          (vendor: any) =>
            !vendor.is_platform_owned,
        );

      if (
        paymentProvider !== "paystack" &&
        hasExternalVendors &&
        !allowsPlatformCollection()
      ) {
        return json(
          request,
          503,
          {
            error:
              `${paymentProvider} checkout for outside stores is disabled until platform collection and manual vendor payouts are approved.`,
          },
        );
      }

      const quotedVendors =
        new Set(
          body.quotes.map(
            (quote: any) =>
              String(
                quote.vendorId,
              ),
          ),
        );

      if (
        quotedVendors.size !==
          body.quotes.length ||
        quotedVendors.size !==
          expectedVendors.size ||
        [
          ...expectedVendors,
        ].some(
          (vendorId) =>
            !quotedVendors.has(
              vendorId,
            ),
        )
      ) {
        return json(
          request,
          409,
          {
            error:
              "Delivery quotes do not match the stores in this bag.",
          },
        );
      }

      // ------------------------------------------------------
      // Create an order and reservations for the active payment provider.
      // ------------------------------------------------------

      const order =
        await rpc(
          "create_payment_checkout_v4",
          {
            p_provider:
              paymentProvider,

            p_customer_id:
              user.id,

            p_lines:
              body.lines,

            p_address:
              body.address,

            p_contact:
              body.contact,

            p_quotes:
              body.quotes,

            p_discount_code:
              String(
                body.discountCode ||
                "",
              ).trim() || null,
          },
        );

      if (
        !order?.orderId ||
        !order?.publicReference ||
        !Number(
          order.amountCents,
        )
      ) {
        throw new Error(
          "Checkout creation returned an invalid order.",
        );
      }


      // Bind this acceptance to this specific order.
      // It cannot be replayed for another checkout.

      await supabaseRequest(
        `terms_acceptances?id=eq.${
          encodeURIComponent(
            termsAcceptanceId,
          )
        }`,
        {
          method:
            "PATCH",

          body: {
            order_id:
              order.orderId,
          },
        },
      );


      const siteUrl =
        required(
          "SITE_URL",
        ).replace(/\/$/, "");

      const splits =
        Array.isArray(
          order.splits,
        )
          ? order.splits
          : [];

      let adjustedSplits: Array<{
        subaccount: string;
        share: number;
      }> = [];

      // Paystack remains responsible for automated vendor splits and liability
      // deductions. Stitch collects into Kompo's merchant account; outside-vendor
      // settlement is therefore an explicit manual/platform process.
      if (paymentProvider === "paystack") {
        const recoveryPlan = await rpc(
          "reserve_vendor_liability_recoveries",
          { p_order_id: order.orderId },
        );
        const recoveryBySubaccount = new Map<string, number>(
          (Array.isArray(recoveryPlan) ? recoveryPlan : []).map(
            (entry: any): [string, number] => [
              String(entry?.subaccount || ""),
              Math.max(0, Number(entry?.deductionCents || 0)),
            ],
          ),
        );

        adjustedSplits = splits.map((split: any) => ({
          subaccount: String(split?.subaccount || ""),
          share: Math.max(
            0,
            Number(split?.share || 0) -
              (recoveryBySubaccount.get(String(split?.subaccount || "")) || 0),
          ),
        })).filter((split: any) => split.subaccount && split.share > 0);
      }

      const initialization =
        await initializePayment({
          provider:
            paymentProvider,

          email:
            order.customerEmail,

          amountCents:
            Number(order.amountCents),

          reference:
            order.publicReference,

          orderId:
            order.orderId,

          customerId:
            user.id,

          fullName:
            order.customerName,

          phone:
            order.customerPhone,

          expiresAt:
            order.expiresAt,

          successUrl:
            `${siteUrl}/payment-success`,

          cancelUrl:
            `${siteUrl}/payment-cancelled`,

          metadata: {
            payment_kind:
              "marketplace_order",

            discount_code:
              order.discountCode ||
              undefined,

            discount_total_cents:
              Number(
                order.discountTotalCents ||
                0,
              ),

            settlement_mode:
              paymentProvider !== "paystack"
                ? "platform_collection"
                : "provider_split",
          },

          paystackSplits:
            adjustedSplits,
        });

      // Save initialization response for traceability.
      await supabaseRequest(
        `payments?order_id=eq.${
          encodeURIComponent(
            order.orderId,
          )
        }`,
        {
          method: "PATCH",

          body: {
            provider:
              paymentProvider,

            provider_reference:
              initialization
                .providerReference,

            provider_payload: {
              initialization:
                initialization
                  .providerPayload,

              settlementMode:
                paymentProvider !== "paystack"
                  ? "platform_collection"
                  : "provider_split",
            },

            updated_at:
              new Date()
                .toISOString(),
          },
        },
      );

      return json(
        request,
        200,
        {
          ok: true,

          authorizationUrl:
            initialization
              .authorizationUrl,

          accessCode:
            initialization
              .accessCode,

          reference:
            initialization
              .providerReference,

          provider:
            paymentProvider,

          orderReference:
            order
              .publicReference,

          expiresAt:
            order.expiresAt,
        },
      );
    } catch (error) {
      console.error(
        "create-checkout failed:",
        error,
      );

      return json(
        request,
        400,
        {
          error:
            error instanceof Error
              ? error.message
              : "Checkout failed.",
        },
      );
    }
  },
);
