export type Quote = {
  vendorId: string;
  rateId: string;
  serviceLevelCode: string;
  providerSlug: string;
  amountCents: number;
  courierCostCents: number;
  logisticsFeeCents: number;
  destinationPostalCode: string;
  expiresAt: string;
  signature?: string;
};

type SupabaseRequestOptions = {
  method?: string;
  body?: unknown;
  token?: string;
  service?: boolean;
  headers?: Record<string, string>;
};

export function required(name: string): string {
  const value = Deno.env.get(name);

  if (!value) {
    throw new Error(`${name} is not configured.`);
  }

  return value;
}

function namedKey(
  jsonVariable: string,
  fallbacks: string[],
): string {
  const raw = Deno.env.get(jsonVariable);

  if (raw) {
    try {
      const parsed = JSON.parse(raw);

      if (parsed.default) {
        return String(parsed.default);
      }

      const first = Object.values(parsed)[0];

      if (first) {
        return String(first);
      }
    } catch {
      return raw;
    }
  }

  for (const name of fallbacks) {
    const value = Deno.env.get(name);

    if (value) {
      return value;
    }
  }

  throw new Error(`${jsonVariable} is not configured.`);
}

export function publishableKey(): string {
  return namedKey(
    "SUPABASE_PUBLISHABLE_KEYS",
    [
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
    ],
  );
}

export function secretKey(): string {
  return namedKey(
    "SUPABASE_SECRET_KEYS",
    [
      "SUPABASE_SECRET_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
    ],
  );
}

function allowedOrigins(): Set<string> {
  const values = [
    "https://kompo-nation.pages.dev",
    Deno.env.get("SITE_URL") || "",
    ...(Deno.env.get("CORS_ORIGINS") || "").split(","),
  ]
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return new Set(values);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = (request.headers.get("origin") || "")
    .replace(/\/$/, "");

  const allowed = allowedOrigins();

  const allowOrigin = allowed.has(origin)
    ? origin
    : "https://kompo-nation.pages.dev";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info, x-kompo-webhook-token",
    "Access-Control-Allow-Methods":
      "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
}

export function preflight(request: Request): Response | null {
  if (request.method !== "OPTIONS") {
    return null;
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(request),
  });
}

export function json(
  request: Request,
  status: number,
  body: unknown,
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json",
    },
  });
}

export async function rawBody(request: Request): Promise<string> {
  return await request.text();
}

export async function supabaseRequest(
  path: string,
  {
    method = "GET",
    body,
    token,
    service = true,
    headers = {},
  }: SupabaseRequestOptions = {},
): Promise<any> {
  const baseUrl = required("SUPABASE_URL").replace(/\/$/, "");

  const apiKey = service
    ? secretKey()
    : publishableKey();

  const requestHeaders = new Headers({
    apikey: apiKey,
    "Content-Type": "application/json",
    ...headers,
  });

  if (token) {
    requestHeaders.set(
      "Authorization",
      `Bearer ${token}`,
    );
  }

  const response = await fetch(
    `${baseUrl}/rest/v1/${path}`,
    {
      method,
      headers: requestHeaders,
      body: body === undefined
        ? undefined
        : JSON.stringify(body),
    },
  );

  const text = await response.text();

  let payload: any = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      payload?.message ||
      payload?.hint ||
      payload?.error ||
      `Database request failed (${response.status}).`;

    throw new Error(String(message));
  }

  return payload;
}

export async function rpc(
  name: string,
  args: unknown,
): Promise<any> {
  return await supabaseRequest(
    `rpc/${name}`,
    {
      method: "POST",
      body: args,
    },
  );
}

export async function authenticatedUser(
  request: Request,
): Promise<{
  user: any;
  token: string;
}> {
  const authorization =
    request.headers.get("authorization") || "";

  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  if (!token) {
    throw new Error("Authentication required.");
  }

  const response = await fetch(
    `${required("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/user`,
    {
      headers: {
        apikey: publishableKey(),
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      "Your session is no longer valid.",
    );
  }

  const user = await response.json();
  const memberships = await supabaseRequest(
    `app_memberships?user_id=eq.${encodeURIComponent(user.id)}&app_id=eq.kompo&select=user_id&limit=1`,
  );
  if (!memberships.length) {
    throw new Error("This account is not registered with Kompo Nation.");
  }

  return { user, token };
}

function canonicalQuote(quote: Quote): string {
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

function bytesToHex(bytes: Uint8Array): string {
  return Array
    .from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(
  left: string,
  right: string,
): boolean {
  const encoder = new TextEncoder();

  const a = encoder.encode(left);
  const b = encoder.encode(right);

  let difference = a.length ^ b.length;

  const length = Math.max(
    a.length,
    b.length,
  );

  for (let index = 0; index < length; index++) {
    difference |=
      (a[index] || 0) ^
      (b[index] || 0);
  }

  return difference === 0;
}

export async function signQuote(
  quote: Quote,
): Promise<string> {
  const encoder = new TextEncoder();

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(
      required("QUOTE_SIGNING_SECRET"),
    ),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(canonicalQuote(quote)),
  );

  return bytesToHex(
    new Uint8Array(signature),
  );
}

export async function verifyQuote(
  quote: Quote,
): Promise<boolean> {
  if (
    !quote?.signature ||
    new Date(quote.expiresAt).getTime() <= Date.now()
  ) {
    return false;
  }

  const expected = await signQuote(quote);

  return constantTimeEqual(
    expected,
    String(quote.signature),
  );
}
