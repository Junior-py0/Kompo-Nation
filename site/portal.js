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
      ? '<a class="primary-button" href="/admin">Open admin portal</a>'
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
  const sidebar = document.querySelector("#portal-sidebar");
  const menuButton = document.querySelector("#portal-menu");
  const closeButton = document.querySelector("#portal-menu-close");
  const backdrop = document.querySelector("#portal-menu-backdrop");

  const setMenuOpen = (open, returnFocus = false) => {
    sidebar.classList.toggle("open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    backdrop.hidden = !open;
    document.body.classList.toggle("portal-menu-open", open);
    if (!open && returnFocus) menuButton.focus();
  };

  document.querySelector("#portal-identity").textContent = state.session.user.email;
  document.querySelectorAll("#portal-nav [data-view]").forEach((button) => button.addEventListener("click", () => {
    setActiveView(button.dataset.view);
    setMenuOpen(false);
  }));
  document.querySelector("#signout-button").addEventListener("click", async () => { await signOut(); location.href = location.protocol === "file:" ? "./index.html" : "/"; });
  menuButton.addEventListener("click", () => setMenuOpen(!sidebar.classList.contains("open")));
  closeButton.addEventListener("click", () => setMenuOpen(false, true));
  backdrop.addEventListener("click", () => setMenuOpen(false, true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sidebar.classList.contains("open")) setMenuOpen(false, true);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 820 && sidebar.classList.contains("open")) setMenuOpen(false);
  });
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
  // VENDOR_COMMISSION_PRIVACY_V2
  const orderQuery = supabase.from("vendor_orders").select("id,merchandise_total_cents,commission_total_cents,fulfilment_status,created_at,vendors(business_name)").order("created_at", { ascending: false }).limit(50);
  const { data: orders, error } = area === "vendor" ? await orderQuery.eq("vendor_id", state.currentVendorId) : await orderQuery;
  if (error) throw error;
  const gross = orders.reduce((sum, order) => sum + Number(order.merchandise_total_cents), 0);
  const commission = orders.reduce((sum, order) => sum + Number(order.commission_total_cents), 0);
  const open = orders.filter((order) => !["delivered", "cancelled"].includes(order.fulfilment_status)).length;
  content.innerHTML = `${header(area === "admin" ? "CONTROL ROOM" : "STORE PULSE", area === "admin" ? "Nation overview" : "Your store today", area === "admin" ? "Marketplace activity across every active store." : "Sales and fulfilment for the selected store.")}
    <div class="stat-grid"><article class="stat-card"><span>Merchandise value</span><strong>${money(gross)}</strong><small>Loaded order history</small></article>${
      area === "admin"
        ? `
          <article class="stat-card">
            <span>Commission earned</span>
            <strong>${money(commission)}</strong>
            <small>Operator-only platform earnings</small>
          </article>
        `
        : ""
    }<article class="stat-card"><span>Open packages</span><strong>${open}</strong><small>Still moving</small></article><article class="stat-card"><span>${area === "admin" ? "Active stores" : "Products sold"}</span><strong>${area === "admin" ? state.stores.filter((store) => store.status === "active").length : orders.length}</strong><small>Current view</small></article></div>
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
    .select("id,business_name,slug,status,commission_rate_bps,is_platform_owned,sales_count,featured_override,short_description,description,mark,accent,vendor_private_settings(contact_email,contact_phone,collection_street_address,collection_local_area,collection_city,collection_province,collection_postal_code,collection_country_code,package_length_cm,package_width_cm,package_height_cm,package_tare_weight_kg,package_item_capacity)")
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
    const packageTareKg = Math.max(0, Number(privateRow?.package_tare_weight_kg || 0));
    const packageWeight = packageTareKg < 1
      ? { value: Math.round(packageTareKg * 1000), unit: "g" }
      : { value: Number(packageTareKg.toFixed(3)), unit: "kg" };

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

          <section class="store-address-editor">
            <div class="terminal-section-heading">
              <div>
                <h3>Collection address</h3>
                <p>Used for Bob Go quotes and courier collections for this store.</p>
              </div>
            </div>
            <div class="form-grid">
              <label>Contact phone
                <input data-store-phone="${store.id}" value="${escapeHtml(privateRow?.contact_phone || "")}" required>
              </label>
              <label>Country
                <input value="South Africa" disabled>
              </label>
            </div>
            <label>Street address
              <input data-store-street="${store.id}" value="${escapeHtml(privateRow?.collection_street_address || "")}" required>
            </label>
            <div class="form-grid">
              <label>Area / suburb
                <input data-store-area="${store.id}" value="${escapeHtml(privateRow?.collection_local_area || "")}">
              </label>
              <label>City
                <input data-store-city="${store.id}" value="${escapeHtml(privateRow?.collection_city || "")}" required>
              </label>
            </div>
            <div class="form-grid">
              <label>Province
                <input data-store-province="${store.id}" value="${escapeHtml(privateRow?.collection_province || "")}" required>
              </label>
              <label>Postal code
                <input data-store-postal="${store.id}" inputmode="numeric" value="${escapeHtml(privateRow?.collection_postal_code || "")}" required>
              </label>
            </div>
          </section>

          <section class="package-settings-card">
            <div class="terminal-section-heading">
              <div>
                <h3>Standard shipping package</h3>
                <p>Used for Bob Go delivery quotes and courier bookings for this store. These are the same values the vendor can manage in Store settings.</p>
              </div>
            </div>
            <div class="package-dim-grid">
              <label>Length (cm)
                <input data-store-package-length="${store.id}" type="number" min="0.1" step="0.1" value="${escapeHtml(privateRow?.package_length_cm ?? "")}" required>
              </label>
              <label>Width (cm)
                <input data-store-package-width="${store.id}" type="number" min="0.1" step="0.1" value="${escapeHtml(privateRow?.package_width_cm ?? "")}" required>
              </label>
              <label>Height (cm)
                <input data-store-package-height="${store.id}" type="number" min="0.1" step="0.1" value="${escapeHtml(privateRow?.package_height_cm ?? "")}" required>
              </label>
            </div>
            <div class="form-grid package-secondary-grid">
              <div class="weight-unit-row">
                <label>Empty packaging weight
                  <input data-store-package-tare="${store.id}" type="number" min="0" step="0.001" value="${packageWeight.value}">
                </label>
                <label>Unit
                  <select data-store-package-tare-unit="${store.id}">
                    <option value="g" ${packageWeight.unit === "g" ? "selected" : ""}>grams</option>
                    <option value="kg" ${packageWeight.unit === "kg" ? "selected" : ""}>kilograms</option>
                  </select>
                </label>
              </div>
              <label>Items per package
                <input data-store-package-capacity="${store.id}" type="number" min="1" max="50" step="1" value="${Number(privateRow?.package_item_capacity || 3)}" required>
                <small>Example: 3 means 1–3 items use one parcel; 4–6 use two.</small>
              </label>
            </div>
            <div class="package-preview" data-store-package-preview="${store.id}">Enter the three dimensions to calculate volumetric weight.</div>
            <small class="field-help">Measure the outside of the normal box or mailer. Volumetric weight = length × width × height ÷ 4000.</small>
          </section>

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

  const updateStorePackagePreview = (storeId) => {
    const length = Number(document.querySelector(`[data-store-package-length="${CSS.escape(storeId)}"]`)?.value);
    const width = Number(document.querySelector(`[data-store-package-width="${CSS.escape(storeId)}"]`)?.value);
    const height = Number(document.querySelector(`[data-store-package-height="${CSS.escape(storeId)}"]`)?.value);
    const preview = document.querySelector(`[data-store-package-preview="${CSS.escape(storeId)}"]`);
    if (!preview) return;
    preview.textContent = [length,width,height].every((value) => Number.isFinite(value) && value > 0)
      ? `Estimated volumetric weight: ${(length * width * height / 4000).toFixed(2)} kg per package`
      : "Enter the three dimensions to calculate volumetric weight.";
  };

  state.stores.forEach((store) => {
    ["length", "width", "height"].forEach((field) => {
      document.querySelector(`[data-store-package-${field}="${CSS.escape(store.id)}"]`)
        ?.addEventListener("input", () => updateStorePackagePreview(store.id));
    });
    updateStorePackagePreview(store.id);
  });
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
/* STANDARD_PACKAGE_PRODUCT_UI_V1                                             */
/* ========================================================================== */
const SIZE_PRESETS = ["XS","S","M","L","XL","2XL","3XL","One size"];
const listValues = (value) => [...new Set(String(value || "").split(",").map((v) => v.trim()).filter(Boolean))];

function sizePicker() {
  return SIZE_PRESETS.map((size) =>
    `<label class="size-check"><input type="checkbox" name="sizes" value="${escapeHtml(size)}"><span>${escapeHtml(size)}</span></label>`
  ).join("");
}

function weightForDisplay(weightKg) {
  const kg = Number(weightKg);
  if (Number.isFinite(kg) && kg > 0 && kg < 1) return { value: Math.round(kg * 1000), unit: "g" };
  return { value: Number.isFinite(kg) && kg > 0 ? Number(kg.toFixed(3)) : 0.25, unit: "kg" };
}

function weightToKg(value, unit, allowZero = false) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || (!allowZero && number <= 0)) {
    throw new Error(allowZero ? "Enter a valid packaging weight." : "Enter a valid item weight.");
  }
  return unit === "g" ? number / 1000 : number;
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

  const vendorOptions = (area === "admin" ? state.stores : state.stores.filter((store) => store.id === state.currentVendorId))
    .map((store) => `<option value="${store.id}">${escapeHtml(store.business_name)}</option>`).join("");

  const productCards = products.map((product) => {
    const vendor = Array.isArray(product.vendors) ? product.vendors[0] : product.vendors;
    const variants = product.product_variants || [];
    const media = (product.product_media || []).slice().sort((a,b) => Number(a.sort_order) - Number(b.sort_order));
    const totalStock = variants.reduce((sum,variant) => sum + Number(variant.stock_quantity), 0);
    const minPrice = variants.length ? Math.min(...variants.map((variant) => Number(variant.price_cents))) : 0;
    const displayWeight = weightForDisplay(variants[0]?.weight_kg);

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
        <div class="terminal-workspace">
          <section class="product-control-card">
            <div class="terminal-section-heading"><div><h3>Product details</h3><p>Customer-facing information and shipping weight.</p></div></div>
            <div class="stack-form compact-form">
              <label>Name<input data-product-name="${product.id}" value="${escapeHtml(product.name)}"></label>
              <div class="form-grid">
                <label>Category<input data-product-category="${product.id}" value="${escapeHtml(product.category)}"></label>
                <label>Status<select data-product-status="${product.id}">
                  <option value="draft" ${product.status === "draft" ? "selected" : ""}>Draft</option>
                  <option value="active" ${product.status === "active" ? "selected" : ""}>Active</option>
                  <option value="archived" ${product.status === "archived" ? "selected" : ""}>Archived</option>
                </select></label>
              </div>
              <label>Description<textarea data-product-description="${product.id}">${escapeHtml(product.description)}</textarea></label>
              <div class="weight-unit-row">
                <label>Item weight<input type="number" min="0.001" step="0.001" data-product-weight="${product.id}" value="${displayWeight.value}"></label>
                <label>Unit<select data-product-weight-unit="${product.id}"><option value="g" ${displayWeight.unit === "g" ? "selected" : ""}>grams</option><option value="kg" ${displayWeight.unit === "kg" ? "selected" : ""}>kilograms</option></select></label>
              </div>
              <small class="field-help">Enter the weight of one item. Package dimensions are managed once under Store settings.</small>
              <label class="product-rare-toggle"><input type="checkbox" data-product-rare="${product.id}" ${product.is_rare ? "checked" : ""}><span>Limited / rare item</span></label>
              <button class="primary-button" type="button" data-save-product="${product.id}">Save product details</button>
            </div>
          </section>

          <section class="product-control-card">
            <div class="terminal-section-heading"><div><h3>Product photos</h3><p>Add or remove storefront images.</p></div></div>
            <div class="terminal-media-grid">
              ${media.map((item) => `<figure class="terminal-media-card">
                <img src="${escapeHtml(item.public_url || "")}" alt="${escapeHtml(item.alt_text)}">
                <figcaption><span>${escapeHtml(item.alt_text)}</span><button class="table-action danger-action" type="button" data-delete-media="${item.id}" data-storage-path="${escapeHtml(item.storage_path)}">Remove</button></figcaption>
              </figure>`).join("") || '<p class="muted-copy">No photos yet.</p>'}
            </div>
            <div class="stack-form compact-form product-photo-upload">
              <label>Add photos<input type="file" accept="image/*" multiple data-image-files="${product.id}"></label>
              <label>Photo description<input data-image-alt="${product.id}" placeholder="Black hoodie front view"></label>
              <button class="table-action" type="button" data-upload-product-images="${product.id}" data-vendor-id="${product.vendor_id}">Upload photos</button>
            </div>
          </section>
        </div>

        <section class="inventory-section">
          <div class="terminal-section-heading"><div><h3>Sizes, colours, prices and stock</h3><p>Update price/status separately from physical stock.</p></div></div>
          <div class="inventory-list">
            ${variants.map((variant) => `<article class="inventory-row">
              <div class="inventory-identity"><strong>${escapeHtml(variant.size)} · ${escapeHtml(variant.colour)}</strong><small>${escapeHtml(variant.sku)}</small></div>
              <label>Price (R)<input type="number" min="1" step=".01" value="${(Number(variant.price_cents)/100).toFixed(2)}" data-price="${variant.id}"></label>
              <label>Stock<input type="number" min="0" step="1" value="${Number(variant.stock_quantity)}" data-stock="${variant.id}"></label>
              <label class="variant-active-toggle"><input type="checkbox" ${variant.active ? "checked" : ""} data-active="${variant.id}"><span>Active</span></label>
              <div class="inventory-actions"><button class="table-action" type="button" data-save-variant="${variant.id}">Save price / status</button><button class="table-action" type="button" data-save-stock="${variant.id}">Update stock</button></div>
            </article>`).join("") || '<p class="muted-copy">No variants yet.</p>'}
          </div>
        </section>

        <section class="terminal-add-variant">
          <div class="terminal-section-heading"><div><h3>Add another size / colour</h3><p>The new variant uses this product's item weight.</p></div></div>
          <div class="variant-create-grid">
            <label>Size<input data-new-size="${product.id}" placeholder="XL"></label>
            <label>Colour<input data-new-colour="${product.id}" placeholder="Black"></label>
            <label>Price (R)<input type="number" min="1" step=".01" data-new-price="${product.id}" value="${variants.length ? (Number(variants[0].price_cents)/100).toFixed(2) : "2.00"}"></label>
            <label>Starting stock<input type="number" min="0" step="1" data-new-stock="${product.id}" value="0"></label>
          </div>
          <button class="table-action" type="button" data-add-variant="${product.id}">Add variant</button>
        </section>

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
        <div class="weight-unit-row">
          <label>Item weight<input name="item_weight" type="number" min="0.001" step="0.001" value="250" required></label>
          <label>Unit<select name="weight_unit"><option value="g" selected>grams</option><option value="kg">kilograms</option></select></label>
        </div>
        <small class="field-help">Weight is stored internally in kilograms. Your standard box is configured under Store settings.</small>
        <div class="form-grid">
          <label>Status<select name="status"><option value="draft">Draft</option><option value="active">Active</option></select></label>
          <label class="product-rare-toggle"><input name="is_rare" type="checkbox"><span>Limited / rare item</span></label>
        </div>
        <label>Product photos<input name="images" type="file" accept="image/*" multiple></label>
        <button class="primary-button">Create product</button><p class="form-message"></p>
      </form>
    </section>
    <section class="terminal-product-list">${productCards || '<section class="dashboard-panel"><p>No products yet.</p></section>'}</section>`;
}

