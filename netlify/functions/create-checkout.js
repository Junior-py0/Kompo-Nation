const { createHash } = require("node:crypto");
const { authenticatedUser, json, required, rpc, verifyQuote } = require("./lib/runtime");

const encode = (value) => encodeURIComponent(String(value).trim()).replace(/%20/g, "+").replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
const signature = (fields, passphrase) => {
  const string = Object.entries(fields).filter(([, value]) => value !== "" && value !== null && value !== undefined).map(([key, value]) => `${key}=${encode(value)}`).join("&") + `&passphrase=${encode(passphrase)}`;
  return createHash("md5").update(string).digest("hex");
};

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "Method not allowed." });
  try {
    const { user } = await authenticatedUser(event);
    const body = JSON.parse(event.body || "{}");
    if (!body.lines?.length || !body.quotes?.length || body.contact?.email?.toLowerCase() !== user.email?.toLowerCase()) return json(400, { error: "Checkout details are incomplete or do not match the signed-in account." });
    if (body.quotes.some((quote) => !verifyQuote(quote) || quote.destinationPostalCode !== body.address.postalCode)) return json(409, { error: "The delivery quote is invalid or expired. Request a new quote." });
    const order = await rpc("create_checkout", { p_customer_id: user.id, p_lines: body.lines, p_address: body.address, p_contact: body.contact, p_quotes: body.quotes });
    const siteUrl = required("SITE_URL").replace(/\/$/, "");
    const names = String(order.customerName || "Customer").trim().split(/\s+/);
    const fields = {
      merchant_id: required("PAYFAST_MERCHANT_ID"), merchant_key: required("PAYFAST_MERCHANT_KEY"),
      return_url: `${siteUrl}/payment-success`, cancel_url: `${siteUrl}/payment-cancelled`, notify_url: `${siteUrl}/.netlify/functions/payfast-itn`,
      name_first: names[0] || "Customer", name_last: names.slice(1).join(" "), email_address: order.customerEmail, cell_number: order.customerPhone || "",
      m_payment_id: order.publicReference, amount: (Number(order.amountCents) / 100).toFixed(2), item_name: `Kompo Nation ${order.publicReference}`, item_description: "Marketplace order", custom_str1: order.orderId, email_confirmation: "1",
    };
    const splits = Array.isArray(order.splits) ? order.splits : [];
    if (splits.length > 1) return json(409, { error: "PayFast can split one payment with only one receiving merchant. Use one outside store per checkout or connect a multi-recipient gateway." });
    const signedFields = { ...fields, signature: signature(fields, required("PAYFAST_PASSPHRASE")) };
    if (splits.length === 1) signedFields.setup = JSON.stringify({ split_payment: { merchant_id: Number(splits[0].merchantId), amount: Number(splits[0].amountCents) } });
    const sandbox = process.env.PAYFAST_SANDBOX !== "false";
    return json(200, { action: sandbox ? "https://sandbox.payfast.co.za/eng/process" : "https://www.payfast.co.za/eng/process", fields: signedFields, orderReference: order.publicReference });
  } catch (error) {
    const message = error.message.includes("PAYFAST_ONE_SPLIT_LIMIT") ? "PayFast supports only one receiving merchant per payment. This bag contains multiple outside stores; separate the bag by store or use the documented multi-recipient gateway path." : error.message;
    return json(400, { error: message });
  }
};
