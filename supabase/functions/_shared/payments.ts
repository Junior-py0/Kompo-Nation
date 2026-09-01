import { required } from "./runtime.ts";

export type PaymentProvider = "paystack" | "stitch" | "yoco";

export type PaymentInitialization = {
  authorizationUrl: string;
  providerReference: string;
  accessCode?: string;
  providerPayload: unknown;
};

export type InitializePaymentInput = {
  provider: PaymentProvider;
  email: string;
  amountCents: number;
  reference: string;
  orderId?: string;
  customerId?: string;
  fullName?: string;
  phone?: string;
  expiresAt?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, unknown>;
  paystackSplits?: Array<{
    subaccount: string;
    share: number;
  }>;
};

type StitchToken = {
  value: string;
  expiresAt: number;
};

let stitchToken: StitchToken | null = null;

function enabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(Deno.env.get(name) || "").trim().toLowerCase(),
  );
}

export function configuredPaymentProvider(): PaymentProvider {
  const value = String(Deno.env.get("PAYMENT_PROVIDER") || "paystack")
    .trim()
    .toLowerCase();

  if (value !== "paystack" && value !== "stitch" && value !== "yoco") {
    throw new Error(
      "PAYMENT_PROVIDER must be paystack, stitch, or yoco.",
    );
  }

  return value;
}

export function allowsPlatformCollection(): boolean {
  return enabled("PAYMENT_ALLOW_PLATFORM_COLLECTION") ||
    enabled("STITCH_ALLOW_PLATFORM_COLLECTION");
}

async function stitchAccessToken(): Promise<string> {
  if (stitchToken && stitchToken.expiresAt > Date.now() + 30_000) {
    return stitchToken.value;
  }

  const tokenUrl = "https://secure.stitch.money/connect/token";
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: required("STITCH_CLIENT_ID"),
    client_secret: required("STITCH_CLIENT_SECRET"),
    scope: "client_paymentrequest",
    audience: tokenUrl,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form,
  });
  const payload = await response.json();

  if (!response.ok || !payload?.access_token) {
    throw new Error(
      payload?.error_description ||
        payload?.error ||
        "Stitch authentication failed.",
    );
  }

  stitchToken = {
    value: String(payload.access_token),
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 300)) * 1000,
  };

  return stitchToken.value;
}

function withRedirects(
  authorizationUrl: string,
  successUrl: string,
  cancelUrl: string,
): string {
  const url = new URL(authorizationUrl);
  url.searchParams.set("redirect_uri", successUrl);
  url.searchParams.set("failure_redirect_uri", cancelUrl);
  return url.toString();
}

function stitchMobileNumber(value: string | undefined): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;

  const compact = raw.replace(/[\s()-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact;
  if (/^0\d{9}$/.test(compact)) return `+27${compact.slice(1)}`;
  return undefined;
}

async function initializePaystack(
  input: InitializePaymentInput,
): Promise<PaymentInitialization> {
  const body: Record<string, unknown> = {
    email: input.email,
    amount: String(input.amountCents),
    currency: "ZAR",
    reference: input.reference,
    callback_url: input.successUrl,
    metadata: JSON.stringify({
      orderId: input.orderId,
      publicReference: input.reference,
      ...input.metadata,
    }),
  };

  if (input.paystackSplits?.length) {
    body.split = {
      type: "flat",
      bearer_type: "account",
      subaccounts: input.paystackSplits.map((split) => ({
        subaccount: split.subaccount,
        share: Number(split.share),
      })),
    };
  }

  const response = await fetch(
    "https://api.paystack.co/transaction/initialize",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required("PAYSTACK_SECRET_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const payload = await response.json();

  if (
    !response.ok ||
    payload?.status !== true ||
    !payload?.data?.authorization_url ||
    !payload?.data?.reference
  ) {
    throw new Error(
      payload?.message || "Paystack could not initialize the payment.",
    );
  }

  return {
    authorizationUrl: String(payload.data.authorization_url),
    providerReference: String(payload.data.reference),
    accessCode: payload.data.access_code
      ? String(payload.data.access_code)
      : undefined,
    providerPayload: payload.data,
  };
}

async function initializeStitch(
  input: InitializePaymentInput,
): Promise<PaymentInitialization> {
  const enableEft = enabled("STITCH_ENABLE_EFT");
  const merchantId = String(Deno.env.get("STITCH_MERCHANT_ID") || "").trim();

  if (enableEft && !merchantId) {
    throw new Error(
      "STITCH_MERCHANT_ID is required when STITCH_ENABLE_EFT is enabled.",
    );
  }

  const metadata = Object.fromEntries(
    Object.entries({
      orderId: input.orderId,
      publicReference: input.reference,
      customerId: input.customerId,
      ...input.metadata,
    }).filter(([, value]) => value !== undefined && value !== null),
  );

  const body: Record<string, unknown> = {
    amount: {
      currency: "ZAR",
      quantity: Number((input.amountCents / 100).toFixed(2)),
    },
    externalReference: input.reference,
    expireAt: input.expiresAt ||
      new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    payer: {
      identifier: input.customerId || input.email || input.reference,
      email: input.email,
      fullName: input.fullName || undefined,
      mobileNumber: stitchMobileNumber(input.phone),
    },
    metadata,
    paymentMethods: {
      card: { enabled: true },
      eft: { enabled: enableEft },
    },
  };

  if (merchantId) {
    body.merchantId = merchantId;
  }

  const response = await fetch("https://api.stitch.money/v2/payment-requests", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${await stitchAccessToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (
    !response.ok ||
    !payload?.id ||
    payload?.interaction?.type !== "redirect" ||
    !payload?.interaction?.url
  ) {
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        "Stitch could not initialize the payment.",
    );
  }

  return {
    authorizationUrl: withRedirects(
      String(payload.interaction.url),
      input.successUrl,
      input.cancelUrl,
    ),
    providerReference: String(payload.id),
    providerPayload: payload,
  };
}

async function initializeYoco(
  input: InitializePaymentInput,
): Promise<PaymentInitialization> {
  const body = {
    amount: input.amountCents,
    currency: "ZAR",
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    failureUrl: input.cancelUrl,
    clientReferenceId: input.reference,
    externalId: input.orderId || input.reference,
    metadata: {
      orderId: input.orderId,
      publicReference: input.reference,
      customerId: input.customerId,
      ...input.metadata,
    },
  };

  const response = await fetch("https://payments.yoco.com/api/checkouts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required("YOCO_SECRET_KEY")}`,
      "Content-Type": "application/json",
      "Idempotency-Key": input.reference,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();

  if (!response.ok || !payload?.id || !payload?.redirectUrl) {
    throw new Error(
      payload?.message || payload?.error ||
        "Yoco could not initialize the payment.",
    );
  }

  return {
    authorizationUrl: String(payload.redirectUrl),
    providerReference: String(payload.id),
    providerPayload: payload,
  };
}

export async function initializePayment(
  input: InitializePaymentInput,
): Promise<PaymentInitialization> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Payment amount must be a positive number of cents.");
  }

  if (input.provider === "stitch") return await initializeStitch(input);
  if (input.provider === "yoco") return await initializeYoco(input);
  return await initializePaystack(input);
}

export async function getStitchPaymentRequest(id: string): Promise<any> {
  const response = await fetch(
    `https://api.stitch.money/v2/payment-requests/${encodeURIComponent(id)}`,
    {
      headers: {
        Authorization: `Bearer ${await stitchAccessToken()}`,
      },
    },
  );
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(
      payload?.message ||
        payload?.error?.message ||
        "Stitch payment verification failed.",
    );
  }

  return payload;
}