/* ========================================================================== */
/* 05B. STORE DISCOUNT CODES                                                  */
/* ========================================================================== */
function dateTimeLocalValue(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
}

async function renderDiscounts() {
  let query = supabase
    .from("discount_codes")
    .select("id,vendor_id,code,name,discount_type,percentage_bps,fixed_amount_cents,minimum_subtotal_cents,usage_limit,used_count,starts_at,expires_at,active,created_at,vendors(business_name),discount_redemptions(status,expires_at)")
    .order("created_at", { ascending: false });
  if (area === "vendor") query = query.eq("vendor_id", state.currentVendorId);
  const { data: codes, error } = await query;
  if (error) throw error;

  const now = Date.now();
  const cards = (codes || []).map((code) => {
    const vendor = Array.isArray(code.vendors) ? code.vendors[0] : code.vendors;
    const activeReservations = (code.discount_redemptions || []).filter((item) => item.status === "reserved" && Date.parse(item.expires_at) > now).length;
    const remaining = Math.max(0, Number(code.usage_limit) - Number(code.used_count) - activeReservations);
    const expired = code.expires_at && Date.parse(code.expires_at) <= now;
    const upcoming = Date.parse(code.starts_at) > now;
    const status = !code.active ? "inactive" : expired ? "expired" : upcoming ? "scheduled" : remaining < 1 ? "used up" : "active";
    const value = code.discount_type === "percentage"
      ? `${(Number(code.percentage_bps) / 100).toFixed(Number(code.percentage_bps) % 100 ? 2 : 0)}% off`
      : `${money(code.fixed_amount_cents)} off`;

    return `<article class="discount-code-card">
      <div class="discount-code-heading">
        <div>
          <p class="eyebrow">${escapeHtml(vendor?.business_name || "STORE")}</p>
          <h2>${escapeHtml(code.code)}</h2>
          <p>${escapeHtml(code.name || value)} · ${value}</p>
        </div>
        <span class="status-pill">${escapeHtml(status)}</span>
      </div>
      <div class="discount-code-metrics">
        <div><span>Used</span><strong>${Number(code.used_count)}</strong></div>
        <div><span>Reserved</span><strong>${activeReservations}</strong></div>
        <div><span>Remaining</span><strong>${remaining}</strong></div>
        <div><span>Limit</span><strong>${Number(code.usage_limit)}</strong></div>
      </div>
      <p><small>Minimum eligible store spend: ${money(code.minimum_subtotal_cents)}${code.expires_at ? ` · Ends ${new Date(code.expires_at).toLocaleString(CONFIG.locale)}` : " · No expiry"}</small></p>
      <div class="terminal-actions">
        <button class="table-action" type="button" data-copy-discount="${escapeHtml(code.code)}">Copy code</button>
        <button class="table-action" type="button" data-toggle-discount="${code.id}" data-next-active="${code.active ? "false" : "true"}">${code.active ? "Deactivate" : "Activate"}</button>
      </div>
    </article>`;
  }).join("");

  const vendorOptions = (area === "admin" ? state.stores : state.stores.filter((store) => store.id === state.currentVendorId))
    .map((store) => `<option value="${store.id}" ${store.id === state.currentVendorId ? "selected" : ""}>${escapeHtml(store.business_name)}</option>`).join("");
  const starts = dateTimeLocalValue(new Date());
  const expires = dateTimeLocalValue(new Date(Date.now() + 30 * 86400000));

  content.innerHTML = `${header(
    "STORE PROMOTIONS",
    "Discount codes",
    area === "admin" ? "Create a code for any store and track its live usage." : "Create codes only for this store. Store owners and managers can issue promotions.",
    '<button class="primary-button" data-toggle-form="discount-form">Create code</button>'
  )}
    <section class="dashboard-panel" id="discount-form" hidden>
      <div class="panel-heading"><div><h2>Create a store code</h2><p>Leave Code blank to generate a unique store-branded code automatically.</p></div></div>
      <form class="stack-form dashboard-form" data-form="discount-code">
        <label>Store<select name="vendor_id" required>${vendorOptions}</select></label>
        <div class="form-grid">
          <label>Code (optional)<input name="code" maxlength="32" placeholder="Auto-generate"></label>
          <label>Internal campaign name<input name="name" maxlength="80" placeholder="Launch sale"></label>
        </div>
        <div class="form-grid">
          <label>Discount type<select name="discount_type" data-discount-type><option value="percentage">Percentage</option><option value="fixed">Fixed rand amount</option></select></label>
          <label data-percentage-field>Percentage off<input name="percentage" type="number" min="0.01" max="100" step="0.01" value="10"></label>
          <label data-fixed-field hidden>Rand amount off<input name="fixed_rand" type="number" min="0.01" step="0.01" value="50"></label>
        </div>
        <div class="form-grid">
          <label>Minimum eligible spend (R)<input name="minimum_rand" type="number" min="0" step="0.01" value="0"></label>
          <label>Total usage limit<input name="usage_limit" type="number" min="1" max="1000000" step="1" value="50" required></label>
        </div>
        <div class="form-grid">
          <label>Starts<input name="starts_at" type="datetime-local" value="${starts}" required></label>
          <label>Expires (optional)<input name="expires_at" type="datetime-local" value="${expires}"></label>
        </div>
        <button class="primary-button">Generate & create code</button>
        <p class="form-message"></p>
      </form>
    </section>
    <section class="discount-code-grid">${cards || '<section class="dashboard-panel"><p>No discount codes have been created yet.</p></section>'}</section>`;

  const type = content.querySelector("[data-discount-type]");
  const syncType = () => {
    const percentage = type.value === "percentage";
    content.querySelector("[data-percentage-field]").hidden = !percentage;
    content.querySelector("[data-fixed-field]").hidden = percentage;
  };
  type?.addEventListener("change", syncType);
  if (type) syncType();
}

