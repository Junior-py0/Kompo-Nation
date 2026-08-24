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
  if (area === "vendor" && !state.vendorIds.length) {
    const adminAction = state.isAdmin
      ? '<a class="primary-button" href="/admin">Open admin control room</a>'
      : '<a class="primary-button" href="/">Return to store</a>';

    gate.innerHTML = `<section class="portal-alert glass">
      <p class="eyebrow">STORE ACCESS</p>
      <h1>No vendor store is assigned to this account.</h1>
      <p>${state.isAdmin
        ? "Your Kompo Nation admin role does not automatically grant vendor-store access. Assign this account to a store from Admin → Stores → Manage → Store team."
        : "Ask a Kompo Nation administrator to add your account to the correct store."}</p>
      ${adminAction}
    </section>`;

    return false;
  }
  const storeQuery = supabase.from("vendors").select("id,business_name,slug,status,commission_rate_bps,is_platform_owned,sales_count,featured_override").order("business_name").is("retired_at", null);
  const { data: stores, error: storeError } = area === "admin"
    ? await storeQuery
    : state.vendorIds.length
      ? await storeQuery.in("id", state.vendorIds)
      : { data: [], error: null };
  if (storeError) throw storeError;
  state.stores = stores || [];
  state.currentVendorId = state.stores[0]?.id || null;
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
async function loadStoreTeamPanel(vendorId) {
  const host = document.querySelector(`#store-team-${CSS.escape(vendorId)}`);
  if (!host) return;

  host.innerHTML = `<p class="muted-copy">Loading store team…</p>`;

  const { data: members, error } = await supabase.rpc(
    "admin_list_vendor_members",
    { p_vendor_id: vendorId }
  );

  if (error) {
    host.innerHTML = `<div class="inline-alert">${escapeHtml(error.message)}</div>`;
    return;
  }

  host.innerHTML = `
    <div class="store-team-list">
      ${(members || []).map((member) => `
        <article class="store-member-row">
          <div>
            <strong>${escapeHtml(member.full_name || member.email)}</strong>
            <p>${escapeHtml(member.email)}</p>
          </div>

          <label>
            Role
            <select data-member-role="${member.user_id}">
              <option value="owner" ${member.role === "owner" ? "selected" : ""}>Owner</option>
              <option value="manager" ${member.role === "manager" ? "selected" : ""}>Manager</option>
              <option value="catalogue" ${member.role === "catalogue" ? "selected" : ""}>Catalogue</option>
              <option value="fulfilment" ${member.role === "fulfilment" ? "selected" : ""}>Fulfilment</option>
            </select>
          </label>

          <label>
            Status
            <select data-member-status="${member.user_id}">
              <option value="active" ${member.status === "active" ? "selected" : ""}>Active</option>
              <option value="invited" ${member.status === "invited" ? "selected" : ""}>Invited</option>
              <option value="suspended" ${member.status === "suspended" ? "selected" : ""}>Suspended</option>
            </select>
          </label>

          <div class="terminal-actions">
            <button
              class="table-action"
              type="button"
              data-save-store-member="${member.user_id}"
              data-member-vendor="${vendorId}"
            >Save</button>

            <button
              class="table-action danger-action"
              type="button"
              data-remove-store-member="${member.user_id}"
              data-member-vendor="${vendorId}"
            >Remove</button>
          </div>
        </article>
      `).join("") || `
        <div class="empty-mini-state">
          <strong>No one is assigned to this store yet.</strong>
          <p>Add an existing Kompo Nation account below.</p>
        </div>
      `}
    </div>

    <form class="stack-form compact-form store-team-add" data-form="store-member">
      <input type="hidden" name="vendor_id" value="${vendorId}">

      <div class="form-grid">
        <label>
          Account email
          <input
            name="email"
            type="email"
            required
            placeholder="person@example.com"
            autocomplete="off"
          >
        </label>

        <label>
          Role
          <select name="role">
            <option value="owner">Owner</option>
            <option value="manager" selected>Manager</option>
            <option value="catalogue">Catalogue</option>
            <option value="fulfilment">Fulfilment</option>
          </select>
        </label>
      </div>

      <button class="primary-button">Add to store</button>
      <p class="form-message"></p>
      <small>The person must already have a Kompo Nation account. You only enter their email. No technical account ID is needed.</small>
    </form>`;
}

