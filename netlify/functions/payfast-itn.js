const { createHash, timingSafeEqual } = require("node:crypto");
const { json, rawBody, required, rpc, supabaseRequest } = require("./lib/runtime");

const encode = (value) => encodeURIComponent(String(value).trim()).replace(/%20/g, "+").replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const inRange = (ip, prefix, bits) => { const toInt = (value) => value.split(".").reduce((sum, part) => (sum << 8) + Number(part), 0) >>> 0; const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0; return (toInt(ip) & mask) === (toInt(prefix) & mask); };
const validPayFastIp = (ip) => ["197.97.145.144/28","41.74.179.192/27","102.216.36.0/28","102.216.36.128/28","144.126.193.139/32"].some((range) => { const [prefix,bits] = range.split("/"); return inRange(ip,prefix,Number(bits)); });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const body = rawBody(event);
    const entries = [...new URLSearchParams(body).entries()];
    const data = Object.fromEntries(entries);
    const parameterString = entries.filter(([key, value]) => key !== "signature" && value !== "").map(([key, value]) => `${key}=${encode(value)}`).join("&");
    const expected = createHash("md5").update(`${parameterString}&passphrase=${encode(required("PAYFAST_PASSPHRASE"))}`).digest("hex");
    const received = String(data.signature || "");
    if (expected.length !== received.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(received))) return json(401, { error: "Invalid signature." });
    if (data.merchant_id !== required("PAYFAST_MERCHANT_ID") || data.payment_status !== "COMPLETE") return json(400, { error: "Payment notification is not complete." });
    const sandbox = process.env.PAYFAST_SANDBOX !== "false";
    const sourceIp = (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "").split(",")[0].trim();
    if (!sandbox && process.env.PAYFAST_ENFORCE_IP !== "false" && (!sourceIp || !validPayFastIp(sourceIp))) return json(401, { error: "Notification source is not approved." });
    const validationHost = sandbox ? "sandbox.payfast.co.za" : "www.payfast.co.za";
    const validation = await fetch(`https://${validationHost}/eng/query/validate`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: parameterString });
    if ((await validation.text()).trim() !== "VALID") return json(401, { error: "PayFast did not validate this notification." });
    const orders = await supabaseRequest(`orders?select=id,total_cents,status&public_reference=eq.${encodeURIComponent(data.m_payment_id)}&limit=1`);
    const order = orders[0];
    if (!order || Math.abs(Number(data.amount_gross) * 100 - Number(order.total_cents)) > 1) return json(409, { error: "Payment amount does not match the order." });
    try { await supabaseRequest("webhook_events", { method: "POST", body: { provider: "payfast", event_key: String(data.pf_payment_id), payload: data }, headers: { Prefer: "resolution=ignore-duplicates" } }); } catch (error) { if (!error.message.toLowerCase().includes("duplicate")) throw error; }
    await rpc("finalize_payfast_payment", { p_public_reference: data.m_payment_id, p_provider_reference: String(data.pf_payment_id), p_amount_cents: Math.round(Number(data.amount_gross) * 100), p_payload: data });
    return { statusCode: 200, body: "OK" };
  } catch (error) { return json(500, { error: error.message }); }
};