async function createProduct(form) {
  const fd = new FormData(form);
  const values = Object.fromEntries(fd);
  const sizes = [...new Set([...fd.getAll("sizes"), ...listValues(values.custom_sizes)].map((value) => String(value).trim()).filter(Boolean))];
  const colours = listValues(values.colours);
  if (!sizes.length) throw new Error("Choose at least one size.");
  if (!colours.length) throw new Error("Add at least one colour.");
  const weightKg = weightToKg(values.item_weight, values.weight_unit);

  const { data: productId, error } = await supabase.rpc("save_product_v2", {
    p_vendor_id: values.vendor_id,
    p_name: values.name.trim(),
    p_category: values.category.trim(),
    p_description: values.description.trim(),
    p_price_cents: Math.round(Number(values.price_rand) * 100),
    p_sizes: sizes,
    p_colours: colours,
    p_stock_quantity: Number(values.stock_quantity),
    p_weight_kg: weightKg,
    p_length_cm: 1,
    p_width_cm: 1,
    p_height_cm: 1,
    p_is_rare: values.is_rare === "on",
    p_status: values.status,
  });
  if (error) throw error;

  const images = form.querySelector('input[name="images"]')?.files;
  if (images?.length) await uploadProductImages(productId, values.vendor_id, images, values.name);

  toast(`Product created with ${sizes.length * colours.length} variants.`);
  renderProducts();
}/* 06. ORDER AND RETURN MANAGEMENT                                            */
/* ========================================================================== */
function firstRelation(value) {
  return Array.isArray(value) ? value[0] : value;
}