async function renderStores() {
  const { data: stores, error } = await supabase
    .from("vendors")
    .select("id,business_name,slug,status,commission_rate_bps,is_platform_owned,sales_count,featured_override,short_description,description,mark,accent,vendor_private_settings(contact_email)")
    .order("business_name")
    .is("retired_at", null);

  if (error) throw error;
  state.stores = stores || [];

  const rows = state.stores.map((store) => {
    const privateRow = Array.isArray(store.vendor_private_settings)
      ? store.vendor_private_settings[0]
      : store.vendor_private_settings;

    const featuredValue = store.featured_override === true
      ? "pinned"
      : store.featured_override === false
        ? "hidden"
        : "automatic";

    return `<article class="terminal-product-card">
      <div class="terminal-product-summary">
        <div>
          <p class="eyebrow">${store.is_platform_owned ? "KOMPO-OWNED" : "PARTNER STORE"}</p>
          <h2>${escapeHtml(store.business_name)}</h2>
          <p>${escapeHtml(store.short_description || "No storefront tagline yet.")}</p>
          <small>Public path: /store/${escapeHtml(store.slug)}</small>
        </div>
        <div class="terminal-actions">
          <span class="status-pill">${escapeHtml(store.status)}</span>
          <button class="table-action" type="button" data-manage-store="${store.id}">Manage</button>
          <button class="table-action" data-store-status="${store.id}" data-next-status="${store.status === "active" ? "suspended" : "active"}">${store.status === "active" ? "Suspend" : "Activate"}</button>
        </div>
      </div>

      <section class="terminal-product-panel" id="store-manage-${store.id}" hidden>
        <div class="stack-form compact-form">
          <div class="form-grid">
            <label>Business name
              <input data-store-name="${store.id}" value="${escapeHtml(store.business_name)}">
            </label>
            <label>Contact email
              <input data-store-email="${store.id}" type="email" value="${escapeHtml(privateRow?.contact_email || "")}">
            </label>
          </div>

          <div class="form-grid">
            <label>Kompo commission %
              <input data-store-commission="${store.id}" type="number" min="0" max="40" step=".1" value="${(Number(store.commission_rate_bps) / 100).toFixed(1)}">
            </label>
            <label>Store badge (1–3 characters)
              <input data-store-mark="${store.id}" maxlength="3" value="${escapeHtml(store.mark || "")}">
            </label>
          </div>

          <label>Storefront tagline
            <input data-store-short="${store.id}" value="${escapeHtml(store.short_description || "")}">
          </label>

          <label>Full store description
            <textarea data-store-description="${store.id}">${escapeHtml(store.description || "")}</textarea>
          </label>

          <div class="form-grid">
            <label>Brand palette
              <select data-store-accent="${store.id}">
                <option value="sage" ${store.accent === "sage" ? "selected" : ""}>Sage green</option>
                <option value="mist" ${store.accent === "mist" ? "selected" : ""}>Cool mist</option>
                <option value="sand" ${store.accent === "sand" ? "selected" : ""}>Warm sand</option>
                <option value="stone" ${store.accent === "stone" ? "selected" : ""}>Stone</option>
              </select>
            </label>

            <label>Homepage visibility
              <select data-store-featured="${store.id}">
                <option value="automatic" ${featuredValue === "automatic" ? "selected" : ""}>Automatic</option>
                <option value="pinned" ${featuredValue === "pinned" ? "selected" : ""}>Prioritise on homepage</option>
                <option value="hidden" ${featuredValue === "hidden" ? "selected" : ""}>Do not feature</option>
              </select>
            </label>
          </div>

          <label class="switch-line">
            <input data-store-platform-owned="${store.id}" type="checkbox" ${store.is_platform_owned ? "checked" : ""}>
            Kompo Nation owns this store
          </label>

          <button class="primary-button" type="button" data-save-store="${store.id}">Save store</button>
          <section class="store-team-box">
            <div class="panel-heading">
              <div>
                <h3>Store team</h3>
                <p>Choose who can operate this store and what they are responsible for.</p>
              </div>

              <button
                class="table-action"
                type="button"
                data-load-store-team="${store.id}"
              >Manage team</button>
            </div>

            <div id="store-team-${store.id}">
              <p class="muted-copy">Select “Manage team” to load this store’s members.</p>
            </div>
          </section>

          <p><small>The public URL is generated automatically when the store is created and stays stable if the business name changes.</small></p>
        </div>
      </section>
    </article>`;
  }).join("");

  content.innerHTML = `${header(
    "STORE NETWORK",
    "Stores",
    "Create and operate partner stores without exposing technical fields.",
    '<button class="primary-button" data-toggle-form="store-form">Add store</button>'
  )}
    <section class="dashboard-panel" id="store-form" hidden>
      <div class="panel-heading">
        <div>
          <h2>Add a store</h2>
          <p>Kompo Nation generates the public store URL automatically.</p>
        </div>
      </div>

      <form class="stack-form dashboard-form" data-form="store">
        <div class="form-grid">
          <label>Business name<input name="business_name" required placeholder="King of Kasi Tribes"></label>
          <label>Contact email<input name="contact_email" type="email" required></label>
        </div>

        <div class="form-grid">
          <label>Kompo commission %
            <input name="commission_percent" type="number" min="0" max="40" step=".1" value="10" required>
          </label>
          <label>Store badge (1–3 characters)
            <input name="mark" maxlength="3" required placeholder="KOK">
          </label>
        </div>

        <label>Storefront tagline
          <input name="short_description" required placeholder="Short line customers see around the marketplace">
        </label>

        <label>Full store description
          <textarea name="description" required placeholder="Tell customers what the brand represents."></textarea>
        </label>

        <div class="form-grid">
          <label>Brand palette
            <select name="accent">
              <option value="sage">Sage green</option>
              <option value="mist">Cool mist</option>
              <option value="sand">Warm sand</option>
              <option value="stone">Stone</option>
            </select>
          </label>

          <label class="switch-line">
            <input name="is_platform_owned" type="checkbox">
            Kompo Nation owns this store
          </label>
        </div>

        <button class="primary-button">Create store</button>
        <p class="form-message"></p>
      </form>
    </section>

    <section class="terminal-product-list">
      ${rows || '<section class="dashboard-panel"><p>No stores yet.</p></section>'}
    </section>`;
}

