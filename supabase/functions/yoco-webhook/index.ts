import {
  json,
  required,
  rpc,
  supabaseRequest,
} from "../_shared/runtime.ts";

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

async function verifyYocoSignature(
  request: Request,
  rawBody: string,
): Promise<boolean> {
  const id = request.headers.get("webhook-id") || "";
  const timestamp = request.headers.get("webhook-timestamp") || "";
  const signatures = request.headers.get("webhook-signature") || "";
  const timestampSeconds = Number(timestamp);

  if (
    !id ||
    !timestamp ||
    !signatures ||
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) > 3 * 60
  ) return false;

  const secret = required("YOCO_WEBHOOK_SECRET").replace(/^whsec_/, "");
  const expected = await hmacBase64(
    decodeBase64(secret),
    `${id}.${timestamp}.${rawBody}`,
  );

  return signatures.split(/\s+/).some((signature) => {
    const [version, value] = signature.split(",", 2);
    return version === "v1" && Boolean(value) &&
      constantTimeEqual(expected, value);
  });
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
      body: JSON.stringify({ action: "book-paid-leg", returnShipmentId }),
    },
  );
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || "Paid return could not be booked.");
  }
}

function initializationMode(payment: any): string {
  return String(
    payment?.provider_payload?.initialization?.processingMode || "",
  ).toLowerCase();
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return json(request, 405, { error: "Method not allowed." });
  }

  try {
    const rawBody = await request.text();
    if (!(await verifyYocoSignature(request, rawBody))) {
      return json(request, 401, { error: "Invalid Yoco signature." });
    }

    const event = JSON.parse(rawBody || "{}");
    if (event?.type !== "payment.succeeded") {
      return json(request, 200, { ok: true, ignored: true });
    }

    const transaction = event?.payload || {};
    const checkoutId = String(transaction?.metadata?.checkoutId || "");
    const amountCents = Number(transaction?.amount);
    const currency = String(transaction?.currency || "").toUpperCase();
    const paymentId = String(transaction?.id || "");
    const mode = String(transaction?.mode || "").toLowerCase();

    if (
      !checkoutId ||
      !paymentId ||
      transaction?.status !== "succeeded" ||
      !Number.isInteger(amountCents) ||
      amountCents < 0
    ) {
      throw new Error("Yoco sent an incomplete successful-payment event.");
    }

    const returnRows = await supabaseRequest(
      `return_payments?select=*&provider=eq.yoco&provider_request_id=eq.${
        encodeURIComponent(checkoutId)
      }&limit=1`,
    );
    const returnPayment = returnRows?.[0];

    if (returnPayment) {
      const expectedMode = initializationMode(returnPayment);
      if (
        currency !== "ZAR" ||
        amountCents !== Number(returnPayment.amount_cents) ||
        (expectedMode && mode !== expectedMode)
      ) {
        await supabaseRequest(
          `return_payments?id=eq.${encodeURIComponent(returnPayment.id)}`,
          {
            method: "PATCH",
            body: {
              status: "review",
              provider_payload: { event },
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
          provider: "yoco",
          event_key: `payment.succeeded:${event.id || paymentId}`,
          payload: event,
        },
        headers: { Prefer: "resolution=ignore-duplicates" },
      });
      const finalized = await rpc("finalize_return_payment", {
        p_provider_reference: returnPayment.provider_reference,
        p_amount_cents: amountCents,
        p_payload: { event, checkoutId, paymentId },
      });
      await bookPaidReturn(String(finalized.returnShipmentId));
      return json(request, 200, { ok: true, returnPayment: true });
    }

    const paymentRows = await supabaseRequest(
      `payments?select=id,order_id,provider,status,provider_payload&provider=eq.yoco&provider_reference=eq.${
        encodeURIComponent(checkoutId)
      }&limit=1`,
    );
    const payment = paymentRows?.[0];
    if (!payment) {
      return json(request, 200, { ok: true, unmatched: true });
    }

    const orders = await supabaseRequest(
      `orders?select=id,public_reference,total_cents,status&id=eq.${
        encodeURIComponent(payment.order_id)
      }&limit=1`,
    );
    const order = orders?.[0];
    if (!order) {
      return json(request, 200, { ok: true, unmatched: true });
    }

    const expectedMode = initializationMode(payment);
    if (
      currency !== "ZAR" ||
      (expectedMode && mode !== expectedMode)
    ) {
      await supabaseRequest(`orders?id=eq.${encodeURIComponent(order.id)}`, {
        method: "PATCH",
        body: { status: "payment_review", updated_at: new Date().toISOString() },
      });
      await supabaseRequest(`payments?id=eq.${encodeURIComponent(payment.id)}`, {
        method: "PATCH",
        body: {
          status: "review",
          provider_payload: { event, checkoutId, paymentId },
          updated_at: new Date().toISOString(),
        },
      });
      return json(request, 200, {
        ok: true,
        paymentReview: true,
        reason: expectedMode && mode !== expectedMode
          ? "processing_mode_mismatch"
          : "currency_mismatch",
      });
    }

    await supabaseRequest("webhook_events", {
      method: "POST",
      body: {
        provider: "yoco",
        event_key: `payment.succeeded:${event.id || paymentId}`,
        payload: event,
      },
      headers: { Prefer: "resolution=ignore-duplicates" },
    });

    const finalized = await rpc("finalize_payment", {
      p_provider: "yoco",
      p_public_reference: order.public_reference,
      p_provider_reference: checkoutId,
      p_amount_cents: amountCents,
      p_payload: { event, checkoutId, paymentId },
    });

    return json(request, 200, { ok: true, finalized });
  } catch (error) {
    console.error("yoco-webhook failed:", error);
    return json(request, 500, {
      error: error instanceof Error ? error.message : "Webhook processing failed.",
    });
  }
});