function orderItemPresentation(item) {
  const variant = firstRelation(item.product_variants) || {};
  const product = firstRelation(item.products) || {};
  const descriptionParts = String(item.variant_description || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  const media = (product.product_media || [])
    .slice()
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
  const primaryImage = media.find((image) => image.public_url);

  return {
    size: variant.size || descriptionParts[0] || "Not specified",
    colour: variant.colour || descriptionParts.slice(1).join(" / ") || "Not specified",
    imageUrl: primaryImage?.public_url || "",
    imageAlt: primaryImage?.alt_text || item.product_name || "Ordered product",
  };
}

function renderOrderItems(items) {
  if (!items?.length) {
    return `<div class="portal-order-items-empty">No item details were recorded for this package.</div>`;
  }

  return items.map((item) => {
    const details = orderItemPresentation(item);
    const initial = String(item.product_name || "P").trim().charAt(0).toUpperCase() || "P";

    return `
      <article class="portal-order-item">
        <div class="portal-order-item-image">
          <span aria-hidden="true">${escapeHtml(initial)}</span>
          ${details.imageUrl ? `<img data-order-product-image src="${escapeHtml(details.imageUrl)}" alt="${escapeHtml(details.imageAlt)}" loading="lazy">` : ""}
        </div>
        <div class="portal-order-item-copy">
          <strong>${escapeHtml(item.product_name || "Product")}</strong>
          <small>SKU ${escapeHtml(item.sku || "Not recorded")}</small>
          <div class="portal-order-item-options">
            <span><small>Colour</small>${escapeHtml(details.colour)}</span>
            <span><small>Size</small>${escapeHtml(details.size)}</span>
          </div>
        </div>
        <div class="portal-order-item-quantity">
          <small>Quantity</small>
          <strong>${escapeHtml(item.quantity)}</strong>
          <span>${money(item.line_total_cents)}</span>
        </div>
      </article>
    `;
  }).join("");
}

async function renderOrders() {
  // VENDOR_ORDER_COMMISSION_PRIVACY_V2
  const query = supabase
    .from("vendor_orders")
    .select(
      "id,public_reference,vendor_id,fulfilment_status,merchandise_subtotal_cents,merchandise_total_cents,discount_total_cents,discount_code,shipping_charge_cents,shipping_quote,commission_total_cents,created_at,orders(customer_name,customer_email),vendors(business_name),order_items(id,product_name,variant_description,sku,unit_price_cents,quantity,line_total_cents,product_variants(size,colour),products(product_media(public_url,alt_text,sort_order)))"
    )
    .order("created_at", {
      ascending: false
    })
    .limit(150);

  const {
    data: orders,
    error
  } =
    area === "vendor"
      ? await query.eq(
          "vendor_id",
          state.currentVendorId
        )
      : await query;

  if (error) throw error;

  const orderCards = (orders || [])
    .map((order) => {

      const vendor =
        Array.isArray(order.vendors)
          ? order.vendors[0]
          : order.vendors;

      const parent =
        Array.isArray(order.orders)
          ? order.orders[0]
          : order.orders;

      const next = ({
        new: "accepted",
        accepted: "packing",
        packing: "packed",
        packed: "ready_for_collection"
      })[order.fulfilment_status];

      let action = "";

      if (next) {
        action = `
          <button
            class="table-action"
            data-order-status="${order.id}"
            data-next-status="${next}"
          >
            ${
              next === "ready_for_collection"
                ? "Parcel is ready"
                : `Mark ${escapeHtml(
                    next.replaceAll("_", " ")
                  )}`
            }
          </button>
        `;
      } else if (
        order.fulfilment_status ===
        "ready_for_collection"
      ) {
        action = `
          <button
            class="table-action"
            data-book-shipment="${order.id}"
          >
            Book courier collection
          </button>
        `;
      }

      return `
        <article class="portal-order-card">
          <header class="portal-order-card-header">
            <div>
              <p class="portal-order-reference">${escapeHtml(order.public_reference)}</p>
              <span>${new Date(order.created_at).toLocaleString(CONFIG.locale)}</span>
            </div>
            <div class="portal-order-card-actions">
              <span class="status-pill">${escapeHtml(order.fulfilment_status.replaceAll("_", " "))}</span>
              ${action}
            </div>
          </header>

          <div class="portal-order-card-body">
            <section class="portal-order-products" aria-label="Ordered products">
              <h2>What was ordered</h2>
              <div class="portal-order-item-list">
                ${renderOrderItems(order.order_items || [])}
              </div>
            </section>

            <aside class="portal-order-summary-card">
              <div><small>Customer</small><strong>${escapeHtml(parent?.customer_name || "Customer")}</strong><span>${escapeHtml(parent?.customer_email || "No email recorded")}</span></div>
              ${area === "admin" ? `<div><small>Store</small><strong>${escapeHtml(vendor?.business_name || "Store")}</strong></div>` : ""}
              <div><small>Merchandise</small><strong>${money(order.merchandise_total_cents)}</strong></div>
              <div><small>Shipping</small><strong>${money(order.shipping_charge_cents)}</strong></div>
              ${Number(order.discount_total_cents) > 0 ? `<div><small>${escapeHtml(order.discount_code || "Discount")}</small><strong>-${money(order.discount_total_cents)}</strong></div>` : ""}
              ${area === "admin" ? `<div><small>Commission</small><strong>${money(order.commission_total_cents)}</strong></div>` : ""}
              <div class="portal-order-total"><small>Package total</small><strong>${money(Number(order.merchandise_total_cents) + Number(order.shipping_charge_cents))}</strong></div>
            </aside>
          </div>
        </article>
      `;
    })
    .join("");

  content.innerHTML = `
    ${
      header(
        "FULFILMENT",
        "Orders",
        "Prepare each store package, mark it ready only when it is physically available for collection, then create the courier booking."
      )
    }

    <section class="portal-order-list">
      ${orderCards || `<div class="dashboard-panel"><p>No paid orders are available yet.</p></div>`}
    </section>
  `;

  content.querySelectorAll("[data-order-product-image]").forEach((image) => {
    image.addEventListener("error", () => image.remove(), { once: true });
  });


  // COLLECTION_SCHEDULE_UI_V1
  if (area === "vendor") {

    const collectionOrders =
      (orders || []).filter(
        (order) =>
          [
            "packed",
            "ready_for_collection",
            "booked"
          ].includes(
            order.fulfilment_status
          )
      );

    if (collectionOrders.length) {

      const collectionCards =
        collectionOrders
          .map((order) => {

            const quote =
              order.shipping_quote || {};

            const courierName =
              quote.courierName ||
              "Selected courier";

            const serviceName =
              quote.serviceName ||
              "Door-to-door delivery";

            const cutoffRaw =
              String(
                quote.collectionCutoffTime ||
                ""
              );

            const cutoff =
              cutoffRaw
                ? cutoffRaw.slice(0, 5)
                : "";

            let explanation = "";
            let action = "";

            if (
              order.fulfilment_status ===
              "packed"
            ) {

              explanation =
                "This parcel is packed, but no courier has been booked. Press the button only once the sealed parcel is physically ready at your collection address.";

              action = `
                <button
                  class="primary-button"
                  data-order-status="${order.id}"
                  data-next-status="ready_for_collection"
                >
                  Parcel is ready for collection
                </button>
              `;

            } else if (
              order.fulfilment_status ===
              "ready_for_collection"
            ) {

              explanation =
                "Kompo Nation now knows the parcel is ready. Bob Go has still not been asked to collect it. Booking happens only when you press the button below.";

              action = `
                <button
                  class="primary-button"
                  data-book-shipment="${order.id}"
                >
                  Book courier collection
                </button>
              `;

            } else {

              explanation =
                "The courier booking has been created. Keep the sealed parcel available at the saved collection address and follow the courier tracking updates.";

              action = `
                <span class="status-pill">
                  Courier booked
                </span>
              `;
            }

            return `
              <article
                class="collection-schedule-card"
              >

                <div
                  class="collection-schedule-heading"
                >

                  <div>
                    <small>PACKAGE</small>

                    <h3>
                      ${
                        escapeHtml(
                          order.public_reference
                        )
                      }
                    </h3>
                  </div>

                  <span class="status-pill">
                    ${
                      escapeHtml(
                        order.fulfilment_status
                          .replaceAll("_", " ")
                      )
                    }
                  </span>

                </div>

                <div
                  class="collection-courier-name"
                >
                  <strong>
                    ${escapeHtml(courierName)}
                  </strong>

                  <span>
                    ${escapeHtml(serviceName)}
                  </span>
                </div>

                <!-- COLLECTION_TIMING_CLARITY_V2 -->
                <div class="collection-timing-box">

                  <span>Collection timing</span>

                  <strong>
                    ${
                      order.fulfilment_status === "booked"
                        ? "Courier booking created"
                        : cutoff
                          ? `Request before ${escapeHtml(cutoff)}`
                          : "Timing confirmed after booking"
                    }
                  </strong>

                  <small>
                    ${
                      order.fulfilment_status === "booked"
                        ? "The courier controls the driver route and actual arrival time. Follow tracking or courier confirmation for collection updates."
                        : cutoff
                          ? `The ${escapeHtml(cutoff)} time is the deadline for requesting this courier service. It is not the driver's arrival time.`
                          : "The courier's collection schedule becomes available once the shipment is booked."
                    }
                  </small>

                </div>

                <p>
                  ${escapeHtml(explanation)}
                </p>

                <div
                  class="collection-schedule-action"
                >
                  ${action}
                </div>

              </article>
            `;
          })
          .join("");

      content.insertAdjacentHTML(
        "beforeend",
        `
          <section
            class="dashboard-panel collection-control-panel"
          >

            <div
              class="terminal-section-heading"
            >

              <div>
                <h2>
                  Courier collection
                </h2>

                <p>
                  Packing, readiness and courier booking are separate steps.
                  Marking a parcel ready does not contact Bob Go.
                </p>
              </div>

            </div>

            <div
              class="collection-schedule-grid"
            >
              ${collectionCards}
            </div>

          </section>
        `
      );
    }
  }
}

/* ========================================================================== */
/* 06B. PLATFORM-COLLECTION SETTLEMENTS                                       */
/* ========================================================================== */
async function renderSettlements() {
  if (area !== "admin") return renderOverview();

  const { data, error } = await supabase.rpc("admin_settlement_dashboard");
  if (error) throw error;

  const summary = data?.summary || {};
  const storePayouts = Array.isArray(data?.storePayouts) ? data.storePayouts : [];
  const courierCharges = Array.isArray(data?.courierCharges) ? data.courierCharges : [];
  const recentStorePayouts = Array.isArray(data?.recentStorePayouts) ? data.recentStorePayouts : [];
  const recentCourierSettlements = Array.isArray(data?.recentCourierSettlements) ? data.recentCourierSettlements : [];

  const storeRows = storePayouts.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.reference)}</strong><br><small>${new Date(item.createdAt).toLocaleDateString(CONFIG.locale)}</small></td>
      <td>${escapeHtml(item.storeName)}</td>
      <td><span class="status-pill">${escapeHtml(item.provider)}</span></td>
      <td><span class="status-pill">${escapeHtml(String(item.fulfilmentStatus || "new").replaceAll("_", " "))}</span></td>
      <td>${money(item.grossCents)}</td>
      <td>${money(item.liabilityDeductionCents)}<br><small>${Number(item.liabilityDeductionCents) ? "Returns/refunds recovered" : "No deduction"}</small></td>
      <td><strong>${money(item.dueCents)}</strong></td>
      <td><button class="table-action" data-settle-store="${item.vendorOrderId}" data-settlement-label="${escapeHtml(`${item.storeName} · ${item.reference} · ${money(item.dueCents)}`)}">Mark store paid</button></td>
    </tr>
  `).join("");

  const courierRows = courierCharges.map((item) => `
    <tr>
      <td><strong>${escapeHtml(item.reference)}</strong><br><small>${item.kind === "return" ? "Return / exchange" : "Customer order"}</small></td>
      <td>${escapeHtml(item.storeName)}</td>
      <td>${escapeHtml(item.courierName || item.provider)}</td>
      <td>${money(item.collectedCents)}</td>
      <td><strong>${money(item.dueCents)}</strong></td>
      <td>${money(item.marginCents)}</td>
      <td><button class="table-action" data-settle-courier="${item.shipmentId}" data-shipment-kind="${item.kind}" data-settlement-label="${escapeHtml(`${item.reference} · ${money(item.dueCents)}`)}">Mark courier paid</button></td>
    </tr>
  `).join("");

  const recentStoreRows = recentStorePayouts.slice(0, 20).map((item) => `
    <tr><td>${escapeHtml(item.reference)}</td><td>${escapeHtml(item.storeName)}</td><td>${money(item.paidCents)}</td><td>${money(item.liabilityDeductionCents)}</td><td>${escapeHtml(item.payoutReference)}</td><td>${new Date(item.paidAt).toLocaleString(CONFIG.locale)}</td></tr>
  `).join("");

  const recentCourierRows = recentCourierSettlements.slice(0, 20).map((item) => `
    <tr><td>${item.kind === "return" ? "Return" : "Order"}</td><td>${escapeHtml(item.provider)}</td><td>${money(item.paidCents)}</td><td>${escapeHtml(item.settlementReference)}</td><td>${new Date(item.paidAt).toLocaleString(CONFIG.locale)}</td></tr>
  `).join("");

  content.innerHTML = `${header("MONEY CONTROL", "Settlements", "Reconcile platform-collected sales before paying stores, and match booked courier costs to Bob Go invoices or wallet deductions.")}
    <div class="stat-grid">
      <article class="stat-card"><span>Due to stores</span><strong>${money(summary.storeDueCents)}</strong><small>${storePayouts.length} unpaid package${storePayouts.length === 1 ? "" : "s"}</small></article>
      <article class="stat-card"><span>Due to courier</span><strong>${money(summary.courierDueCents)}</strong><small>${courierCharges.length} unreconciled charge${courierCharges.length === 1 ? "" : "s"}</small></article>
      <article class="stat-card"><span>Delivery collected</span><strong>${money(summary.shippingCollectedCents)}</strong><small>For listed courier charges</small></article>
      <article class="stat-card"><span>Delivery margin</span><strong>${money(summary.shippingMarginCents)}</strong><small>Collected less courier cost</small></article>
    </div>

    <section class="dashboard-panel">
      <div class="panel-heading"><div><p class="eyebrow">STORE PAYOUTS</p><h2>Amounts currently due</h2></div><span class="status-pill">Stitch / Yoco only</span></div>
      <p>Store due = vendor-net merchandise less any open return or refund liability. Pay the displayed amount first, then record the bank reference. Payment-gateway fees are not deducted from the store amount and must be reconciled separately.</p>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Package</th><th>Store</th><th>Collected by</th><th>Fulfilment</th><th>Gross net</th><th>Recovery</th><th>Pay store</th><th>Action</th></tr></thead><tbody>${storeRows || '<tr><td colspan="8">No store payouts are currently due.</td></tr>'}</tbody></table></div>
    </section>

    <section class="dashboard-panel">
      <div class="panel-heading"><div><p class="eyebrow">COURIER RECONCILIATION</p><h2>Booked charges not marked paid</h2></div><span class="status-pill">Bob Go</span></div>
      <p>The customer delivery amount and booked courier cost are shown separately. Compare the booked amount with the Bob Go wallet, invoice, or payment record before marking it paid.</p>
      <div class="table-scroll"><table class="data-table"><thead><tr><th>Reference</th><th>Store</th><th>Courier</th><th>Collected</th><th>Courier cost</th><th>Margin</th><th>Action</th></tr></thead><tbody>${courierRows || '<tr><td colspan="7">No courier charges are waiting for reconciliation.</td></tr>'}</tbody></table></div>
    </section>

    <div class="dashboard-grid">
      <section class="dashboard-panel"><div class="panel-heading"><h2>Recent store payouts</h2></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Package</th><th>Store</th><th>Paid</th><th>Recovery</th><th>Reference</th><th>When</th></tr></thead><tbody>${recentStoreRows || '<tr><td colspan="6">No store payouts recorded.</td></tr>'}</tbody></table></div></section>
      <section class="dashboard-panel"><div class="panel-heading"><h2>Recent courier payments</h2></div><div class="table-scroll"><table class="data-table"><thead><tr><th>Kind</th><th>Provider</th><th>Paid</th><th>Reference</th><th>When</th></tr></thead><tbody>${recentCourierRows || '<tr><td colspan="5">No courier payments recorded.</td></tr>'}</tbody></table></div></section>
    </div>`;
}

// RETURN_MANAGEMENT_V2
async function portalReturnApi(action,body={}){const{data:{session}}=await supabase.auth.getSession();if(!session)throw new Error("Sign in again.");const res=await fetch(`${CONFIG.functionsBase}/return-logistics`,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${session.access_token}`},body:JSON.stringify({action,...body})}),x=await res.json();if(!res.ok)throw new Error(x.error||"Return logistics failed.");return x}
async function renderReturns(){
 const select="id,public_reference,vendor_id,resolution_type,reason,customer_note,exchange_note,claimed_responsibility,responsibility,status,requested_at,vendors(business_name),profiles(full_name),return_shipments(id,leg,payer,status,courier_cost_cents,logistics_fee_cents,total_charge_cents,courier_name,tracking_url,provider_shipment_id)";
 const q=supabase.from("returns").select(select).order("requested_at",{ascending:false}).limit(100),{data,error}=area==="vendor"?await q.eq("vendor_id",state.currentVendorId):await q;if(error)throw error;
 let lq=supabase.from("vendor_liabilities").select("amount_cents,recovered_cents,status").in("status",["open","partial"]);if(area==="vendor")lq=lq.eq("vendor_id",state.currentVendorId);const{data:liabs,error:le}=await lq;if(le)throw le;const owing=(liabs||[]).reduce((s,x)=>s+Math.max(0,Number(x.amount_cents)-Number(x.recovered_cents)),0);
 const cards=(data||[]).map(r=>{const v=onePortal(r.vendors),c=onePortal(r.profiles),ships=Array.isArray(r.return_shipments)?r.return_shipments:[],rev=ships.find(s=>s.leg==="reverse"),ex=ships.find(s=>s.leg==="exchange_outbound");let action="";
 if(r.status==="requested")action=`<button class="table-action" data-return-decision="${r.id}" data-decision="approve" data-responsibility="${r.claimed_responsibility==="vendor"?"vendor":"customer"}">Approve â€” ${r.claimed_responsibility==="vendor"?"store":"customer"} responsible</button>${r.claimed_responsibility==="undetermined"?`<button class="table-action" data-return-decision="${r.id}" data-decision="approve" data-responsibility="vendor">Store responsible</button><button class="table-action" data-return-decision="${r.id}" data-decision="approve" data-responsibility="customer">Customer responsible</button>`:""}${state.isAdmin?`<button class="table-action" data-return-decision="${r.id}" data-decision="approve" data-responsibility="kompo">Kompo responsible</button>`:`<button class="table-action" data-return-decision="${r.id}" data-decision="escalate">Escalate</button>`}<button class="table-action" data-return-decision="${r.id}" data-decision="decline">Decline</button>`;
 else if(r.status==="under_review")action=state.isAdmin?`<button class="table-action" data-return-decision="${r.id}" data-decision="approve" data-responsibility="vendor">Store responsible</button><button class="table-action" data-return-decision="${r.id}" data-decision="approve" data-responsibility="customer">Customer responsible</button><button class="table-action" data-return-decision="${r.id}" data-decision="approve" data-responsibility="kompo">Kompo responsible</button>`:"<p>Waiting for Kompo Nation.</p>";
 else if(["approved","in_transit"].includes(r.status))action=!rev?`<button class="primary-button" data-prepare-return="${r.id}">Prepare return courier</button>`:rev.status==="awaiting_payment"?"<p>Waiting for customer payment.</p>":`<button class="primary-button" data-return-received="${r.id}">Returned parcel received</button>`;
 else if(r.status==="received"&&r.resolution_type==="exchange")action=!ex?`<button class="primary-button" data-prepare-exchange="${r.id}">Prepare replacement delivery</button>`:ex.status==="awaiting_payment"?"<p>Waiting for customer replacement-delivery payment.</p>":ex.status==="delivered"?`<button class="table-action" data-close-exchange="${r.id}">Close exchange</button>`:`<p>Replacement: <strong>${escapeHtml(ex.status.replaceAll("_"," "))}</strong></p>`;
 else if(r.status==="received"&&r.resolution_type==="refund")action=state.isAdmin?`<button class="primary-button" data-confirm-refund="${r.id}">I completed the provider refund</button><small>Refund through the original payment provider first; this then records vendor-net recovery.</small>`:"<p>Waiting for Kompo Nation refund.</p>";
 const ss=ships.map(s=>`<div class="return-shipment-mini"><span>${s.leg==="reverse"?"Return":"Replacement"} Â· ${escapeHtml(s.status.replaceAll("_"," "))}</span>${s.total_charge_cents!=null?`<strong>${money(s.total_charge_cents)}</strong><small>Courier ${money(s.courier_cost_cents||0)} Â· Logistics ${money(s.logistics_fee_cents||0)}</small>`:""}${s.tracking_url?`<a class="table-action" href="${escapeHtml(s.tracking_url)}" target="_blank" rel="noopener">Track</a>`:""}</div>`).join("");
 return `<article class="return-card"><div class="return-heading"><div><p class="eyebrow">${escapeHtml(r.public_reference)}</p><h2>${r.resolution_type==="exchange"?"Exchange":"Refund"} Â· ${escapeHtml(v?.business_name||"Store")}</h2><p>${escapeHtml(c?.full_name||"Customer")} Â· ${escapeHtml(r.reason)}</p></div><span class="status-pill">${escapeHtml(r.status.replaceAll("_"," "))}</span></div>${r.customer_note?`<p><strong>Customer note:</strong> ${escapeHtml(r.customer_note)}</p>`:""}${r.exchange_note?`<p><strong>Replacement:</strong> ${escapeHtml(r.exchange_note)}</p>`:""}<p>Responsibility: <strong>${r.responsibility==="vendor"?"Store":r.responsibility==="customer"?"Customer":r.responsibility==="kompo"?"Kompo Nation":"Not decided"}</strong></p><div class="return-shipment-summary">${ss}</div><div class="return-actions">${action}</div></article>`}).join("");
 content.innerHTML=`${header("AFTER-SALES","Returns & exchanges","Approve requests, assign responsibility, book reverse courier movement and recover store-responsible costs.")}<section class="dashboard-panel"><p class="eyebrow">OUTSTANDING RETURN BALANCE</p><h2>${money(owing)}</h2><p>Open return/refund amounts owed to Kompo Nation. Automated recovery applies to Paystack splits; platform-collected payments require the same deduction during vendor payout.</p></section><div class="return-list">${cards||"<section class='dashboard-panel'><p>No return requests yet.</p></section>"}</div>`;
}
function onePortal(v){return Array.isArray(v)?v[0]:v}
async function renderCancellations() {
  const { data: requests, error } = await supabase.from("order_cancellation_requests").select("id,public_reference,reason,status,refund_amount_cents,requested_at,vendors(business_name),profiles(full_name),vendor_orders(public_reference)").order("requested_at", { ascending: false }).limit(100);
  if (error) throw error;
  content.innerHTML = `${header("PAYMENT CONTROL", "Cancellations", "Review customer requests before recording the original payment-provider refund outcome.")}<section class="dashboard-panel"><div class="table-scroll"><table class="data-table"><thead><tr><th>Request</th><th>Package</th><th>Store</th><th>Customer</th><th>Value</th><th>Status</th><th>Review</th></tr></thead><tbody>${requests.map((item) => { const vendor = Array.isArray(item.vendors) ? item.vendors[0] : item.vendors; const customer = Array.isArray(item.profiles) ? item.profiles[0] : item.profiles; const vendorOrder = Array.isArray(item.vendor_orders) ? item.vendor_orders[0] : item.vendor_orders; return `<tr><td><strong>${escapeHtml(item.public_reference)}</strong><br><small>${escapeHtml(item.reason)}</small></td><td>${escapeHtml(vendorOrder?.public_reference)}</td><td>${escapeHtml(vendor?.business_name)}</td><td>${escapeHtml(customer?.full_name || "Customer")}</td><td>${money(item.refund_amount_cents)}</td><td><span class="status-pill">${escapeHtml(item.status.replaceAll("_", " "))}</span></td><td>${item.status === "requested" ? `<button class="table-action" data-cancellation-status="${item.id}" data-next-status="under_review">Review</button>` : "Confirm with provider"}</td></tr>`; }).join("")}</tbody></table></div></section>`;
}

/* ========================================================================== */
/* 07. SETTINGS                                                               */
/* ========================================================================== */

// VENDOR_ADDITIONAL_INFORMATION_V2
function renderInformation() {

  if (area !== "vendor") {
    return;
  }

  const currentStore =
    state.stores.find(
      (store) =>
        store.id ===
        state.currentVendorId
    );

  const commissionPercent =
    Number(
      currentStore?.commission_rate_bps ||
      1000
    ) / 100;

  content.innerHTML = `
    ${
      header(
        "ADDITIONAL INFORMATION",
        "How selling on Kompo Nation works",
        "Store sales, packaging, courier collection and fulfilment explained."
      )
    }

    <div class="vendor-information-grid">

      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">SALES</p>
        <h2>Marketplace commission</h2>

        <p>
          Your current Kompo Nation marketplace commission rate is
          <strong>${commissionPercent}%</strong>
          of merchandise sales.
        </p>

        <p>
          Commission is calculated as part of the marketplace transaction.
          Your portal focuses on your store's sales and fulfilment activity;
          Kompo Nation's cumulative platform earnings are private operator
          information.
        </p>

        <p>
          Your agreed commission and settlement terms should always match
          your current vendor agreement with Kompo Nation.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">PRODUCT DETAILS</p>
        <h2>Product weight</h2>

        <p>
          Enter the real weight of one individual product. Kompo Nation
          uses product weight when calculating the weight of parcels sent
          to the courier.
        </p>

        <p>
          Do not include the shipping box in the product weight. Packaging
          weight is entered separately under Store settings.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">PACKAGING</p>
        <h2>Standard shipping package</h2>

        <p>
          Store settings contain your standard box length, width, height,
          empty packaging weight and number of items that normally fit
          inside one package.
        </p>

        <p>
          If the package capacity is three items, one to three ordered
          units are packed as one parcel, four to six as two parcels,
          seven to nine as three parcels, and so on.
        </p>

        <p>
          Use realistic measurements. Couriers may physically reweigh or
          remeasure parcels, and incorrect package information can cause
          collection problems or additional courier charges.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">FULFILMENT</p>
        <h2>Preparing an order</h2>

        <p>
          A new paid order moves through the vendor fulfilment stages:
          Accepted, Packing, Packed and Ready for collection.
        </p>

        <p>
          Only mark an order Packed once all products are inside the
          correct package and the parcel is sealed and ready.
        </p>

        <p>
          Marking a parcel Packed does not call a courier.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">READY FOR COLLECTION</p>
        <h2>When to mark the parcel ready</h2>

        <p>
          Choose Parcel is ready for collection only when the parcel is
          physically at your saved collection address and somebody can
          hand it to the courier.
        </p>

        <p>
          Ready for collection is an internal Kompo Nation status. It does
          not yet create the Bob Go courier booking.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">COURIER BOOKING</p>
        <h2>Booking collection</h2>

        <p>
          Book courier collection is the step that creates the actual
          shipment through Kompo Nation's Bob Go integration.
        </p>

        <p>
          The courier receives the store collection address, the customer
          delivery address, parcel measurements, parcel weight and the
          courier service selected for that order.
        </p>

        <p>
          Because Kompo Nation uses a production courier connection,
          pressing Book courier collection should only be done when the
          parcel really is ready for handover.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">COLLECTION TIMING</p>
        <h2>Cut-off time vs pickup time</h2>

        <p>
          If the portal says Request before 14:00, for example, 14:00 is
          the courier service's booking cut-off. It does not mean the
          driver will arrive at 14:00.
        </p>

        <p>
          Booking before the displayed cut-off gives the shipment the best
          chance of entering that courier's current collection cycle.
          Requests made after a cut-off may move to the next business day.
        </p>

        <p>
          The courier controls the driver's route and actual arrival time.
          After the booking is created, use courier confirmation and
          tracking updates for the latest collection information.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">HANDOVER</p>
        <h2>When the courier arrives</h2>

        <p>
          Keep the correct sealed parcel available at the collection
          address and make sure somebody there knows that a courier pickup
          is expected.
        </p>

        <p>
          Attach any required waybill or shipping label before handover.
          Do not treat the parcel as collected simply because a booking
          exists; physical collection is confirmed by the courier status.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">TRACKING</p>
        <h2>After handover</h2>

        <p>
          Pending collection means the courier booking exists but the
          parcel has not yet been collected.
        </p>

        <p>
          Collected means the courier has taken the parcel. In transit
          means it is moving through the courier network. Out for delivery
          means it is with the delivery driver, and Delivered means it has
          reached the recipient.
        </p>
      </section>


      <section class="dashboard-panel vendor-info-card">
        <p class="eyebrow">STORE DETAILS</p>
        <h2>Keep information accurate</h2>

        <p>
          Keep your collection street address, suburb or area, city,
          province, postal code, contact phone and contact email current.
        </p>

        <p>
          Correct product weights and package information are also
          important because courier rates and successful collections rely
          on this information.
        </p>
      </section>

    <section class="dashboard-panel vendor-info-card"><p class="eyebrow">RETURN LOGISTICS</p><h2>Returns and exchanges create new courier legs.</h2><p>Customer-responsible returns are paid by the customer before collection. Store-responsible return courier costs are booked through Kompo Nation and become a store balance recovered from future payouts.</p><p>An exchange can create two new logistics legs: customer â†’ store and store â†’ customer. Each is quoted and charged separately.</p><p>For refunds, Kompo Nation commission is not automatically waived; the original vendor-net merchandise amount may also become a recovery balance.</p></section></div>
  `;
}


async function renderSettings() {
  if (area === "admin") {
    const { data, error } = await supabase.from("marketplace_settings").select("key,value").order("key");
    if (error) throw error;
    const value = (key, fallback) => data.find((item) => item.key === key)?.value ?? fallback;
    content.innerHTML = `${header("PLATFORM RULES", "Settings", "Controls stored in the database and protected by operator RLS.")}<section class="dashboard-panel"><form class="stack-form dashboard-form" data-form="admin-settings"><div class="form-grid"><label>Default commission percent<input name="default_commission" type="number" min="0" max="40" step=".1" value="${Number(value("default_commission_rate_bps",1000))/100}"></label><label>Stock reservation minutes<input name="reservation_minutes" type="number" min="5" max="60" value="${Number(value("stock_reservation_minutes",15))}"></label></div><div class="form-grid"><label>First reminder hours<input name="reminder_hours" type="number" min="1" value="${Number(value("fulfilment_reminder_hours",24))}"></label><label>Escalation hours<input name="escalation_hours" type="number" min="2" value="${Number(value("fulfilment_escalation_hours",72))}"></label></div><button class="primary-button">Save platform settings</button><p class="form-message"></p></form></section>`;
    return;
  }

  const { data: privateRow, error } = await supabase.from("vendor_private_settings")
    .select("contact_email,contact_phone,collection_street_address,collection_local_area,collection_city,collection_province,collection_postal_code,package_length_cm,package_width_cm,package_height_cm,package_tare_weight_kg,package_item_capacity")
    .eq("vendor_id", state.currentVendorId).maybeSingle();
  if (error) throw error;
  const settings = privateRow || {};
  const tareKg = Math.max(0, Number(settings.package_tare_weight_kg || 0));
  const packageWeight = tareKg < 1 ? { value: Math.round(tareKg * 1000), unit: "g" } : { value: Number(tareKg.toFixed(3)), unit: "kg" };

  content.innerHTML = `${header("STORE SETTINGS", "Collection and shipping", "Set the address couriers collect from and the standard package used for live delivery quotes.")}
    <section class="dashboard-panel">
      <form class="stack-form dashboard-form" data-form="vendor-settings">
        <div class="terminal-section-heading"><div><h2>Collection and contact</h2><p>The courier will use these details when collecting an order.</p></div></div>
        <div class="form-grid"><label>Contact email<input name="contact_email" type="email" value="${escapeHtml(settings.contact_email || "")}" required></label><label>Contact phone<input name="contact_phone" value="${escapeHtml(settings.contact_phone || "")}" required></label></div>
        <label>Collection street address<input name="collection_street_address" value="${escapeHtml(settings.collection_street_address || "")}" required></label>
        <div class="form-grid"><label>Area / suburb<input name="collection_local_area" value="${escapeHtml(settings.collection_local_area || "")}"></label><label>Collection city<input name="collection_city" value="${escapeHtml(settings.collection_city || "Polokwane")}" required></label></div>
        <div class="form-grid"><label>Province<input name="collection_province" value="${escapeHtml(settings.collection_province || "Limpopo")}" required></label><label>Postal code<input name="collection_postal_code" value="${escapeHtml(settings.collection_postal_code || "0700")}" required></label></div>

        <section class="package-settings-card">
          <div class="terminal-section-heading"><div><h2>Standard shipping package</h2><p>Measure the outside of the box or mailer you normally send. Kompo Nation will reuse it until you change it.</p></div></div>
          <div class="package-dim-grid">
            <label>Length (cm)<input name="package_length_cm" type="number" min="1" step="0.1" value="${escapeHtml(settings.package_length_cm ?? "")}" required></label>
            <label>Width (cm)<input name="package_width_cm" type="number" min="1" step="0.1" value="${escapeHtml(settings.package_width_cm ?? "")}" required></label>
            <label>Height (cm)<input name="package_height_cm" type="number" min="1" step="0.1" value="${escapeHtml(settings.package_height_cm ?? "")}" required></label>
          </div>
          <div class="form-grid package-secondary-grid">
            <div class="weight-unit-row"><label>Empty packaging weight<input name="package_tare_weight" type="number" min="0" step="0.001" value="${packageWeight.value}"></label><label>Unit<select name="package_tare_weight_unit"><option value="g" ${packageWeight.unit === "g" ? "selected" : ""}>grams</option><option value="kg" ${packageWeight.unit === "kg" ? "selected" : ""}>kilograms</option></select></label></div>
            <label>Items per package<input name="package_item_capacity" type="number" min="1" max="50" step="1" value="${Number(settings.package_item_capacity || 3)}" required><small>Example: 3 means 1–3 shirts use one box; 4–6 use two.</small></label>
          </div>
          <div class="package-preview" data-package-preview>Enter the three dimensions to calculate volumetric weight.</div>
          <small class="field-help">Volumetric weight = length × width × height ÷ 4000. Bob Go still receives the actual packed weight as well.</small>
        </section>

        <button class="primary-button">Save store settings</button><p class="form-message"></p>
      </form>
    </section>`;

  const form = content.querySelector('[data-form="vendor-settings"]');
  const updatePreview = () => {
    const length = Number(form.elements.package_length_cm.value);
    const width = Number(form.elements.package_width_cm.value);
    const height = Number(form.elements.package_height_cm.value);
    const preview = form.querySelector("[data-package-preview]");
    if ([length,width,height].every((value) => Number.isFinite(value) && value > 0)) {
      preview.textContent = `Estimated volumetric weight: ${(length * width * height / 4000).toFixed(2)} kg per package`;
    } else {
      preview.textContent = "Enter the three dimensions to calculate volumetric weight.";
    }
  };
  form.addEventListener("input", updatePreview);
  updatePreview();
}/* 08. MUTATION HANDLERS                                                      */
/* ========================================================================== */
async function handlePortalClick(event) {
  const openView = event.target.closest("[data-open-view]");
  if (openView) return setActiveView(openView.dataset.openView);

  const copyDiscount = event.target.closest("[data-copy-discount]");
  if (copyDiscount) {
    try {
      await navigator.clipboard.writeText(copyDiscount.dataset.copyDiscount);
      toast(`Copied ${copyDiscount.dataset.copyDiscount}.`);
    } catch (_) {
      toast(`Code: ${copyDiscount.dataset.copyDiscount}`);
    }
    return;
  }

  const toggleDiscount = event.target.closest("[data-toggle-discount]");
  if (toggleDiscount) {
    toggleDiscount.disabled = true;
    const nextActive = toggleDiscount.dataset.nextActive === "true";
    const { error } = await supabase.rpc("set_store_discount_code_active", {
      p_discount_code_id: toggleDiscount.dataset.toggleDiscount,
      p_active: nextActive,
    });
    if (error) {
      toggleDiscount.disabled = false;
      return toast(error.message);
    }
    toast(nextActive ? "Discount code activated." : "Discount code deactivated.");
    return renderDiscounts();
  }

  const settleStore = event.target.closest("[data-settle-store]");
  if (settleStore) {
    if (!confirm(`Confirm the store has been paid?\n\n${settleStore.dataset.settlementLabel}`)) return;
    const reference = prompt("Enter the bank transfer or payout reference:");
    if (reference === null) return;
    if (!reference.trim()) return toast("A payout reference is required.");
    const note = prompt("Optional payout note:") || null;
    settleStore.disabled = true;
    const { error } = await supabase.rpc("admin_mark_vendor_order_paid", {
      p_vendor_order_id: settleStore.dataset.settleStore,
      p_reference: reference.trim(),
      p_note: note?.trim() || null,
    });
    if (error) { settleStore.disabled = false; return toast(error.message); }
    toast("Store payout recorded.");
    return renderSettlements();
  }

  const settleCourier = event.target.closest("[data-settle-courier]");
  if (settleCourier) {
    if (!confirm(`Confirm this courier charge has been paid or deducted?\n\n${settleCourier.dataset.settlementLabel}`)) return;
    const reference = prompt("Enter the Bob Go invoice, wallet, or payment reference:");
    if (reference === null) return;
    if (!reference.trim()) return toast("A courier payment reference is required.");
    const note = prompt("Optional reconciliation note:") || null;
    settleCourier.disabled = true;
    const { error } = await supabase.rpc("admin_mark_courier_paid", {
      p_kind: settleCourier.dataset.shipmentKind,
      p_shipment_id: settleCourier.dataset.settleCourier,
      p_reference: reference.trim(),
      p_note: note?.trim() || null,
    });
    if (error) { settleCourier.disabled = false; return toast(error.message); }
    toast("Courier payment recorded.");
    return renderSettlements();
  }
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
    const fieldValue = (field) => document.querySelector(`[data-store-${field}="${CSS.escape(id)}"]`).value.trim();
    const featuredChoice = document.querySelector(`[data-store-featured="${CSS.escape(id)}"]`).value;
    const featuredOverride = featuredChoice === "pinned"
      ? true
      : featuredChoice === "hidden"
        ? false
        : null;

    saveStore.disabled = true;
    try {
      const packageLengthCm = Number(document.querySelector(`[data-store-package-length="${CSS.escape(id)}"]`).value);
      const packageWidthCm = Number(document.querySelector(`[data-store-package-width="${CSS.escape(id)}"]`).value);
      const packageHeightCm = Number(document.querySelector(`[data-store-package-height="${CSS.escape(id)}"]`).value);
      const packageTareWeightKg = weightToKg(
        document.querySelector(`[data-store-package-tare="${CSS.escape(id)}"]`).value,
        document.querySelector(`[data-store-package-tare-unit="${CSS.escape(id)}"]`).value,
        true
      );
      const packageItemCapacity = Number(document.querySelector(`[data-store-package-capacity="${CSS.escape(id)}"]`).value);

      const privateSettings = {
        contact_email: fieldValue("email").toLowerCase(),
        contact_phone: fieldValue("phone"),
        collection_street_address: fieldValue("street"),
        collection_local_area: fieldValue("area"),
        collection_city: fieldValue("city"),
        collection_province: fieldValue("province"),
        collection_postal_code: fieldValue("postal"),
        collection_country_code: "ZA",
        package_length_cm: packageLengthCm,
        package_width_cm: packageWidthCm,
        package_height_cm: packageHeightCm,
        package_tare_weight_kg: packageTareWeightKg,
        package_item_capacity: packageItemCapacity,
        updated_at: new Date().toISOString(),
      };

      if (!privateSettings.contact_phone || !privateSettings.collection_street_address || !privateSettings.collection_city || !privateSettings.collection_province || !privateSettings.collection_postal_code) {
        throw new Error("Complete the store's contact phone and collection address before saving.");
      }
      if (![packageLengthCm, packageWidthCm, packageHeightCm].every((value) => Number.isFinite(value) && value > 0)) {
        throw new Error("Enter valid standard package dimensions greater than 0 cm.");
      }
      if (!Number.isInteger(packageItemCapacity) || packageItemCapacity < 1 || packageItemCapacity > 50) {
        throw new Error("Items per package must be a whole number from 1 to 50.");
      }

      const { error } = await supabase.rpc("admin_update_vendor_v2", {
        p_vendor_id: id,
        p_business_name: fieldValue("name"),
        p_contact_email: privateSettings.contact_email,
        p_commission_rate_bps: Math.round(Number(document.querySelector(`[data-store-commission="${CSS.escape(id)}"]`).value) * 100),
        p_short_description: fieldValue("short"),
        p_description: fieldValue("description"),
        p_mark: fieldValue("mark").toUpperCase(),
        p_accent: document.querySelector(`[data-store-accent="${CSS.escape(id)}"]`).value,
        p_is_platform_owned: document.querySelector(`[data-store-platform-owned="${CSS.escape(id)}"]`).checked,
        p_featured_override: featuredOverride,
      });

      if (error) throw error;
      const { error: privateError } = await supabase
        .from("vendor_private_settings")
        .update(privateSettings)
        .eq("vendor_id", id);
      if (privateError) throw privateError;

      toast("Store details, collection address and shipping package saved.");
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
    const itemWeightKg = weightToKg(
      document.querySelector(`[data-product-weight="${CSS.escape(id)}"]`).value,
      document.querySelector(`[data-product-weight-unit="${CSS.escape(id)}"]`).value
    );
    const { error } = await supabase.rpc("update_product_details", {
      p_product_id: id,
      p_name: document.querySelector(`[data-product-name="${CSS.escape(id)}"]`).value,
      p_category: document.querySelector(`[data-product-category="${CSS.escape(id)}"]`).value,
      p_description: document.querySelector(`[data-product-description="${CSS.escape(id)}"]`).value,
      p_is_rare: document.querySelector(`[data-product-rare="${CSS.escape(id)}"]`).checked,
      p_status: document.querySelector(`[data-product-status="${CSS.escape(id)}"]`).value,
    });
    if (error) return toast(error.message);
    const { error: weightError } = await supabase.from("product_variants").update({ weight_kg:itemWeightKg, updated_at:new Date().toISOString() }).eq("product_id",id);
    if (weightError) return toast(weightError.message);
    toast("Product details and item weight saved.");
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
    const itemWeightKg = weightToKg(
      document.querySelector(`[data-product-weight="${CSS.escape(id)}"]`).value,
      document.querySelector(`[data-product-weight-unit="${CSS.escape(id)}"]`).value
    );
    const { error } = await supabase.rpc("add_product_variant", {
      p_product_id:id,p_size:size,p_colour:colour,p_price_cents:Math.round(price*100),p_stock_quantity:stock,
      p_weight_kg:itemWeightKg,p_length_cm:1,p_width_cm:1,p_height_cm:1
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
  const rd=event.target.closest("[data-return-decision]");if(rd){try{const{data,error}=await supabase.rpc("decide_return_v2",{p_return_id:rd.dataset.returnDecision,p_decision:rd.dataset.decision,p_responsibility:rd.dataset.responsibility||null,p_note:null});if(error)throw error;if(data?.status==="approved")await portalReturnApi("prepare-reverse",{returnId:rd.dataset.returnDecision});toast(data?.status==="under_review"?"Return escalated.":"Return decision saved.")}catch(e){toast(e.message)}return renderReturns()}
  const pr=event.target.closest("[data-prepare-return]");if(pr){try{await portalReturnApi("prepare-reverse",{returnId:pr.dataset.prepareReturn});toast("Return courier prepared.")}catch(e){toast(e.message)}return renderReturns()}
  const rr=event.target.closest("[data-return-received]");if(rr){const{error}=await supabase.rpc("mark_return_received_v2",{p_return_id:rr.dataset.returnReceived});if(error)return toast(error.message);toast("Returned parcel received.");return renderReturns()}
  const pe=event.target.closest("[data-prepare-exchange]");if(pe){try{await portalReturnApi("prepare-exchange",{returnId:pe.dataset.prepareExchange});toast("Replacement delivery prepared.")}catch(e){toast(e.message)}return renderReturns()}
  const rf=event.target.closest("[data-confirm-refund]");if(rf){if(!confirm("Confirm only after the customer refund is completed through the original payment provider."))return;const{error}=await supabase.rpc("confirm_return_refund_v2",{p_return_id:rf.dataset.confirmRefund});if(error)return toast(error.message);toast("Refund recorded; vendor recovery updated.");return renderReturns()}
  const ce=event.target.closest("[data-close-exchange]");if(ce){const{error}=await supabase.rpc("close_exchange_return_v2",{p_return_id:ce.dataset.closeExchange});if(error)return toast(error.message);toast("Exchange closed.");return renderReturns()}

}

async function handlePortalSubmit(event) {
  const form = event.target.closest("[data-form]");
  if (!form) return;
  event.preventDefault();
  const message = form.querySelector(".form-message");
  try {
    if (form.dataset.form === "discount-code") {
      const values = Object.fromEntries(new FormData(form));
      const discountType = values.discount_type;
      const startsAt = new Date(values.starts_at);
      const expiresAt = values.expires_at ? new Date(values.expires_at) : null;
      if (!Number.isFinite(startsAt.getTime()) || (expiresAt && !Number.isFinite(expiresAt.getTime()))) {
        throw new Error("Enter valid start and expiry dates.");
      }

      const button = form.querySelector('button[type="submit"], button:not([type])');
      if (button) {
        button.disabled = true;
        button.textContent = "Creating…";
      }

      const { data, error } = await supabase.rpc("create_store_discount_code", {
        p_vendor_id: values.vendor_id,
        p_code: String(values.code || "").trim() || null,
        p_name: String(values.name || "").trim() || null,
        p_discount_type: discountType,
        p_percentage: discountType === "percentage" ? Number(values.percentage) : null,
        p_fixed_amount_cents: discountType === "fixed" ? Math.round(Number(values.fixed_rand) * 100) : null,
        p_minimum_subtotal_cents: Math.round(Number(values.minimum_rand || 0) * 100),
        p_usage_limit: Number(values.usage_limit),
        p_starts_at: startsAt.toISOString(),
        p_expires_at: expiresAt?.toISOString() || null,
      });
      if (error) {
        if (button) {
          button.disabled = false;
          button.textContent = "Generate & create code";
        }
        throw error;
      }

      toast(`Discount code ${data.code} created.`);
      return renderDiscounts();
    }

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
      const raw = Object.fromEntries(new FormData(form));
      const values = {
        contact_email: String(raw.contact_email || "").trim(),
        contact_phone: String(raw.contact_phone || "").trim(),
        collection_street_address: String(raw.collection_street_address || "").trim(),
        collection_local_area: String(raw.collection_local_area || "").trim(),
        collection_city: String(raw.collection_city || "").trim(),
        collection_province: String(raw.collection_province || "").trim(),
        collection_postal_code: String(raw.collection_postal_code || "").trim(),
        package_length_cm: Number(raw.package_length_cm),
        package_width_cm: Number(raw.package_width_cm),
        package_height_cm: Number(raw.package_height_cm),
        package_tare_weight_kg: weightToKg(raw.package_tare_weight, raw.package_tare_weight_unit, true),
        package_item_capacity: Number(raw.package_item_capacity),
        updated_at: new Date().toISOString(),
      };
      if (![values.package_length_cm,values.package_width_cm,values.package_height_cm].every((value) => Number.isFinite(value) && value > 0)) throw new Error("Enter valid standard package dimensions.");
      if (!Number.isInteger(values.package_item_capacity) || values.package_item_capacity < 1) throw new Error("Items per package must be a whole number of at least 1.");
      const { error } = await supabase.from("vendor_private_settings").update(values).eq("vendor_id", state.currentVendorId);
      if (error) throw error;
      toast("Store and shipping settings saved.");
      return renderSettings();
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
      ? '<a class="primary-button" href="/admin">Open admin portal</a>'
      : '<a class="primary-button" href="/">Return to storefront</a>'}
  </section>`;
}


// VENDOR_TERMS_GATE_V1
let vendorTermsAcceptedV1 = null;


async function ensureVendorTermsAcceptedV1() {

  if (
    area !== "vendor"
    || !state.currentVendorId
  ) {
    return true;
  }


  if (
    vendorTermsAcceptedV1 === true
  ) {
    return true;
  }


  const {
    data,
    error
  } =
    await supabase.rpc(
      "has_current_terms_acceptance",
      {
        p_context:
          "vendor"
      }
    );


  if (error) {
    throw error;
  }


  if (data === true) {
    vendorTermsAcceptedV1 = true;
    return true;
  }


  content.innerHTML = `
    <section class="portal-alert glass terms-gate">

      <p class="eyebrow">
        VENDOR TERMS
      </p>

      <h1>
        Accept the Vendor Clause to continue.
      </h1>

      <p>
        Kompo Nation's Terms of Service include
        the Vendor Clause covering marketplace
        commission, returns, fulfilment,
        packaging, courier collection and
        settlement responsibilities.
      </p>

      <label class="legal-consent">
        <input
          id="vendor-terms-acceptance"
          type="checkbox"
        >

        <span>
          I am authorised to act for this store
          and accept the current
          <a
            href="/terms"
          >Terms of Service and Vendor Clause</a>.
        </span>
      </label>

      <button
        class="primary-button"
        id="accept-vendor-terms"
        type="button"
      >
        Accept and continue
      </button>

      <p
        class="form-message"
        id="vendor-terms-message"
        aria-live="polite"
      ></p>

    </section>
  `;


  const acceptButton =
    document.querySelector(
      "#accept-vendor-terms"
    );


  acceptButton.addEventListener(
    "click",
    async () => {

      const checkbox =
        document.querySelector(
          "#vendor-terms-acceptance"
        );

      const message =
        document.querySelector(
          "#vendor-terms-message"
        );


      if (!checkbox?.checked) {
        message.textContent =
          "Accept the Vendor Clause before continuing.";

        return;
      }


      acceptButton.disabled = true;
      acceptButton.textContent =
        "Recording acceptance…";


      try {

        const {
          data: acceptanceId,
          error: acceptanceError
        } =
          await supabase.rpc(
            "accept_current_terms",
            {
              p_context:
                "vendor"
            }
          );


        if (acceptanceError) {
          throw acceptanceError;
        }


        if (!acceptanceId) {
          throw new Error(
            "Vendor acceptance could not be recorded."
          );
        }


        vendorTermsAcceptedV1 = true;

        await renderView();

      } catch (error) {

        message.textContent =
          error.message;

        acceptButton.disabled = false;
        acceptButton.textContent =
          "Accept and continue";
      }

    }
  );


  return false;
}


async function renderView() {

  if (
    area === "vendor"
    && !(await ensureVendorTermsAcceptedV1())
  ) {
    return;
  }

  if (area === "vendor" && !state.currentVendorId) return renderNoVendorStore();
  if (state.view === "overview") return renderOverview();
  if (state.view === "stores") return renderStores();
  if (state.view === "products") return renderProducts();
  if (state.view === "discounts") return renderDiscounts();
  if (state.view === "orders") return renderOrders();
  if (state.view === "settlements") return renderSettlements();
  if (state.view === "cancellations") return renderCancellations();
  if (state.view === "returns") return renderReturns();
  if (state.view === "information") return renderInformation();
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
