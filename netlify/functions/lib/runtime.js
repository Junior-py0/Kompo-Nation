const { createHmac, timingSafeEqual } = require("node:crypto");

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
};

const rawBody = (event) => event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");

async function supabaseRequest(path, { method = "GET", body, token, service = true, headers = {} } = {}) {
  const url = required("SUPABASE_URL").replace(/\/$/, "");
  const secret = service ? required("SUPABASE_SECRET_KEY") : required("SUPABASE_PUBLISHABLE_KEY");
  const requestHeaders = {
    apikey: secret,
    "Content-Type": "application/json",
    ...headers,
  };
  // Opaque sb_secret keys belong only in `apikey`; user session JWTs belong in Authorization.
  if (token) requestHeaders.Authorization = `Bearer ${token}`;
  const response = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(payload?.message || payload?.hint || `Database request failed (${response.status}).`);
  return payload;
}

const rpc = (name, args) => supabaseRequest(`rpc/${name}`, { method: "POST", body: args });

async function authenticatedUser(event) {
  const authorization = event.headers.authorization || event.headers.Authorization || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new Error("Authentication required.");
  const response = await fetch(`${required("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/user`, {
    headers: { apikey: required("SUPABASE_PUBLISHABLE_KEY"), Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("Your session is no longer valid.");
  return { user: await response.json(), token };
}

const canonicalQuote = (quote) => [quote.vendorId, quote.rateId, quote.serviceLevelCode, quote.providerSlug, quote.amountCents, quote.destinationPostalCode, quote.expiresAt].join("|");
const signQuote = (quote) => createHmac("sha256", required("QUOTE_SIGNING_SECRET")).update(canonicalQuote(quote)).digest("hex");
const verifyQuote = (quote) => {
  if (!quote?.signature || new Date(quote.expiresAt).getTime() <= Date.now()) return false;
  const expected = Buffer.from(signQuote(quote));
  const received = Buffer.from(String(quote.signature));
  return expected.length === received.length && timingSafeEqual(expected, received);
};

module.exports = { authenticatedUser, json, rawBody, required, rpc, signQuote, supabaseRequest, verifyQuote };
