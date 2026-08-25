import {
  authenticatedUser,
  json,
  preflight,
  required,
  rpc,
  supabaseRequest,
} from "../_shared/runtime.ts";

const encoder = new TextEncoder();

function canonicalQuote(quote: any): string {
  return [
    quote.vendorId,
    quote.rateId,
    quote.serviceLevelCode,
    quote.providerSlug,
    quote.amountCents,
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
      // Create order + reservations using Paystack RPC.
      // ------------------------------------------------------

      const order =
        await rpc(
          "create_paystack_checkout",
          {
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

      const paystackBody:
        Record<
          string,
          unknown
        > = {
          email:
            order.customerEmail,

          amount:
            String(
              order.amountCents,
            ),

          currency: "ZAR",

          reference:
            order.publicReference,

          callback_url:
            `${siteUrl}/payment-success`,

          metadata:
            JSON.stringify({
              orderId:
                order.orderId,

              publicReference:
                order
                  .publicReference,
            }),
        };

      const splits =
        Array.isArray(
          order.splits,
        )
          ? order.splits
          : [];

      // VENDOR_LIABILITY_RECOVERY_V1
      const recoveryPlan = await rpc("reserve_vendor_liability_recoveries",{p_order_id:order.orderId});
      const recoveryBySubaccount = new Map((Array.isArray(recoveryPlan)?recoveryPlan:[]).map((x:any)=>[String(x?.subaccount||""),Math.max(0,Number(x?.deductionCents||0))]));
      const adjustedSplits = splits.map((s:any)=>({...s,share:Math.max(0,Number(s?.share||0)-(recoveryBySubaccount.get(String(s?.subaccount||""))||0))})).filter((s:any)=>s.subaccount&&Number(s.share)>0);

      // Dynamic flat split:
      // outside vendors receive their vendor-net merchandise.
      // Kompo retains commission + delivery + platform-owned sales.
      if (adjustedSplits.length) {
        paystackBody.split = {
          type: "flat",

          bearer_type:
            "account",

          subaccounts:
            adjustedSplits.map(
              (split: any) => ({
                subaccount:
                  split
                    .subaccount,

                share:
                  Number(
                    split.share,
                  ),
              }),
            ),
        };
      }

      // ------------------------------------------------------
      // Initialize transaction with Paystack.
      // ------------------------------------------------------

      const paystackResponse =
        await fetch(
          "https://api.paystack.co/transaction/initialize",
          {
            method: "POST",

            headers: {
              Authorization:
                `Bearer ${
                  required(
                    "PAYSTACK_SECRET_KEY",
                  )
                }`,

              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                paystackBody,
              ),
          },
        );

      const paystack =
        await paystackResponse
          .json();

      if (
        !paystackResponse.ok ||
        !paystack?.status ||
        !paystack?.data
          ?.authorization_url ||
        !paystack?.data
          ?.reference
      ) {
        throw new Error(
          paystack?.message ||
          "Paystack could not initialize the payment.",
        );
      }

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
              "paystack",

            provider_payload: {
              initialization:
                paystack.data,
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
            paystack.data
              .authorization_url,

          accessCode:
            paystack.data
              .access_code,

          reference:
            paystack.data
              .reference,

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
