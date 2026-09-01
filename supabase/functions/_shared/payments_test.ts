import {
  assert,
  assertEquals,
} from "jsr:@std/assert@^1";
import {
  configuredPaymentProvider,
  initializePayment,
} from "./payments.ts";

function response(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.test("Paystack remains the default and retains marketplace splits", async () => {
  const originalFetch = globalThis.fetch;
  const originalProvider = Deno.env.get("PAYMENT_PROVIDER");
  const originalSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  let submitted: any;

  try {
    Deno.env.delete("PAYMENT_PROVIDER");
    Deno.env.set("PAYSTACK_SECRET_KEY", "sk_test_value");
    globalThis.fetch = (async (_input, init) => {
      submitted = JSON.parse(String(init?.body || "{}"));
      return response({
        status: true,
        data: {
          authorization_url: "https://checkout.paystack.test/example",
          access_code: "access-code",
          reference: "KN-TEST",
        },
      });
    }) as typeof fetch;

    assertEquals(configuredPaymentProvider(), "paystack");
    const result = await initializePayment({
      provider: "paystack",
      email: "buyer@example.com",
      amountCents: 12345,
      reference: "KN-TEST",
      successUrl: "https://komponation.co.za/payment-success",
      cancelUrl: "https://komponation.co.za/payment-cancelled",
      paystackSplits: [{ subaccount: "ACCT_vendor", share: 10000 }],
    });

    assertEquals(result.providerReference, "KN-TEST");
    assertEquals(submitted.amount, "12345");
    assertEquals(submitted.split.subaccounts[0], {
      subaccount: "ACCT_vendor",
      share: 10000,
    });
  } finally {
    globalThis.fetch = originalFetch;
    originalProvider === undefined
      ? Deno.env.delete("PAYMENT_PROVIDER")
      : Deno.env.set("PAYMENT_PROVIDER", originalProvider);
    originalSecret === undefined
      ? Deno.env.delete("PAYSTACK_SECRET_KEY")
      : Deno.env.set("PAYSTACK_SECRET_KEY", originalSecret);
  }
});

Deno.test("Stitch creates a card payment request with safe redirects", async () => {
  const originalFetch = globalThis.fetch;
  const previous = new Map(
    [
      "STITCH_CLIENT_ID",
      "STITCH_CLIENT_SECRET",
      "STITCH_ENABLE_EFT",
      "STITCH_MERCHANT_ID",
    ].map((name) => [name, Deno.env.get(name)]),
  );
  const calls: Array<{ url: string; body: string }> = [];

  try {
    Deno.env.set("STITCH_CLIENT_ID", "client-id");
    Deno.env.set("STITCH_CLIENT_SECRET", "client-secret");
    Deno.env.set("STITCH_ENABLE_EFT", "false");
    Deno.env.delete("STITCH_MERCHANT_ID");
    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      calls.push({ url, body: String(init?.body || "") });
      if (url.includes("/connect/token")) {
        return response({ access_token: "token", expires_in: 300 });
      }
      return response({
        id: "stitch-request-id",
        interaction: {
          type: "redirect",
          url: "https://secure.stitch.money/connect/payment-request/example",
        },
      });
    }) as typeof fetch;

    const result = await initializePayment({
      provider: "stitch",
      email: "buyer@example.com",
      amountCents: 12345,
      reference: "KN-STITCH",
      customerId: "customer-id",
      fullName: "Buyer Name",
      phone: "082 123 4567",
      successUrl: "https://komponation.co.za/payment-success",
      cancelUrl: "https://komponation.co.za/payment-cancelled",
    });

    assertEquals(result.providerReference, "stitch-request-id");
    const redirect = new URL(result.authorizationUrl);
    assertEquals(
      redirect.searchParams.get("redirect_uri"),
      "https://komponation.co.za/payment-success",
    );
    assertEquals(
      redirect.searchParams.get("failure_redirect_uri"),
      "https://komponation.co.za/payment-cancelled",
    );

    const submitted = JSON.parse(calls[1].body);
    assertEquals(submitted.amount, { currency: "ZAR", quantity: 123.45 });
    assertEquals(submitted.paymentMethods, {
      card: { enabled: true },
      eft: { enabled: false },
    });
    assertEquals(submitted.payer.mobileNumber, "+27821234567");
    assert(calls[0].body.includes("scope=client_paymentrequest"));
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of previous) {
      value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value);
    }
  }
});

Deno.test("Yoco creates an idempotent checkout in cents", async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = Deno.env.get("YOCO_SECRET_KEY");
  let submitted: any;
  let authorization = "";
  let idempotencyKey = "";

  try {
    Deno.env.set("YOCO_SECRET_KEY", "sk_test_yoco");
    globalThis.fetch = (async (_input, init) => {
      submitted = JSON.parse(String(init?.body || "{}"));
      const headers = new Headers(init?.headers);
      authorization = headers.get("Authorization") || "";
      idempotencyKey = headers.get("Idempotency-Key") || "";
      return response({
        id: "checkout_yoco_123",
        status: "created",
        processingMode: "test",
        redirectUrl: "https://c.yoco.com/checkout/example",
      });
    }) as typeof fetch;

    const result = await initializePayment({
      provider: "yoco",
      email: "buyer@example.com",
      amountCents: 12345,
      reference: "KN-YOCO",
      orderId: "order-id",
      successUrl: "https://komponation.co.za/payment-success",
      cancelUrl: "https://komponation.co.za/payment-cancelled",
    });

    assertEquals(result.providerReference, "checkout_yoco_123");
    assertEquals(submitted.amount, 12345);
    assertEquals(submitted.currency, "ZAR");
    assertEquals(submitted.clientReferenceId, "KN-YOCO");
    assertEquals(authorization, "Bearer sk_test_yoco");
    assertEquals(idempotencyKey, "KN-YOCO");
  } finally {
    globalThis.fetch = originalFetch;
    originalSecret === undefined
      ? Deno.env.delete("YOCO_SECRET_KEY")
      : Deno.env.set("YOCO_SECRET_KEY", originalSecret);
  }
});
