import {
  json,
  required,
  rpc,
  supabaseRequest,
} from "../_shared/runtime.ts";
import { getStitchPaymentRequest } from "../_shared/payments.ts";

const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = Uint8Array.from(
    binary,
    (character) => character.charCodeAt(0),
  );
  return bytes.buffer as ArrayBuffer;
}

async function hmacBase64(secret: ArrayBuffer, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
  );

  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function verifySvixSignature(
  request: Request,
  rawBody: string,
): Promise<boolean> {
  const id = request.headers.get("svix-id") || "";
  const timestamp = request.headers.get("svix-timestamp") || "";
  const signatures = request.headers.get("svix-signature") || "";
  const timestampSeconds = Number(timestamp);

  if (
    !id ||
    !timestamp ||
    !signatures ||
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 5 * 60
  ) {
    return false;
  }

  const encodedSecret = required("STITCH_WEBHOOK_SECRET").replace(
    /^whsec_/,
    "",
  );
  const expected = await hmacBase64(
    decodeBase64(encodedSecret),
    `${id}.${timestamp}.${rawBody}`,
  );

  return signatures.split(/\s+/).some((signature) => {
    const [version, value] = signature.split(",", 2);
    return version === "v1" && Boolean(value) &&
      constantTimeEqual(expected, value);
  });
}

function cents(quantity: unknown): number {
  const value = Number(quantity);
  return Number.isFinite(value) ? Math.round(value * 100) : -1;
}

async function bookPaidReturn(returnShipmentId: string): Promise<void> {
  const response = await fetch(
    `${required("SUPABASE_URL").replace(/\/$/, "")}/functions/v1/return-logistics`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
        "x-kompo-internal": required("CRON_SECRET"),
      },
      body: JSON.stringify({
        action: "book-paid-leg",
        returnShipmentId,
      }),
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload?.error || "Paid return could not be booked.");
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json(request, 405, { error: "Method not allowed." });
  }

  try {
    // Stitch/Svix signs the exact bytes received, so parse only after checking it.
    const rawBody = await request.text();
    if (!(await verifySvixSignature(request, rawBody))) {
      return json(request, 401, { error: "Invalid Stitch signature." });
    }

    const event = JSON.parse(rawBody || "{}");
    const node = event?.data?.client?.paymentInitiationRequests?.node;

    if (!node?.id) {
      return json(request, 200, { ok: true, ignored: true });
    }

    if (node?.state?.__typename !== "PaymentInitiationRequestCompleted") {
      return json(request, 200, { ok: true, ignored: true });
    }

    // Never trust only the webhook/redirect payload. Re-read the payment request
    // from Stitch before converting reservations or stock.
    const verification = await getStitchPaymentRequest(String(node.id));
    const reference = String(
      verification?.externalReference || node?.externalReference || "",
    );
    const amountCents = cents(
      verification?.amount?.quantity ?? node?.amount?.quantity,
    );
    const currency = String(
      verification?.amount?.currency || node?.amount?.currency || "",
    ).toUpperCase();

    if (
      verification?.status !== "completed" ||
      !reference ||
      amountCents < 0
    ) {
      throw new Error("Stitch did not verify a completed payment.");
    }

    if (reference.startsWith("KNRP-")) {
      const rows = await supabaseRequest(
        `return_payments?select=*&provider_reference=eq.${
          encodeURIComponent(reference)
        }&limit=1`,
      );
      const payment = rows?.[0];

      if (!payment || payment.provider !== "stitch") {
        return json(request, 202, { ok: true, unmatchedReturnPayment: true });
      }

      if (
        currency !== "ZAR" ||
        amountCents !== Number(payment.amount_cents)
      ) {
        await supabaseRequest(
          `return_payments?id=eq.${encodeURIComponent(payment.id)}`,
          {
            method: "PATCH",
            body: {
              status: "review",
              provider_payload: { event, verification },
              updated_at: new Date().toISOString(),
            },
          },
        );
        return json(request, 200, {
          ok: true,
          paymentReview: true,
          kind: "return_logistics",
        });
      }

      await supabaseRequest("webhook_events", {
        method: "POST",
        body: {
          provider: "stitch",
          event_key: `payment.completed:${node.id}`,
          payload: event,
        },
        headers: { Prefer: "resolution=ignore-duplicates" },
      });
      const finalized = await rpc("finalize_return_payment", {
        p_provider_reference: reference,
        p_amount_cents: amountCents,
        p_payload: { event, verification },
      });
      await bookPaidReturn(String(finalized.returnShipmentId));
      return json(request, 200, { ok: true, returnPayment: true });
    }

    const orders = await supabaseRequest(
      `orders?select=id,total_cents,status&public_reference=eq.${
        encodeURIComponent(reference)
      }&limit=1`,
    );
    if (!orders.length) {
      return json(request, 200, { ok: true, unmatched: true });
    }

    const order = orders[0];
    const payments = await supabaseRequest(
      `payments?select=id,provider,status&order_id=eq.${
        encodeURIComponent(order.id)
      }&limit=1`,
    );
    const payment = payments?.[0];

    if (!payment || payment.provider !== "stitch") {
      return json(request, 200, { ok: true, unmatched: true });
    }

    if (currency !== "ZAR") {
      await supabaseRequest(`orders?id=eq.${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        body: {
          status: "payment_review",
          updated_at: new Date().toISOString(),
        },
      });
      await supabaseRequest(
        `payments?id=eq.${encodeURIComponent(payment.id)}`,
        {
          method: "PATCH",
          body: {
            status: "review",
            provider_reference: String(node.id),
            provider_payload: { event, verification },
            updated_at: new Date().toISOString(),
          },
        },
      );
      return json(request, 200, {
        ok: true,
        paymentReview: true,
        reason: "currency_mismatch",
      });
    }

    await supabaseRequest("webhook_events", {
      method: "POST",
      body: {
        provider: "stitch",
        event_key: `payment.completed:${node.id}`,
        payload: event,
      },
      headers: { Prefer: "resolution=ignore-duplicates" },
    });

    const finalized = await rpc("finalize_payment", {
      p_provider: "stitch",
      p_public_reference: reference,
      p_provider_reference: String(node.id),
      p_amount_cents: amountCents,
      p_payload: { event, verification },
    });

    await rpc("settle_vendor_liability_recoveries_by_reference", {
      p_public_reference: reference,
    });

    return json(request, 200, { ok: true, finalized });
  } catch (error) {
    console.error("stitch-webhook failed:", error);
    // A non-2xx response tells Stitch to retry transient failures.
    return json(request, 500, {
      error: error instanceof Error ? error.message : "Webhook processing failed.",
    });
  }
});
