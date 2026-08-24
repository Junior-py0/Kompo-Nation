(() => {
const { CONFIG } = window.KOMPO_CONFIG;
const { getSession, signOut, supabase } = window.KOMPO_SUPABASE;

/* ========================================================================== */
/* 01. PORTAL SESSION AND AUTHORIZATION                                       */
/* ========================================================================== */
const area = document.body.dataset.portal;
const gate = document.querySelector("#portal-gate");
const layout = document.querySelector("#portal-layout");
const content = document.querySelector("#portal-content");
const state = { session: null, isAdmin: false, vendorIds: [], stores: [], currentVendorId: null, view: "overview" };
const money = (cents) => new Intl.NumberFormat(CONFIG.locale, { style: "currency", currency: CONFIG.currency }).format(Number(cents || 0) / 100);
const escapeHtml = (value = "") => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);

function toast(message) {
  const element = document.querySelector("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 3000);
}

function deny(title, message, signIn = false) {
  gate.innerHTML = `<section class="portal-alert glass"><p class="eyebrow">PROTECTED AREA</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="primary-button" href="${signIn ? `/login?next=/${area}` : "/"}">${signIn ? "Sign in" : "Return to store"}</a></section>`;
}

async function authorize() {
  if (!supabase) {
    deny("Database connection required", "This portal stays locked until config.js contains the Supabase project URL and publishable key.");
    return false;
  }
  state.session = await getSession();
  if (!state.session) {
    const loginUrl = location.protocol === "file:"
      ? `./login.html?next=${encodeURIComponent(`/${area}`)}`
      : `/login?next=${encodeURIComponent(`/${area}`)}`;
    location.replace(loginUrl);
    return false;
  }
  const userId = state.session.user.id;
  const [{ data: roles, error: roleError }, { data: memberships, error: memberError }] = await Promise.all([
    supabase.from("platform_roles").select("role").eq("user_id", userId),
    supabase.from("vendor_members").select("vendor_id,status").eq("user_id", userId).eq("status", "active"),
  ]);
  if (roleError || memberError) throw roleError || memberError;
  state.isAdmin = roles.some((row) => ["owner", "admin"].includes(row.role));
  state.vendorIds = memberships.map((row) => row.vendor_id);
  if (area === "admin" && !state.isAdmin) {
    deny("Operator access is not assigned", "This signed-in account can still shop normally, but it does not have an operator role.");
    return false;
  }
  if (area === "vendor" && !state.isAdmin && !state.vendorIds.length) {
    deny("Vendor access is not assigned", "This signed-in account can still shop normally, but it does not belong to an active store.");
    return false;
  }
  const storeQuery = supabase.from("vendors").select("id,business_name,slug,status,commission_rate_bps,is_platform_owned,sales_count,featured_override").order("business_name");
  const { data: stores, error: storeError } = state.isAdmin ? await storeQuery : await storeQuery.in("id", state.vendorIds);
  if (storeError) throw storeError;
  state.stores = stores;
  state.currentVendorId = stores[0]?.id || null;
  return true;
}

/* ========================================================================== */
/* 02. PORTAL SHELL                                                           */
/* ========================================================================== */
function storeSelector() {
  if (area !== "vendor" || state.stores.length < 2) return "";
  return `<label class="store-selector">Working in<select class="field" id="store-selector">${state.stores.map((store) => `<option value="${store.id}" ${store.id === state.currentVendorId ? "selected" : ""}>${escapeHtml(store.business_name)}</option>`).join("")}</select></label>`;
}

function header(eyebrow, title, description, action = "") {
  return `<header class="dashboard-header"><div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p></div><div>${storeSelector()}${action}</div></header>`;
}

function setActiveView(view) {
  state.view = view;
  document.querySelectorAll("#portal-nav [data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  renderView().catch(showError);
}

function setupShell() {
  document.querySelector("#portal-identity").textContent = state.session.user.email;
  document.querySelectorAll("#portal-nav [data-view]").forEach((button) => button.addEventListener("click", () => setActiveView(button.dataset.view)));
  document.querySelector("#signout-button").addEventListener("click", async () => { await signOut(); location.href = location.protocol === "file:" ? "./index.html" : "/"; });
  document.querySelector("#portal-menu").addEventListener("click", () => document.querySelector(".portal-sidebar").classList.toggle("open"));
  content.addEventListener("change", (event) => {
    if (event.target.id === "store-selector") { state.currentVendorId = event.target.value; renderView().catch(showError); }
  });
  content.addEventListener("click", handlePortalClick);
  content.addEventListener("submit", handlePortalSubmit);
}

function showError(error) {
  console.error(error);
  content.innerHTML = `<section class="portal-alert glass"><p class="eyebrow">ACTION NEEDED</p><h1>The portal could not load this view.</h1><p>${escapeHtml(error.message)}</p><button class="primary-button" onclick="location.reload()">Try again</button></section>`;
}

/* ========================================================================== */
/* 03. OVERVIEW                                                               */
/* ========================================================================== */
async function renderOverview() {
  const orderQuery = supabase.from("vendor_orders").select("id,merchandise_total_cents,commission_total_cents,fulfilment_status,created_at,vendors(business_name)").order("created_at", { ascending: false }).limit(50);
  const { data: orders, error } = area === "vendor" ? await orderQuery.eq("vendor_id", state.currentVendorId) : await orderQuery;
  if (error) throw error;
  const gross = orders.reduce((sum, order) => sum + Number(order.merchandise_total_cents), 0);
  const commission = orders.reduce((sum, order) => sum + Number(order.commission_total_cents), 0);
  const open = orders.filter((order) => !["delivered", "cancelled"].includes(order.fulfilment_status)).length;
  content.innerHTML = `${header(area === "admin" ? "CONTROL ROOM" : "STORE PULSE", area === "admin" ? "Nation overview" : "Your store today", area === "admin" ? "Marketplace activity across every active store." : "Sales and fulfilment for the selected store.")}
    <div class="stat-grid"><article class="stat-card"><span>Merchandise value</span><strong>${money(gross)}</strong><small>Loaded order history</small></article><article class="stat-card"><span>Commission recorded</span><strong>${money(commission)}</strong><small>Item-level calculation</small></article><article class="stat-card"><span>Open packages</span><strong>${open}</strong><small>Still moving</small></article><article class="stat-card"><span>${area === "admin" ? "Active stores" : "Products sold"}</span><strong>${area === "admin" ? state.stores.filter((store) => store.status === "active").length : orders.length}</strong><small>Current view</small></article></div>
    <div class="dashboard-grid"><section class="dashboard-panel"><div class="panel-heading"><h2>Latest movement</h2><button class="table-action" data-open-view="orders">View orders</button></div>${orders.slice(0, 7).map((order) => { const vendor = Array.isArray(order.vendors) ? order.vendors[0] : order.vendors; return `<article class="order-card"><div><strong>${escapeHtml(vendor?.business_name || "Store")}</strong><p>${new Date(order.created_at).toLocaleString(CONFIG.locale)}</p></div><span class="status-pill">${escapeHtml(order.fulfilment_status.replaceAll("_", " "))}</span></article>`; }).join("") || "<p>No paid packages are available yet.</p>"}</section><section class="dashboard-panel"><div class="panel-heading"><h2>Operating rule</h2></div><p>${area === "admin" ? "Operator permission is checked by Supabase RLS on every database request. Opening this page does not bypass the database." : "Online stock must remain separate from stock promised elsewhere. Update it before accepting new sales."}</p></section></div>`;
}

/* ========================================================================== */
/* 04. STORE MANAGEMENT                                                       */
/* ========================================================================== */
async function renderStores() {
  content.innerHTML = `${header("STORE NETWORK", "Stores", "Add, activate, suspend and curate marketplace businesses.", '<button class="primary-button" data-toggle-form="store-form">Add store</button>')}
    <section class="dashboard-panel" id="store-form" hidden><div class="panel-heading"><h2>New store</h2></div><form class="stack-form dashboard-form" data-form="store"><div class="form-grid"><label>Business name<input name="business_name" required></label><label>URL slug<input name="slug" pattern="[a-z0-9-]+" required></label></div><div class="form-grid"><label>Contact email<input name="contact_email" type="email" required></label><label>Commission percent<input name="commission_percent" type="number" min="0" max="40" step=".1" value="10" required></label></div><label>Short description<input name="short_description" required></label><label>Full description<textarea name="description" required></textarea></label><div class="form-grid"><label>Mark<input name="mark" maxlength="3" required></label><label>Visual tone<select name="accent"><option>sage</option><option>mist</option><option>sand</option><option>stone</option></select></label></div><button class="primary-button">Create store</button><p class="form-message"></p></form></section>
    <section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Store</th><th>Status</th><th>Commission</th><th>Sales</th><th>Homepage</th><th>Action</th></tr></thead><tbody>${state.stores.map((store) => `<tr><td><strong>${escapeHtml(store.business_name)}</strong><br><small>/${escapeHtml(store.slug)}</small></td><td><span class="status-pill">${escapeHtml(store.status)}</span></td><td>${(Number(store.commission_rate_bps) / 100).toFixed(1)}%</td><td>${Number(store.sales_count)}</td><td>${store.featured_override === true ? "Pinned" : store.featured_override === false ? "Hidden" : "Automatic"}</td><td><button class="table-action" data-store-status="${store.id}" data-next-status="${store.status === "active" ? "suspended" : "active"}">${store.status === "active" ? "Suspend" : "Activate"}</button></td></tr>`).join("")}</tbody></table></div></section>`;
}

async function createStore(form) {
  const values = Object.fromEntries(new FormData(form));
  const row = { business_name: values.business_name.trim(), slug: values.slug.trim().toLowerCase(), contact_email: values.contact_email.trim().toLowerCase(), commission_rate_bps: Math.round(Number(values.commission_percent) * 100), short_description: values.short_description.trim(), description: values.description.trim(), mark: values.mark.trim().toUpperCase(), accent: values.accent, status: "pending" };
  const { contact_email: contactEmail, ...publicRow } = row;
  const { data: created, error } = await supabase.from("vendors").insert(publicRow).select("id").single();
  if (error) throw error;
  const { error: privateError } = await supabase.from("vendor_private_settings").insert({ vendor_id: created.id, contact_email: contactEmail });
  if (privateError) throw privateError;
  const { data } = await supabase.from("vendors").select("*").order("business_name");
  state.stores = data;
  toast("Store created in pending status.");
  renderStores();
}

/* ========================================================================== */
/* 05. PRODUCT MANAGEMENT                                                     */
/* ========================================================================== */
async function renderProducts() {
  const query = supabase.from("products").select("id,vendor_id,name,slug,category,status,sales_count,is_rare,tone,description,vendors(business_name),product_variants(id,sku,size,colour,price_cents,stock_quantity,weight_kg,length_cm,width_cm,height_cm,active)").order("created_at", { ascending: false });
  const { data: products, error } = area === "vendor" ? await query.eq("vendor_id", state.currentVendorId) : await query;
  if (error) throw error;
  const vendorOptions = (area === "admin" ? state.stores : state.stores.filter((store) => store.id === state.currentVendorId)).map((store) => `<option value="${store.id}">${escapeHtml(store.business_name)}</option>`).join("");
  content.innerHTML = `${header("CATALOGUE", "Products", "Manage online pieces, variants, prices and stock.", '<button class="primary-button" data-toggle-form="product-form">Add product</button>')}
    <section class="dashboard-panel" id="product-form" hidden><div class="panel-heading"><h2>Product and first variant</h2></div><form class="stack-form dashboard-form" data-form="product"><label>Store<select name="vendor_id" required>${vendorOptions}</select></label><div class="form-grid"><label>Product name<input name="name" required></label><label>URL slug<input name="slug" pattern="[a-z0-9-]+" required></label></div><div class="form-grid"><label>Category<input name="category" required></label><label>SKU<input name="sku" required></label></div><label>Description<textarea name="description" required></textarea></label><div class="form-grid"><label>Size<input name="size" value="One size" required></label><label>Colour<input name="colour" value="Black" required></label></div><div class="form-grid"><label>Price in rand<input name="price_rand" type="number" min="5" step=".01" required></label><label>Online stock<input name="stock_quantity" type="number" min="0" step="1" required></label></div><div class="form-grid"><label>Weight kg<input name="weight_kg" type="number" min=".01" step=".01" value="0.35" required></label><label>Dimensions L Ã— W Ã— H cm<input name="dimensions" value="42x32x6" pattern="[0-9.]+x[0-9.]+x[0-9.]+" required></label></div><button class="primary-button">Save product</button><p class="form-message"></p></form></section>
    <section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Product</th><th>Store</th><th>Price</th><th>Online stock</th><th>Status</th><th>Sales</th></tr></thead><tbody>${products.map((product) => { const vendor = Array.isArray(product.vendors) ? product.vendors[0] : product.vendors; const variants = product.product_variants || []; return `<tr><td><strong>${escapeHtml(product.name)}</strong><br><small>${escapeHtml(variants[0]?.sku || "No SKU")}</small></td><td>${escapeHtml(vendor?.business_name)}</td><td>${variants.length ? money(Math.min(...variants.map((variant) => Number(variant.price_cents)))) : "â€”"}</td><td>${variants.reduce((sum, variant) => sum + Number(variant.stock_quantity), 0)}</td><td><span class="status-pill">${escapeHtml(product.status)}</span></td><td>${Number(product.sales_count)}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}

async function createProduct(form) {
  const values = Object.fromEntries(new FormData(form));
  const [lengthCm, widthCm, heightCm] = values.dimensions.toLowerCase().split("x").map(Number);
  const { error } = await supabase.rpc("save_product", { p_vendor_id: values.vendor_id, p_name: values.name.trim(), p_slug: values.slug.trim().toLowerCase(), p_category: values.category.trim(), p_description: values.description.trim(), p_tone: "sage", p_is_rare: false, p_sku: values.sku.trim().toUpperCase(), p_size: values.size.trim(), p_colour: values.colour.trim(), p_price_cents: Math.round(Number(values.price_rand) * 100), p_stock_quantity: Number(values.stock_quantity), p_weight_kg: Number(values.weight_kg), p_length_cm: lengthCm, p_width_cm: widthCm, p_height_cm: heightCm });
  if (error) throw error;
  toast("Product saved.");
  renderProducts();
}

/* ========================================================================== */
/* 06. ORDER AND RETURN MANAGEMENT                                            */
/* ========================================================================== */
async function renderOrders() {
  const query = supabase.from("vendor_orders").select("id,public_reference,vendor_id,fulfilment_status,merchandise_total_cents,shipping_charge_cents,commission_total_cents,created_at,orders(customer_name,customer_email),vendors(business_name)").order("created_at", { ascending: false }).limit(150);
  const { data: orders, error } = area === "vendor" ? await query.eq("vendor_id", state.currentVendorId) : await query;
  if (error) throw error;
  content.innerHTML = `${header("FULFILMENT", "Orders", "Each store package moves independently after one customer checkout.")}<section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Package</th><th>Store</th><th>Customer</th><th>Value</th><th>Commission</th><th>Status</th><th>Move</th></tr></thead><tbody>${orders.map((order) => { const vendor = Array.isArray(order.vendors) ? order.vendors[0] : order.vendors; const parent = Array.isArray(order.orders) ? order.orders[0] : order.orders; const next = ({ new: "accepted", accepted: "packing", packing: "packed", packed: "ready_for_collection" })[order.fulfilment_status]; const action = next ? `<button class="table-action" data-order-status="${order.id}" data-next-status="${next}">Mark ${escapeHtml(next.replaceAll("_", " "))}</button>` : order.fulfilment_status === "ready_for_collection" ? `<button class="table-action" data-book-shipment="${order.id}">Book collection</button>` : "â€”"; return `<tr><td><strong>${escapeHtml(order.public_reference)}</strong><br><small>${new Date(order.created_at).toLocaleDateString(CONFIG.locale)}</small></td><td>${escapeHtml(vendor?.business_name)}</td><td>${escapeHtml(parent?.customer_name)}<br><small>${escapeHtml(parent?.customer_email)}</small></td><td>${money(Number(order.merchandise_total_cents) + Number(order.shipping_charge_cents))}</td><td>${money(order.commission_total_cents)}</td><td><span class="status-pill">${escapeHtml(order.fulfilment_status.replaceAll("_", " "))}</span></td><td>${action}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}

async function renderReturns() {
  const query = supabase.from("returns").select("id,public_reference,vendor_id,reason,status,refund_amount_cents,requested_at,vendors(business_name),profiles(full_name)").order("requested_at", { ascending: false }).limit(100);
  const { data: returns, error } = area === "vendor" ? await query.eq("vendor_id", state.currentVendorId) : await query;
  if (error) throw error;
  content.innerHTML = `${header("AFTER-SALES", "Returns", "Review submitted requests, received items and recorded refund outcomes.")}<section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Return</th><th>Store</th><th>Customer</th><th>Reason</th><th>Value</th><th>Status</th><th>Move</th></tr></thead><tbody>${returns.map((item) => { const vendor = Array.isArray(item.vendors) ? item.vendors[0] : item.vendors; const customer = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles; const actions = item.status === "requested" ? `<button class="table-action" data-return-status="${item.id}" data-next-status="approved">Approve</button> <button class="table-action" data-return-status="${item.id}" data-next-status="declined">Decline</button>` : ["approved","in_transit"].includes(item.status) ? `<button class="table-action" data-return-status="${item.id}" data-next-status="received">Mark received</button>` : item.status === "received" && state.isAdmin ? `<button class="table-action" data-return-status="${item.id}" data-next-status="refunded">Confirm refunded</button>` : "â€”"; return `<tr><td><strong>${escapeHtml(item.public_reference)}</strong></td><td>${escapeHtml(vendor?.business_name)}</td><td>${escapeHtml(customer?.full_name || "Customer")}</td><td>${escapeHtml(item.reason.replaceAll("_", " "))}</td><td>${money(item.refund_amount_cents)}</td><td><span class="status-pill">${escapeHtml(item.status.replaceAll("_", " "))}</span></td><td>${actions}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}

async function renderCancellations() {
  const { data: requests, error } = await supabase.from("order_cancellation_requests").select("id,public_reference,reason,status,refund_amount_cents,requested_at,vendors(business_name),profiles(full_name),vendor_orders(public_reference)").order("requested_at", { ascending: false }).limit(100);
  if (error) throw error;
  content.innerHTML = `${header("PAYMENT CONTROL", "Cancellations", "Review customer requests before recording the PayFast refund outcome.")}<section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Request</th><th>Package</th><th>Store</th><th>Customer</th><th>Value</th><th>Status</th><th>Review</th></tr></thead><tbody>${requests.map((item) => { const vendor = Array.isArray(item.vendors) ? item.vendors[0] : item.vendors; const customer = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles; const vendorOrder = Array.isArray(item.vendor_orders) ? item.vendor_orders[0] : item.vendor_orders; return `<tr><td><strong>${escapeHtml(item.public_reference)}</strong><br><small>${escapeHtml(item.reason)}</small></td><td>${escapeHtml(vendorOrder?.public_reference)}</td><td>${escapeHtml(vendor?.business_name)}</td><td>${escapeHtml(customer?.full_name || "Customer")}</td><td>${money(item.refund_amount_cents)}</td><td><span class="status-pill">${escapeHtml(item.status.replaceAll("_", " "))}</span></td><td>${item.status === "requested" ? `<button class="table-action" data-cancellation-status="${item.id}" data-next-status="under_review">Review</button>` : "Confirm in PayFast"}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}

/* ========================================================================== */
/* 07. SETTINGS                                                               */
/* ========================================================================== */
async function renderSettings() {
  if (area === "admin") {
    const { data, error } = await supabase.from("marketplace_settings").select("key,value").order("key");
    if (error) throw error;
    const value = (key, fallback) => data.find((item) => item.key === key)?.value ?? fallback;
    content.innerHTML = `${header("PLATFORM RULES", "Settings", "Controls stored in the database and protected by operator RLS.")}<section class="dashboard-panel"><form class="stack-form dashboard-form" data-form="admin-settings"><div class="form-grid"><label>Default commission percent<input name="default_commission" type="number" min="0" max="40" step=".1" value="${Number(value("default_commission_rate_bps",1000))/100}"></label><label>Stock reservation minutes<input name="reservation_minutes" type="number" min="5" max="60" value="${Number(value("stock_reservation_minutes",15))}"></label></div><div class="form-grid"><label>First reminder hours<input name="reminder_hours" type="number" min="1" value="${Number(value("fulfilment_reminder_hours",24))}"></label><label>Escalation hours<input name="escalation_hours" type="number" min="2" value="${Number(value("fulfilment_escalation_hours",72))}"></label></div><button class="primary-button">Save platform settings</button><p class="form-message"></p></form></section>`;
    return;
  }
  const { data: privateRow, error } = await supabase.from("vendor_private_settings").select("contact_email,contact_phone,collection_street_address,collection_city,collection_province,collection_postal_code").eq("vendor_id", state.currentVendorId).maybeSingle();
  if (error) throw error;
  const settings = privateRow || {};
  content.innerHTML = `${header("STORE SETTINGS", "Collection and contact", "Courier quotes depend on a complete physical collection address.")}<section class="dashboard-panel"><form class="stack-form dashboard-form" data-form="vendor-settings"><div class="form-grid"><label>Contact email<input name="contact_email" type="email" value="${escapeHtml(settings.contact_email || "")}" required></label><label>Contact phone<input name="contact_phone" value="${escapeHtml(settings.contact_phone || "")}" required></label></div><label>Collection street address<input name="collection_street_address" value="${escapeHtml(settings.collection_street_address || "")}" required></label><div class="form-grid"><label>Collection city<input name="collection_city" value="${escapeHtml(settings.collection_city || "Polokwane")}" required></label><label>Postal code<input name="collection_postal_code" value="${escapeHtml(settings.collection_postal_code || "0700")}" required></label></div><label>Province<input name="collection_province" value="${escapeHtml(settings.collection_province || "Limpopo")}" required></label><button class="primary-button">Save store settings</button><p class="form-message"></p></form></section>`;
}

/* ========================================================================== */
/* 08. MUTATION HANDLERS                                                      */
/* ========================================================================== */
async function handlePortalClick(event) {
  const openView = event.target.closest("[data-open-view]");
  if (openView) return setActiveView(openView.dataset.openView);
  const toggle = event.target.closest("[data-toggle-form]");
  if (toggle) { const target = document.querySelector(`#${CSS.escape(toggle.dataset.toggleForm)}`); target.hidden = !target.hidden; return; }
  const storeStatus = event.target.closest("[data-store-status]");
  if (storeStatus) {
    const { error } = await supabase.rpc("admin_set_vendor_status", { p_vendor_id: storeStatus.dataset.storeStatus, p_status: storeStatus.dataset.nextStatus });
    if (error) return toast(error.message);
    state.stores.find((store) => store.id === storeStatus.dataset.storeStatus).status = storeStatus.dataset.nextStatus;
    toast("Store status updated.");
    return renderStores();
  }
  const orderStatus = event.target.closest("[data-order-status]");
  if (orderStatus) {
    const { error } = await supabase.rpc("move_vendor_order", { p_vendor_order_id: orderStatus.dataset.orderStatus, p_next_status: orderStatus.dataset.nextStatus });
    if (error) return toast(error.message);
    toast("Order status updated.");
    return renderOrders();
  }
  const shipment = event.target.closest("[data-book-shipment]");
  if (shipment) {
    shipment.disabled = true;
    shipment.textContent = "Bookingâ€¦";
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch(`${CONFIG.functionsBase}/book-shipment`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ vendorOrderId: shipment.dataset.bookShipment }) });
    const payload = await response.json();
    if (!response.ok) { shipment.disabled = false; shipment.textContent = "Book collection"; return toast(payload.error || "Collection could not be booked."); }
    toast(payload.alreadyBooked ? "This collection was already booked." : "Courier collection booked.");
    return renderOrders();
  }
  const cancellation = event.target.closest("[data-cancellation-status]");
  if (cancellation) {
    const { error } = await supabase.from("order_cancellation_requests").update({ status: cancellation.dataset.nextStatus, updated_at: new Date().toISOString() }).eq("id", cancellation.dataset.cancellationStatus);
    if (error) return toast(error.message);
    toast("Cancellation moved to review.");
    return renderCancellations();
  }
  const returnStatus = event.target.closest("[data-return-status]");
  if (returnStatus) {
    const { error } = await supabase.rpc("review_return", { p_return_id: returnStatus.dataset.returnStatus, p_next_status: returnStatus.dataset.nextStatus });
    if (error) return toast(error.message);
    toast("Return status updated.");
    return renderReturns();
  }
}