async function createStore(form) {
  const values = Object.fromEntries(new FormData(form));

  const { error } = await supabase.rpc("admin_create_vendor_v2", {
    p_business_name: values.business_name.trim(),
    p_contact_email: values.contact_email.trim().toLowerCase(),
    p_commission_rate_bps: Math.round(Number(values.commission_percent) * 100),
    p_short_description: values.short_description.trim(),
    p_description: values.description.trim(),
    p_mark: values.mark.trim().toUpperCase(),
    p_accent: values.accent,
    p_is_platform_owned: values.is_platform_owned === "on",
  });

  if (error) throw error;

  toast("Store created. Its public URL was generated automatically.");
  renderStores();
}

/* ========================================================================== */
/* 05. PRODUCT MANAGEMENT                                                     */
/* ========================================================================== */
const SIZE_PRESETS = ["XS","S","M","L","XL","2XL","3XL","One size"];
const listValues = (value) => [...new Set(String(value || "").split(",").map((v) => v.trim()).filter(Boolean))];

function sizePicker() {
  return SIZE_PRESETS.map((size) =>
    `<label class="size-check"><input type="checkbox" name="sizes" value="${escapeHtml(size)}"><span>${escapeHtml(size)}</span></label>`
  ).join("");
}

async function uploadProductImages(productId, vendorId, files, altText = "") {
  const items = [...(files || [])];
  if (!items.length) return;
  const { data: existing, error: existingError } = await supabase.from("product_media").select("sort_order").eq("product_id", productId).order("sort_order", { ascending: false }).limit(1);
  if (existingError) throw existingError;
  let sortOrder = Number(existing?.[0]?.sort_order ?? -1) + 1;

  for (const file of items) {
    if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
    if (file.size > 5 * 1024 * 1024) throw new Error(`${file.name} is larger than 5 MB.`);
    const ext = (file.name.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg";
    const path = `${vendorId}/${productId}/${crypto.randomUUID()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("product-images").upload(path, file, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    const { data: urlData } = supabase.storage.from("product-images").getPublicUrl(path);
    const { error: mediaError } = await supabase.from("product_media").insert({
      product_id: productId,
      storage_path: path,
      public_url: urlData.publicUrl,
      alt_text: altText.trim() || file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "),
      sort_order: sortOrder++,
    });
    if (mediaError) {
      await supabase.storage.from("product-images").remove([path]);
      throw mediaError;
    }
  }
}

async function renderProducts() {
  const query = supabase.from("products")
    .select("id,vendor_id,name,slug,category,status,sales_count,is_rare,description,vendors(business_name),product_media(id,storage_path,public_url,alt_text,sort_order),product_variants(id,sku,size,colour,price_cents,stock_quantity,weight_kg,length_cm,width_cm,height_cm,active)")
    .order("created_at", { ascending: false });

  const { data: products, error } = area === "vendor" ? await query.eq("vendor_id", state.currentVendorId) : await query;
  if (error) throw error;

  const vendorOptions = (area === "admin" ? state.stores : state.stores.filter((s) => s.id === state.currentVendorId))
    .map((s) => `<option value="${s.id}">${escapeHtml(s.business_name)}</option>`).join("");

  const productCards = products.map((product) => {
    const vendor = Array.isArray(product.vendors) ? product.vendors[0] : product.vendors;
    const variants = product.product_variants || [];
    const media = (product.product_media || []).slice().sort((a,b) => Number(a.sort_order) - Number(b.sort_order));
    const totalStock = variants.reduce((sum,v) => sum + Number(v.stock_quantity), 0);
    const minPrice = variants.length ? Math.min(...variants.map((v) => Number(v.price_cents))) : 0;

    return `<article class="terminal-product-card">
      <div class="terminal-product-summary">
        <div>
          <p class="eyebrow">${escapeHtml(vendor?.business_name || "STORE")}</p>
          <h2>${escapeHtml(product.name)}</h2>
          <p>${escapeHtml(product.category)} · ${money(minPrice)} · ${totalStock} online</p>
        </div>
        <div class="terminal-actions">
          <span class="status-pill">${escapeHtml(product.status)}</span>
          <button class="table-action" type="button" data-manage-product="${product.id}">Manage</button>
        </div>
      </div>

      <section class="terminal-product-panel" id="manage-${product.id}" hidden>
        <div class="terminal-two-column">
          <div class="stack-form compact-form">
            <h3>Product details</h3>
            <label>Name<input data-product-name="${product.id}" value="${escapeHtml(product.name)}"></label>
            <label>Category<input data-product-category="${product.id}" value="${escapeHtml(product.category)}"></label>
            <label>Description<textarea data-product-description="${product.id}">${escapeHtml(product.description)}</textarea></label>
            <div class="form-grid">
              <label>Status<select data-product-status="${product.id}">
                <option value="draft" ${product.status === "draft" ? "selected" : ""}>Draft</option>
                <option value="active" ${product.status === "active" ? "selected" : ""}>Active</option>
                <option value="archived" ${product.status === "archived" ? "selected" : ""}>Archived</option>
              </select></label>
              <label class="switch-line"><input type="checkbox" data-product-rare="${product.id}" ${product.is_rare ? "checked" : ""}> Limited / rare</label>
            </div>
            <button class="primary-button" type="button" data-save-product="${product.id}">Save details</button>
          </div>

          <div>
            <h3>Product photos</h3>
            <div class="terminal-media-grid">
              ${media.map((m) => `<figure class="terminal-media-card">
                <img src="${escapeHtml(m.public_url || "")}" alt="${escapeHtml(m.alt_text)}">
                <figcaption><span>${escapeHtml(m.alt_text)}</span><button class="table-action danger-action" type="button" data-delete-media="${m.id}" data-storage-path="${escapeHtml(m.storage_path)}">Remove</button></figcaption>
              </figure>`).join("") || "<p>No photos yet.</p>"}
            </div>
            <div class="stack-form compact-form">
              <label>Add photos<input type="file" accept="image/*" multiple data-image-files="${product.id}"></label>
              <label>Photo description<input data-image-alt="${product.id}" placeholder="Black hoodie front view"></label>
              <button class="table-action" type="button" data-upload-product-images="${product.id}" data-vendor-id="${product.vendor_id}">Upload photos</button>
            </div>
          </div>
        </div>

        <h3>Sizes, colours, prices and stock</h3>
        <div class="table-scroll"><table class="data-table">
          <thead><tr><th>Size</th><th>Colour</th><th>SKU</th><th>Price</th><th>Stock</th><th>Active</th><th>Actions</th></tr></thead>
          <tbody>${variants.map((v) => `<tr>
            <td>${escapeHtml(v.size)}</td>
            <td>${escapeHtml(v.colour)}</td>
            <td><small>${escapeHtml(v.sku)}</small></td>
            <td><input class="mini-field" type="number" min="1" step=".01" value="${(Number(v.price_cents)/100).toFixed(2)}" data-price="${v.id}"></td>
            <td><input class="mini-field" type="number" min="0" step="1" value="${Number(v.stock_quantity)}" data-stock="${v.id}"></td>
            <td><input type="checkbox" ${v.active ? "checked" : ""} data-active="${v.id}"></td>
            <td><button class="table-action" type="button" data-save-variant="${v.id}">Save variant</button> <button class="table-action" type="button" data-save-stock="${v.id}">Set stock</button></td>
          </tr>`).join("")}</tbody>
        </table></div>

        <div class="terminal-add-variant">
          <h3>Add another size / colour</h3>
          <div class="form-grid">
            <label>Size<input data-new-size="${product.id}" placeholder="XL"></label>
            <label>Colour<input data-new-colour="${product.id}" placeholder="Black"></label>
          </div>
          <div class="form-grid">
            <label>Price (R)<input type="number" min="1" step=".01" data-new-price="${product.id}" value="${variants.length ? (Number(variants[0].price_cents)/100).toFixed(2) : "2.00"}"></label>
            <label>Starting stock<input type="number" min="0" step="1" data-new-stock="${product.id}" value="0"></label>
          </div>
          <button class="table-action" type="button" data-add-variant="${product.id}">Add variant</button>
        </div>

        <div class="terminal-danger-zone">
          <div><strong>Removal</strong><p>Archive sold products. Permanent delete is only allowed when the item has never been ordered.</p></div>
          <div class="terminal-actions">
            <button class="table-action" type="button" data-archive-product="${product.id}">Archive</button>
            <button class="table-action danger-action" type="button" data-delete-product="${product.id}">Delete unused</button>
          </div>
        </div>
      </section>
    </article>`;
  }).join("");

  content.innerHTML = `${header("CATALOGUE","Products","Manage product information, clothing variants, real photos and stock.",'<button class="primary-button" data-toggle-form="product-form">Add product</button>')}
    <section class="dashboard-panel" id="product-form" hidden>
      <div class="panel-heading"><div><h2>Add product</h2><p>Kompo Nation creates the URL and SKUs automatically.</p></div></div>
      <form class="stack-form dashboard-form" data-form="product">
        <label>Store<select name="vendor_id" required>${vendorOptions}</select></label>
        <div class="form-grid">
          <label>Product name<input name="name" required></label>
          <label>Category<select name="category" required>
            <option>T-shirts</option><option>Hoodies</option><option>Sweatshirts</option><option>Pants</option>
            <option>Shorts</option><option>Headwear</option><option>Accessories</option><option>Footwear</option><option>Other</option>
          </select></label>
        </div>
        <label>Description<textarea name="description" required></textarea></label>
        <div><strong>Sizes</strong><div class="size-picker">${sizePicker()}</div><label>Other sizes<input name="custom_sizes" placeholder="30, 32, 34"></label></div>
        <label>Colours<input name="colours" required placeholder="Black, White"><small>Comma-separated. Every chosen size is created in every listed colour.</small></label>
        <div class="form-grid">
          <label>Price (R)<input name="price_rand" type="number" min="1" step=".01" value="2.00" required></label>
          <label>Starting stock per variant<input name="stock_quantity" type="number" min="0" step="1" value="0" required></label>
        </div>
        <div class="form-grid">
          <label>Weight kg<input name="weight_kg" type="number" min=".01" step=".01" value=".35" required></label>
          <label>Dimensions LxWxH cm<input name="dimensions" value="42x32x6" pattern="[0-9.]+x[0-9.]+x[0-9.]+" required></label>
        </div>
        <div class="form-grid">
          <label>Status<select name="status"><option value="draft">Draft</option><option value="active">Active</option></select></label>
          <label class="switch-line"><input name="is_rare" type="checkbox"> Limited / rare</label>
        </div>
        <label>Product photos<input name="images" type="file" accept="image/*" multiple></label>
        <button class="primary-button">Create product</button><p class="form-message"></p>
      </form>
    </section>
    <section class="terminal-product-list">${productCards || '<section class="dashboard-panel"><p>No products yet.</p></section>'}</section>`;
}

async function createProduct(form) {
  const fd = new FormData(form);
  const values = Object.fromEntries(fd);
  const sizes = [...new Set([...fd.getAll("sizes"), ...listValues(values.custom_sizes)].map((v) => String(v).trim()).filter(Boolean))];
  const colours = listValues(values.colours);
  if (!sizes.length) throw new Error("Choose at least one size.");
  if (!colours.length) throw new Error("Add at least one colour.");

  const [lengthCm,widthCm,heightCm] = String(values.dimensions).toLowerCase().split("x").map(Number);
  const { data: productId, error } = await supabase.rpc("save_product_v2", {
    p_vendor_id: values.vendor_id,
    p_name: values.name.trim(),
    p_category: values.category.trim(),
    p_description: values.description.trim(),
    p_price_cents: Math.round(Number(values.price_rand) * 100),
    p_sizes: sizes,
    p_colours: colours,
    p_stock_quantity: Number(values.stock_quantity),
    p_weight_kg: Number(values.weight_kg),
    p_length_cm: lengthCm,
    p_width_cm: widthCm,
    p_height_cm: heightCm,
    p_is_rare: values.is_rare === "on",
    p_status: values.status,
  });
  if (error) throw error;

  const images = form.querySelector('input[name="images"]')?.files;
  if (images?.length) await uploadProductImages(productId, values.vendor_id, images, values.name);

  toast(`Product created with ${sizes.length * colours.length} variants.`);
  renderProducts();
}

/* 06. ORDER AND RETURN MANAGEMENT                                            */
/* ========================================================================== */
async function renderOrders() {
  const query = supabase.from("vendor_orders").select("id,public_reference,vendor_id,fulfilment_status,merchandise_total_cents,shipping_charge_cents,commission_total_cents,created_at,orders(customer_name,customer_email),vendors(business_name)").order("created_at", { ascending: false }).limit(150);
  const { data: orders, error } = area === "vendor" ? await query.eq("vendor_id", state.currentVendorId) : await query;
  if (error) throw error;
  content.innerHTML = `${header("FULFILMENT", "Orders", "Each store package moves independently after one customer checkout.")}<section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Package</th><th>Store</th><th>Customer</th><th>Value</th><th>Commission</th><th>Status</th><th>Move</th></tr></thead><tbody>${orders.map((order) => { const vendor = Array.isArray(order.vendors) ? order.vendors[0] : order.vendors; const parent = Array.isArray(order.orders) ? order.orders[0] : order.orders; const next = ({ new: "accepted", accepted: "packing", packing: "packed", packed: "ready_for_collection" })[order.fulfilment_status]; const action = next ? `<button class="table-action" data-order-status="${order.id}" data-next-status="${next}">Mark ${escapeHtml(next.replaceAll("_", " "))}</button>` : order.fulfilment_status === "ready_for_collection" ? `<button class="table-action" data-book-shipment="${order.id}">Book collection</button>` : "—"; return `<tr><td><strong>${escapeHtml(order.public_reference)}</strong><br><small>${new Date(order.created_at).toLocaleDateString(CONFIG.locale)}</small></td><td>${escapeHtml(vendor?.business_name)}</td><td>${escapeHtml(parent?.customer_name)}<br><small>${escapeHtml(parent?.customer_email)}</small></td><td>${money(Number(order.merchandise_total_cents) + Number(order.shipping_charge_cents))}</td><td>${money(order.commission_total_cents)}</td><td><span class="status-pill">${escapeHtml(order.fulfilment_status.replaceAll("_", " "))}</span></td><td>${action}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}

async function renderReturns() {
  const query = supabase.from("returns").select("id,public_reference,vendor_id,reason,status,refund_amount_cents,requested_at,vendors(business_name),profiles(full_name)").order("requested_at", { ascending: false }).limit(100);
  const { data: returns, error } = area === "vendor" ? await query.eq("vendor_id", state.currentVendorId) : await query;
  if (error) throw error;
  content.innerHTML = `${header("AFTER-SALES", "Returns", "Review submitted requests, received items and recorded refund outcomes.")}<section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Return</th><th>Store</th><th>Customer</th><th>Reason</th><th>Value</th><th>Status</th><th>Move</th></tr></thead><tbody>${returns.map((item) => { const vendor = Array.isArray(item.vendors) ? item.vendors[0] : item.vendors; const customer = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles; const actions = item.status === "requested" ? `<button class="table-action" data-return-status="${item.id}" data-next-status="approved">Approve</button> <button class="table-action" data-return-status="${item.id}" data-next-status="declined">Decline</button>` : ["approved","in_transit"].includes(item.status) ? `<button class="table-action" data-return-status="${item.id}" data-next-status="received">Mark received</button>` : item.status === "received" && state.isAdmin ? `<button class="table-action" data-return-status="${item.id}" data-next-status="refunded">Confirm refunded</button>` : "—"; return `<tr><td><strong>${escapeHtml(item.public_reference)}</strong></td><td>${escapeHtml(vendor?.business_name)}</td><td>${escapeHtml(customer?.full_name || "Customer")}</td><td>${escapeHtml(item.reason.replaceAll("_", " "))}</td><td>${money(item.refund_amount_cents)}</td><td><span class="status-pill">${escapeHtml(item.status.replaceAll("_", " "))}</span></td><td>${actions}</td></tr>`; }).join("")}</tbody></table></div></section>`;
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
  const manageStore = event.target.closest("[data-manage-store]");
  if (manageStore) {
    const panel = document.querySelector(`#store-manage-${CSS.escape(manageStore.dataset.manageStore)}`);
    panel.hidden = !panel.hidden;
    return;
  }

  const saveStore = event.target.closest("[data-save-store]");
  if (saveStore) {
    const id = saveStore.dataset.saveStore;
    const featuredChoice = document.querySelector(`[data-store-featured="${CSS.escape(id)}"]`).value;
    const featuredOverride = featuredChoice === "pinned"
      ? true
      : featuredChoice === "hidden"
        ? false
        : null;

    saveStore.disabled = true;
    try {
      const { error } = await supabase.rpc("admin_update_vendor_v2", {
        p_vendor_id: id,
        p_business_name: document.querySelector(`[data-store-name="${CSS.escape(id)}"]`).value.trim(),
        p_contact_email: document.querySelector(`[data-store-email="${CSS.escape(id)}"]`).value.trim().toLowerCase(),
        p_commission_rate_bps: Math.round(Number(document.querySelector(`[data-store-commission="${CSS.escape(id)}"]`).value) * 100),
        p_short_description: document.querySelector(`[data-store-short="${CSS.escape(id)}"]`).value.trim(),
        p_description: document.querySelector(`[data-store-description="${CSS.escape(id)}"]`).value.trim(),
        p_mark: document.querySelector(`[data-store-mark="${CSS.escape(id)}"]`).value.trim().toUpperCase(),
        p_accent: document.querySelector(`[data-store-accent="${CSS.escape(id)}"]`).value,
        p_is_platform_owned: document.querySelector(`[data-store-platform-owned="${CSS.escape(id)}"]`).checked,
        p_featured_override: featuredOverride,
      });

      if (error) throw error;
      toast("Store settings saved.");
      return renderStores();
    } catch (error) {
      toast(error.message);
    } finally {
      saveStore.disabled = false;
    }
    return;
  }

  const loadStoreTeam = event.target.closest("[data-load-store-team]");
  if (loadStoreTeam) {
    loadStoreTeam.disabled = true;
    loadStoreTeam.textContent = "Loading…";

    try {
      await loadStoreTeamPanel(loadStoreTeam.dataset.loadStoreTeam);
    } finally {
      loadStoreTeam.disabled = false;
      loadStoreTeam.textContent = "Refresh team";
    }

    return;
  }

  const saveStoreMember = event.target.closest("[data-save-store-member]");
  if (saveStoreMember) {
    const userId = saveStoreMember.dataset.saveStoreMember;
    const vendorId = saveStoreMember.dataset.memberVendor;
    const role = document.querySelector(
      `[data-member-role="${CSS.escape(userId)}"]`
    ).value;
    const status = document.querySelector(
      `[data-member-status="${CSS.escape(userId)}"]`
    ).value;

    saveStoreMember.disabled = true;

    const { error } = await supabase.rpc("admin_upsert_vendor_member", {
      p_vendor_id: vendorId,
      p_user_id: userId,
      p_role: role,
      p_status: status,
    });

    saveStoreMember.disabled = false;

    if (error) return toast(error.message);

    toast("Store member updated.");
    return loadStoreTeamPanel(vendorId);
  }

  const removeStoreMember = event.target.closest("[data-remove-store-member]");
  if (removeStoreMember) {
    const userId = removeStoreMember.dataset.removeStoreMember;
    const vendorId = removeStoreMember.dataset.memberVendor;

    if (!confirm("Remove this person from the store team?")) return;

    removeStoreMember.disabled = true;

    const { error } = await supabase.rpc("admin_remove_vendor_member", {
      p_vendor_id: vendorId,
      p_user_id: userId,
    });

    if (error) {
      removeStoreMember.disabled = false;
      return toast(error.message);
    }

    toast("Store member removed.");
    return loadStoreTeamPanel(vendorId);
  }

  const storeStatus = event.target.closest("[data-store-status]");
  if (storeStatus) {
    const { error } = await supabase.rpc("admin_set_vendor_status", { p_vendor_id: storeStatus.dataset.storeStatus, p_status: storeStatus.dataset.nextStatus });
    if (error) return toast(error.message);
    state.stores.find((store) => store.id === storeStatus.dataset.storeStatus).status = storeStatus.dataset.nextStatus;
    toast("Store status updated.");
    return renderStores();
  }
const manageProduct = event.target.closest("[data-manage-product]");
  if (manageProduct) {
    const panel = document.querySelector(`#manage-${CSS.escape(manageProduct.dataset.manageProduct)}`);
    panel.hidden = !panel.hidden;
    return;
  }

  const saveProduct = event.target.closest("[data-save-product]");
  if (saveProduct) {
    const id = saveProduct.dataset.saveProduct;
    const { error } = await supabase.rpc("update_product_details", {
      p_product_id: id,
      p_name: document.querySelector(`[data-product-name="${CSS.escape(id)}"]`).value,
      p_category: document.querySelector(`[data-product-category="${CSS.escape(id)}"]`).value,
      p_description: document.querySelector(`[data-product-description="${CSS.escape(id)}"]`).value,
      p_is_rare: document.querySelector(`[data-product-rare="${CSS.escape(id)}"]`).checked,
      p_status: document.querySelector(`[data-product-status="${CSS.escape(id)}"]`).value,
    });
    if (error) return toast(error.message);
    toast("Product details saved.");
    return renderProducts();
  }

  const saveVariant = event.target.closest("[data-save-variant]");
  if (saveVariant) {
    const id = saveVariant.dataset.saveVariant;
    const price = Number(document.querySelector(`[data-price="${CSS.escape(id)}"]`).value);
    const active = document.querySelector(`[data-active="${CSS.escape(id)}"]`).checked;
    const { error } = await supabase.from("product_variants").update({
      price_cents: Math.round(price * 100), active, updated_at: new Date().toISOString()
    }).eq("id", id);
    if (error) return toast(error.message);
    toast("Variant saved.");
    return renderProducts();
  }

  const saveStock = event.target.closest("[data-save-stock]");
  if (saveStock) {
    const id = saveStock.dataset.saveStock;
    const quantity = Number(document.querySelector(`[data-stock="${CSS.escape(id)}"]`).value);
    if (!Number.isInteger(quantity) || quantity < 0) return toast("Enter a valid whole-number stock level.");
    const { error } = await supabase.rpc("set_variant_stock", { p_variant_id:id, p_new_quantity:quantity, p_reason:"vendor_manual_adjustment" });
    if (error) return toast(error.message);
    toast(`Stock set to ${quantity}.`);
    return renderProducts();
  }

  const addVariant = event.target.closest("[data-add-variant]");
  if (addVariant) {
    const id = addVariant.dataset.addVariant;
    const size = document.querySelector(`[data-new-size="${CSS.escape(id)}"]`).value.trim();
    const colour = document.querySelector(`[data-new-colour="${CSS.escape(id)}"]`).value.trim();
    const price = Number(document.querySelector(`[data-new-price="${CSS.escape(id)}"]`).value);
    const stock = Number(document.querySelector(`[data-new-stock="${CSS.escape(id)}"]`).value);
    const { error } = await supabase.rpc("add_product_variant", {
      p_product_id:id,p_size:size,p_colour:colour,p_price_cents:Math.round(price*100),p_stock_quantity:stock,
      p_weight_kg:.35,p_length_cm:42,p_width_cm:32,p_height_cm:6
    });
    if (error) return toast(error.message);
    toast("Variant added.");
    return renderProducts();
  }

  const uploadImages = event.target.closest("[data-upload-product-images]");
  if (uploadImages) {
    const id = uploadImages.dataset.uploadProductImages;
    const files = document.querySelector(`[data-image-files="${CSS.escape(id)}"]`).files;
    if (!files.length) return toast("Choose at least one image.");
    try {
      await uploadProductImages(id, uploadImages.dataset.vendorId, files, document.querySelector(`[data-image-alt="${CSS.escape(id)}"]`).value);
      toast("Photos uploaded.");
      return renderProducts();
    } catch (error) { return toast(error.message); }
  }

  const deleteMedia = event.target.closest("[data-delete-media]");
  if (deleteMedia) {
    if (!confirm("Remove this product photo?")) return;
    const { error: storageError } = await supabase.storage.from("product-images").remove([deleteMedia.dataset.storagePath]);
    if (storageError) return toast(storageError.message);
    const { error } = await supabase.from("product_media").delete().eq("id", deleteMedia.dataset.deleteMedia);
    if (error) return toast(error.message);
    toast("Photo removed.");
    return renderProducts();
  }

  const archiveProduct = event.target.closest("[data-archive-product]");
  if (archiveProduct) {
    if (!confirm("Archive this product? Customers will no longer see it.")) return;
    const { error } = await supabase.rpc("archive_product", { p_product_id:archiveProduct.dataset.archiveProduct });
    if (error) return toast(error.message);
    toast("Product archived.");
    return renderProducts();
  }

  const deleteProduct = event.target.closest("[data-delete-product]");
  if (deleteProduct) {
    if (!confirm("Permanently delete this unused product? This cannot be undone.")) return;
    const { error } = await supabase.rpc("delete_unused_product", { p_product_id:deleteProduct.dataset.deleteProduct });
    if (error) return toast(error.message);
    toast("Unused product deleted.");
    return renderProducts();
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
    shipment.textContent = "Booking…";
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
    if (form.dataset.form === "store-member") {
      const values = Object.fromEntries(new FormData(form));
      const button = form.querySelector('button[type="submit"], button:not([type])');

      if (button) {
        button.disabled = true;
        button.textContent = "Adding…";
      }

      const { data, error } = await supabase.rpc(
        "admin_assign_vendor_member_by_email",
        {
          p_vendor_id: values.vendor_id,
          p_email: values.email.trim().toLowerCase(),
          p_role: values.role,
          p_status: "active",
        }
      );

      if (button) {
        button.disabled = false;
        button.textContent = "Add to store";
      }

      if (error) throw error;

      toast(`${data?.email || values.email} added to the store.`);
      form.reset();
      await loadStoreTeamPanel(values.vendor_id);
      return;
    }

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

function renderNoVendorStore() {
  content.innerHTML = `<section class="portal-alert glass">
    <p class="eyebrow">STORE ACCESS</p>
    <h1>No vendor store is assigned.</h1>
    <p>This account needs an active Store Team membership before vendor tools can be used.</p>
    ${state.isAdmin
      ? '<a class="primary-button" href="/admin">Open admin control room</a>'
      : '<a class="primary-button" href="/">Return to storefront</a>'}
  </section>`;
}

async function renderView() {
  if (area === "vendor" && !state.currentVendorId) return renderNoVendorStore();
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
