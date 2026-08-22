import {
  json,
  required,
  rpc,
  supabaseRequest,
} from "../_shared/runtime.ts";

const encoder = new TextEncoder();

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

function constantTimeEqual(
  left: string,
  right: string,
): boolean {
  if (
    left.length !== right.length
  ) {
    return false;
  }

  let difference = 0;

  for (
    let i = 0;
    i < left.length;
    i += 1
  ) {
    difference |=
      left.charCodeAt(i) ^
      right.charCodeAt(i);
  }

  return difference === 0;
}

Deno.serve(
  async (request: Request) => {
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
      // IMPORTANT:
      // Signature must be calculated over the raw request body.
      const raw =
        await request.text();

      const receivedSignature =
        request.headers.get(
          "x-paystack-signature",
        ) || "";

      if (!receivedSignature) {
        return json(
          request,
          401,
          {
            error:
              "Missing Paystack signature.",
          },
        );
      }

      const expectedSignature =
        await hmacHex(
          "SHA-512",
          required(
            "PAYSTACK_SECRET_KEY",
          ),
          raw,
        );

      if (
        !constantTimeEqual(
          expectedSignature,
          receivedSignature,
        )
      ) {
        return json(
          request,
          401,
          {
            error:
              "Invalid Paystack signature.",
          },
        );
      }

      const event =
        JSON.parse(
          raw || "{}",
        );

      // We only finalize successful charges.
      if (
        event.event !==
        "charge.success"
      ) {
        return json(
          request,
          200,
          {
            ok: true,
            ignored: true,
          },
        );
      }

      const reference =
        String(
          event.data
            ?.reference ||
          "",
        );

      if (!reference) {
        return json(
          request,
          400,
          {
            error:
              "Paystack transaction reference is missing.",
          },
        );
      }

      // ------------------------------------------------------
      // Verify transaction directly with Paystack.
      // A browser redirect/webhook payload alone is not enough.
      // ------------------------------------------------------

      const verifyResponse =
        await fetch(
          `https://api.paystack.co/transaction/verify/${
            encodeURIComponent(
              reference,
            )
          }`,
          {
            headers: {
              Authorization:
                `Bearer ${
                  required(
                    "PAYSTACK_SECRET_KEY",
                  )
                }`,
            },
          },
        );

      const verification =
        await verifyResponse
          .json();

      if (
        !verifyResponse.ok ||
        !verification?.status
      ) {
        throw new Error(
          verification?.message ||
          "Paystack transaction verification failed.",
        );
      }

      const transaction =
        verification.data;

      if (
        transaction?.status !==
          "success" ||
        String(
          transaction.reference,
        ) !== reference
      ) {
        throw new Error(
          "Paystack did not verify a successful transaction.",
        );
      }

      // ------------------------------------------------------
      // Find Kompo order.
      // ------------------------------------------------------

      const orders =
        await supabaseRequest(
          `orders?select=id,total_cents,status&public_reference=eq.${
            encodeURIComponent(
              reference,
            )
          }&limit=1`,
        );

      if (!orders.length) {
        // Valid Paystack event, but not one of our orders.
        return json(
          request,
          200,
          {
            ok: true,
            unmatched: true,
          },
        );
      }

      const order =
        orders[0];

      const payments =
        await supabaseRequest(
          `payments?select=id,provider,status&order_id=eq.${
            encodeURIComponent(
              order.id,
            )
          }&limit=1`,
        );

      const payment =
        payments?.[0];

      if (
        !payment ||
        payment.provider !==
          "paystack"
      ) {
        return json(
          request,
          200,
          {
            ok: true,
            unmatched: true,
          },
        );
      }

      // ------------------------------------------------------
      // Currency mismatch is held for manual review.
      // ------------------------------------------------------

      if (
        String(
          transaction.currency ||
          "",
        ).toUpperCase() !==
        "ZAR"
      ) {
        await supabaseRequest(
          `orders?id=eq.${
            encodeURIComponent(
              order.id,
            )
          }`,
          {
            method: "PATCH",

            body: {
              status:
                "payment_review",

              updated_at:
                new Date()
                  .toISOString(),
            },
          },
        );

        await supabaseRequest(
          `payments?id=eq.${
            encodeURIComponent(
              payment.id,
            )
          }`,
          {
            method: "PATCH",

            body: {
              status: "review",

              provider_reference:
                reference,

              provider_payload: {
                event,
                verification:
                  transaction,
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
            paymentReview: true,
            reason:
              "currency_mismatch",
          },
        );
      }

      // ------------------------------------------------------
      // Record webhook for audit/idempotency.
      // ------------------------------------------------------

      await supabaseRequest(
        "webhook_events",
        {
          method: "POST",

          body: {
            provider:
              "paystack",

            event_key:
              `charge.success:${reference}`,

            payload: event,
          },

          headers: {
            Prefer:
              "resolution=ignore-duplicates",
          },
        },
      );

      // ------------------------------------------------------
      // Final DB checks:
      // - expected amount
      // - reservation valid
      // - stock available
      // - idempotency
      // Then convert stock and mark paid.
      // ------------------------------------------------------

      const finalized =
        await rpc(
          "finalize_paystack_payment",
          {
            p_public_reference:
              reference,

            // Use Paystack's string reference rather than numeric
            // transaction ID to avoid JS integer precision issues.
            p_provider_reference:
              reference,

            p_amount_cents:
              Number(
                transaction.amount,
              ),

            p_payload: {
              event,
              verification:
                transaction,
            },
          },
        );

      return json(
        request,
        200,
        {
          ok: true,
          finalized,
        },
      );
    } catch (error) {
      console.error(
        "paystack-webhook failed:",
        error,
      );

      // Non-200 lets Paystack retry temporary failures.
      return json(
        request,
        500,
        {
          error:
            error instanceof Error
              ? error.message
              : "Webhook processing failed.",
        },
      );
    }
  },
);