async function handlePortalSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const message = form.querySelector(".form-message");
  try {
    if (form.dataset.form === "store") await createStore(form);
    if (form.dataset.form === "product") await createProduct(form);
    if (form.dataset.form === "vendor-settings") {
      const values = Object.fromEntries(new FormData(form));
      const { error } = await supabase.from("vendor_private_settings").update(values).eq("vendor_id", state.currentVendorId);
      if (error) throw error;
      toast("Store settings saved.");
    }
    if (form.dataset.form === "admin-settings") {
      const values = Object.fromEntries(new FormData(form));
      const updates = [
        ["default_commission_rate_bps", Math.round(Number(values.default_commission) * 100)],
        ["stock_reservation_minutes", Number(values.reservation_minutes)],
        ["fulfilment_reminder_hours", Number(values.reminder_hours)],
        ["fulfilment_escalation_hours", Number(values.escalation_hours)],
      ];
      for (const [key, value] of updates) {
        const { error } = await supabase.from("marketplace_settings").upsert({ key, value, updated_by: state.session.user.id });
        if (error) throw error;
      }
      toast("Platform settings saved.");
    }
  } catch (error) { message.textContent = error.message; }
}

async function renderView() {
  if (state.view === "overview") return renderOverview();
  if (state.view === "stores") return renderStores();
  if (state.view === "products") return renderProducts();
  if (state.view === "orders") return renderOrders();
  if (state.view === "cancellations") return renderCancellations();
  if (state.view === "returns") return renderReturns();
  if (state.view === "settings") return renderSettings();
}

/* ========================================================================== */
/* 09. STARTUP                                                                */
/* ========================================================================== */
authorize().then((allowed) => {
  if (!allowed) return;
  gate.hidden = true;
  layout.hidden = false;
  setupShell();
  renderView().catch(showError);
}).catch((error) => deny("Access check failed", error.message));
})();
