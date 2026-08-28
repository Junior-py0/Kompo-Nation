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

function metadataObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
}

function isTapNationEvent(event: any): boolean {
  const data = event?.data || {};
  const metadata = metadataObject(data.metadata);
  const reference = String(data.reference || "");
  const planCode = String(
    data?.plan?.plan_code ||
    data?.subscription?.plan?.plan_code ||
    data?.plan_code ||
    "",
  );
  return reference.startsWith("TN-BUS-") ||
    metadata.product === "tapnation_business" ||
    [
      Deno.env.get("TAPNATION_MONTHLY_PLAN_CODE"),
      Deno.env.get("TAPNATION_ANNUAL_PLAN_CODE"),
    ].filter(Boolean).includes(planCode);
}

async function forwardTapNationEvent(raw: string, signature: string): Promise<void> {
  const response = await fetch(required("TAPNATION_WEBHOOK_URL"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-paystack-signature": signature,
    },
    body: raw,
  });
  if (!response.ok) {
    const payload = await response.text();
    throw new Error(`TapNation webhook rejected the event (${response.status}): ${payload.slice(0, 300)}`);
  }
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

      // This Paystack business has one webhook URL. Keep Kompo's existing
      // handler as the entry point and forward only TapNation plan events.
      if (isTapNationEvent(event)) {
        await forwardTapNationEvent(raw, receivedSignature);
        return json(request, 200, { ok: true, routedTo: "tapnation" });
      }

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
      // RETURN_PAYMENT_WEBHOOK_V1
      if(reference.startsWith("KNRP-")){
        const rows=await supabaseRequest(`return_payments?select=*&provider_reference=eq.${encodeURIComponent(reference)}&limit=1`),pay=rows?.[0];
        if(!pay)return json(request,202,{ok:true,unmatchedReturnPayment:true});
        const amount=Number(transaction?.amount),currency=String(transaction?.currency||"").toUpperCase();
        if(transaction?.status!=="success"||currency!=="ZAR"||amount!==Number(pay.amount_cents)){await supabaseRequest(`return_payments?id=eq.${encodeURIComponent(pay.id)}`,{method:"PATCH",body:{status:"review",provider_payload:{event,verification:transaction},updated_at:new Date().toISOString()}});return json(request,200,{ok:true,paymentReview:true,kind:"return_logistics"});}
        await supabaseRequest("webhook_events",{method:"POST",body:{provider:"paystack",event_key:`return-charge.success:${reference}`,payload:event},headers:{Prefer:"resolution=ignore-duplicates"}});
        const fin=await rpc("finalize_return_payment",{p_provider_reference:reference,p_amount_cents:amount,p_payload:{event,verification:transaction}});
        const response=await fetch(`${required("SUPABASE_URL").replace(/\/$/,"")}/functions/v1/return-logistics`,{method:"POST",headers:{Authorization:`Bearer ${required("SUPABASE_SERVICE_ROLE_KEY")}`,"Content-Type":"application/json","x-kompo-internal":required("CRON_SECRET")},body:JSON.stringify({action:"book-paid-leg",returnShipmentId:fin.returnShipmentId})}),booked=await response.json();
        if(!response.ok)throw new Error(booked?.error||"Paid return could not be booked.");
        return json(request,200,{ok:true,returnPayment:true});
      }


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
      // SETTLE_VENDOR_RECOVERY_V1
      await rpc("settle_vendor_liability_recoveries_by_reference",{p_public_reference:reference});


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
