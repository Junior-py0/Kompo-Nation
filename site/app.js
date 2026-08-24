(() => {
const { CONFIG, isSupabaseConfigured } = window.KOMPO_CONFIG;
const { LOCAL_PRODUCTS, LOCAL_STORES, rankProducts, rankStores } = window.KOMPO_CATALOG;
const { authHeader, getSession, loadRemoteCatalogue, loadWishlist, supabase, toggleRemoteWishlist } = window.KOMPO_SUPABASE;

/* ========================================================================== */
/* 01. APPLICATION STATE AND SAFE FORMATTERS                                  */
/* ========================================================================== */
const app = document.querySelector("#app");
const isLocalFile = location.protocol === "file:";
const state = {
  session: null,
  products: LOCAL_PRODUCTS,
  stores: LOCAL_STORES,
  cart: readStorage("kompo-cart", []),
  wishlist: readStorage("kompo-wishlist", []),
};

function readStorage(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

const money = (cents) => new Intl.NumberFormat(CONFIG.locale, {
  style: "currency",
  currency: CONFIG.currency
}).format(Number(cents || 0) / 100);

const escapeHtml = (value = "") =>
  String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;"
  })[character]);

function currentRoute() {
  if (!isLocalFile) {
    return {
      path: location.pathname.replace(/\/+$/, "") || "/",
      search: location.search
    };
  }

  const hashRoute = location.hash.startsWith("#")
    ? location.hash.slice(1)
    : "/";

  const separator = hashRoute.indexOf("?");

  const path = (
    separator >= 0
      ? hashRoute.slice(0, separator)
      : hashRoute
  ).replace(/\/+$/, "") || "/";

  const search = separator >= 0
    ? hashRoute.slice(separator)
    : "";

  return {
    path: path.startsWith("/") ? path : `/${path}`,
    search
  };
}

const slugPart = (index) =>
  decodeURIComponent(
    currentRoute().path.split("/").filter(Boolean)[index] || ""
  );

const assetPath = (path) =>
  isLocalFile ? `.${path}` : path;

const loginPath = (next) =>
  isLocalFile
    ? `./login.html?next=${encodeURIComponent(next)}`
    : `/login?next=${encodeURIComponent(next)}`;

const homePath = () =>
  isLocalFile ? "./index.html" : "/";

const storeFor = (product) =>
  state.stores.find((store) => store.id === product.vendorId);

const tone = (name) => ({
  sage: "rgba(179,193,181,.72)",
  sand: "rgba(227,216,198,.78)",
  mist: "rgba(205,217,214,.8)",
  stone: "rgba(210,203,193,.8)"
})[name] || "rgba(207,216,212,.72)";

const publicReference = (value) =>
  escapeHtml(value || "Pending reference");

function setMeta(title, description) {
  document.title = `${title} — Kompo Nation`;

  const tag = document.querySelector(
    'meta[name="description"]'
  );

  if (tag) {
    tag.setAttribute("content", description);
  }
}

function showToast(message) {
  const toast = document.querySelector("#toast");

  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);

  showToast.timer = setTimeout(
    () => toast.classList.remove("show"),
    3200
  );
}

function saveCommerceState() {
  localStorage.setItem(
    "kompo-cart",
    JSON.stringify(state.cart)
  );

  localStorage.setItem(
    "kompo-wishlist",
    JSON.stringify(state.wishlist)
  );

  updateCounts();
}

function updateCounts() {
  const cartCount = state.cart.reduce(
    (sum, line) => sum + Number(line.quantity),
    0
  );

  document.querySelector("#cart-count").textContent =
    String(cartCount);

  document.querySelector("#wishlist-count").textContent =
    String(state.wishlist.length);
}

/* ========================================================================== */
/* 02. REUSABLE STOREFRONT COMPONENTS                                         */
/* ========================================================================== */

function productVisual(product, large = false) {
  const image = product.imageUrl
    ? `<img src="${escapeHtml(product.imageUrl)}"
         alt="${escapeHtml(product.name)}"
         loading="lazy">`
    : `<span class="garment-shape" aria-hidden="true"></span>`;

  return `
    <div
      class="product-visual ${large ? "product-detail-visual" : ""}"
      style="--product-tone:${tone(product.tone)}"
    >
      ${image}

      <div class="product-badges">
        ${
          product.isRare
            ? "<span>LIMITED</span>"
            : "<span>IN THE MOVEMENT</span>"
        }
        <span>${product.stock} LEFT</span>
      </div>

      ${
        large
          ? ""
          : `
            <button
              class="wish-button ${
                state.wishlist.includes(product.id)
                  ? "active"
                  : ""
              }"
              data-wish="${product.id}"
              aria-label="Save ${escapeHtml(product.name)}"
            >
              ♡
            </button>
          `
      }
    </div>
  `;
}

function productCard(product) {
  const store = storeFor(product);

  return `
    <article class="product-card reveal">
      <a href="/product/${encodeURIComponent(product.slug)}">
        ${productVisual(product)}
      </a>

      <div class="product-info">
        <small>
          ${escapeHtml(store?.name || "Kompo Nation")}
          ·
          ${escapeHtml(product.category)}
        </small>

        <div class="product-title-row">
          <h3>
            <a href="/product/${encodeURIComponent(product.slug)}">
              ${escapeHtml(product.name)}
            </a>
          </h3>

          <strong>${money(product.priceCents)}</strong>
        </div>
      </div>
    </article>
  `;
}

function storeCard(store, index) {
  return `
    <a
      class="store-card reveal"
      href="/store/${encodeURIComponent(store.slug)}"
      style="--store-tone:${tone(store.accent)}"
    >
      <div class="store-rank">
        <span>0${index + 1}</span>
        <span>
          ${
            store.featuredOverride
              ? "HOUSE PICK"
              : "TRENDING"
          }
        </span>
      </div>

      <span class="store-monogram">
        ${escapeHtml(store.mark)}
      </span>

      <div>
        <h3>${escapeHtml(store.name)}</h3>
        <p>${escapeHtml(store.shortDescription)}</p>
      </div>
    </a>
  `;
}

const productGrid = (products) =>
  products.length
    ? `
      <div class="product-grid">
        ${products.map(productCard).join("")}
      </div>
    `
    : `
      <section class="empty-state glass">
        <span>◇</span>
        <h2>Nothing is sitting here yet.</h2>
        <p>Return soon for the next release.</p>
      </section>
    `;

/* ========================================================================== */
/* 03. PUBLIC PAGE RENDERERS                                                  */
/* ========================================================================== */

function renderHome() {
  setMeta(
    "Wear the movement",
    "Artist-led fashion and independent merchandise from Limpopo, delivered across South Africa."
  );

  const hotStores =
    rankStores(state.stores).slice(0, 5);

  const hotProducts =
    rankProducts(state.products).slice(0, 8);

  app.innerHTML = `
    <section class="hero">
      <div class="hero-card">
        <img
          class="hero-image"
          src="${assetPath("/assets/campaign-crew-v4.png")}"
          alt="Kompo Nation fashion campaign"
        >

        <div class="hero-note">
          <strong>${state.stores.length}</strong>
          <small>
            independent stores moving together
          </small>
        </div>

        <div class="hero-copy">
          <p class="eyebrow">
            WELCOME TO KOMPO NATION
          </p>

          <h1>Wear the movement.</h1>

          <p>
            Artist-led fashion and independent merchandise
            from Limpopo, delivered to fans across
            South Africa.
          </p>

          <div class="hero-actions">
            <a
              class="primary-button"
              href="/shop"
            >
              Shop the collection
            </a>

            <a
              class="secondary-button"
              href="/stores"
            >
              Meet the stores
            </a>
          </div>
        </div>
      </div>
    </section>

    <section class="content-section trust-strip glass">
      <article>
        <strong>One bag</strong>
        <span>
          Shop across the nation in one place
        </span>
      </article>

      <article>
        <strong>Independent energy</strong>
        <span>
          Every purchase supports a local label
        </span>
      </article>

      <article>
        <strong>Tracked delivery</strong>
        <span>
          Courier updates from collection to arrival
        </span>
      </article>
    </section>

    <section class="content-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">HOT STORES</p>
          <h2>The labels moving now.</h2>

          <p>
            Homepage positions respond to verified sales,
            active stock and operator curation.
          </p>
        </div>

        <a
          class="section-link"
          href="/stores"
        >
          Explore every store →
        </a>
      </div>

      <div class="store-grid">
        ${hotStores.map(storeCard).join("")}
      </div>
    </section>

    <section class="content-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">
            FROM ACROSS THE NATION
          </p>

          <h2>Pieces with momentum.</h2>

          <p>
            Best sellers rise with real demand,
            while available limited runs receive
            a measured lift.
          </p>
        </div>

        <a
          class="section-link"
          href="/shop"
        >
          Shop everything →
        </a>
      </div>

      ${productGrid(hotProducts)}
    </section>

    <section class="content-section story-panel glass">
      <div>
        <p class="eyebrow">
          BUILT IN LIMPOPO
        </p>

        <h2>
          A shared stage for independent style.
        </h2>

        <p>
          Kompo Nation gives artist-led labels a place
          to reach fans beyond event queues and
          provincial borders—without losing the identity
          that made the movement matter.
        </p>

        <a
          class="section-link"
          href="/about"
        >
          Read our story →
        </a>
      </div>

      <div class="story-art">
        <span>KN</span>
      </div>
    </section>
  `;
}

function renderShop() {
  setMeta(
    "Shop",
    "Shop independent fashion, limited artist merchandise and Kompo Nation essentials."
  );

  const category =
    new URLSearchParams(currentRoute().search)
      .get("category") || "All";

  const categories = [
    "All",
    ...new Set(
      state.products.map(
        (product) => product.category
      )
    )
  ];

  const products =
    rankProducts(state.products).filter(
      (product) =>
        category === "All" ||
        product.category === category
    );

  app.innerHTML = `
    <section class="page-hero">
      <div>
        <p class="eyebrow">THE NATION SHOP</p>

        <h1>Find your next piece.</h1>

        <p>
          Independent collections, limited artist
          merchandise and Kompo Nation essentials
          in one considered edit.
        </p>
      </div>

      <strong>
        ${products.length} pieces
      </strong>
    </section>

    <nav
      class="filter-row"
      aria-label="Product categories"
    >
      ${categories.map((item) => `
        <a href="/shop?category=${encodeURIComponent(item)}">
          <button class="${category === item ? "active" : ""}">
            ${escapeHtml(item)}
          </button>
        </a>
      `).join("")}
    </nav>

    <section class="catalogue-section">
      ${productGrid(products)}
    </section>
  `;
}

function renderStores() {
  setMeta(
    "Stores",
    "Discover independent artist-led labels and emerging fashion voices from Limpopo."
  );

  const stores = rankStores(state.stores);

  app.innerHTML = `
    <section class="page-hero">
      <div>
        <p class="eyebrow">
          INDEPENDENT BY NATURE
        </p>

        <h1>Every store has a pulse.</h1>

        <p>
          Discover artist-led labels and emerging
          fashion voices growing from Limpopo.
        </p>
      </div>

      <strong>
        ${stores.length} stores
      </strong>
    </section>

    <section class="catalogue-section">
      <div class="store-grid">
        ${stores.map(storeCard).join("")}
      </div>
    </section>
  `;
}

function renderStore() {
  const store = state.stores.find(
    (item) =>
      item.slug === slugPart(1)
  );

  if (!store) {
    return renderNotFound();
  }

  setMeta(
    store.name,
    store.shortDescription
  );

  const products =
    rankProducts(
      state.products.filter(
        (product) =>
          product.vendorId === store.id
      )
    );

  app.innerHTML = `
    <section
      class="store-page-banner"
      data-mark="${escapeHtml(store.mark)}"
      style="
        background:
          linear-gradient(
            135deg,
            ${tone(store.accent)},
            var(--sand)
          )
      "
    >
      <div>
        <p class="eyebrow">
          KOMPO NATION STORE
        </p>

        <h1>
          ${escapeHtml(store.name)}
        </h1>

        <p>
          ${escapeHtml(store.description)}
        </p>
      </div>
    </section>

    <section class="catalogue-section">
      <div class="section-heading">
        <div>
          <h2>Available now.</h2>

          <p>
            ${products.length}
            pieces currently moving through this store.
          </p>
        </div>
      </div>

      ${productGrid(products)}
    </section>
  `;
}

function productVariants(product) {
  if (Array.isArray(product.variants) && product.variants.length) {
    return product.variants.filter((variant) => variant.active !== false);
  }

  const sizes = product.sizes?.length ? product.sizes : ["One size"];
  const colours = product.colours?.length ? product.colours : ["Default"];

  return sizes.flatMap((size) => colours.map((colour) => ({
    id: `${product.id}-${size}-${colour}`,
    sku: product.sku || "",
    size,
    colour,
    priceCents: Number(product.priceCents),
    stock: Number(product.stock),
    active: true,
    fallback: true,
  })));
}

function selectedVariant(product, size, colour) {
  return productVariants(product).find(
    (variant) => variant.size === size && variant.colour === colour
  ) || null;
}

function renderProduct() {
  const product = state.products.find((item) => item.slug === slugPart(1));
  if (!product) return renderNotFound();

  setMeta(product.name, product.description);
  const store = storeFor(product);
  const variants = productVariants(product);

  if (!variants.length) {
    app.innerHTML = `<section class="empty-state glass">
      <span>◇</span>
      <h1>${escapeHtml(product.name)} is unavailable.</h1>
      <p>This product currently has no active options.</p>
      <a class="primary-button" href="/shop">Back to shop</a>
    </section>`;
    return;
  }

  const sizes = [...new Set(variants.map((variant) => variant.size))];
  const initialSize =
    sizes.find((size) =>
      variants.some((variant) => variant.size === size && variant.stock > 0)
    ) || sizes[0];

  app.innerHTML = `<section class="product-detail">
    <div>${productVisual(product, true)}</div>

    <div class="product-detail-copy glass">
      <p class="eyebrow">${escapeHtml(store?.name || "KOMPO NATION")} · ${escapeHtml(product.category)}</p>
      <h1>${escapeHtml(product.name)}</h1>
      <p class="product-detail-price" id="variant-price">${money(product.priceCents)}</p>
      <p>${escapeHtml(product.description)}</p>

      <form id="product-form">
        <div class="option-group">
          <span>SIZE</span>
          <div class="option-list">
            ${sizes.map((size) => {
              const sizeStock = variants
                .filter((variant) => variant.size === size)
                .reduce((sum, variant) => sum + Number(variant.stock), 0);

              return `<label>
                <input
                  type="radio"
                  name="size"
                  value="${escapeHtml(size)}"
                  ${size === initialSize ? "checked" : ""}
                  ${sizeStock < 1 ? "disabled" : ""}
                >
                <span>${escapeHtml(size)}${sizeStock < 1 ? " · Sold out" : ""}</span>
              </label>`;
            }).join("")}
          </div>
        </div>

        <div class="option-group">
          <span>COLOUR</span>
          <div class="option-list" id="variant-colours"></div>
        </div>

        <div class="detail-actions">
          <button class="primary-button" id="variant-add-button" type="submit">
            Choose an available option
          </button>

          <button class="quiet-button" type="button" data-wish="${product.id}">
            ${state.wishlist.includes(product.id) ? "Saved" : "♡"}
          </button>
        </div>
      </form>

      <p id="variant-availability"><small>Checking availability…</small></p>
    </div>
  </section>`;

  const form = document.querySelector("#product-form");
  const colourList = document.querySelector("#variant-colours");
  const price = document.querySelector("#variant-price");
  const availability = document.querySelector("#variant-availability");
  const addButton = document.querySelector("#variant-add-button");

  function drawColours() {
    const size = form.elements.size?.value || initialSize;
    const matching = variants.filter((variant) => variant.size === size);
    const oldColour = form.elements.colour?.value;

    const firstAvailableIndex = matching.findIndex(
      (variant) => Number(variant.stock) > 0
    );

    colourList.innerHTML = matching.map((variant, index) => `<label>
      <input
        type="radio"
        name="colour"
        value="${escapeHtml(variant.colour)}"
        ${Number(variant.stock) < 1 ? "disabled" : ""}
        ${
          oldColour === variant.colour ||
          (!oldColour && index === firstAvailableIndex)
            ? "checked"
            : ""
        }
      >
      <span>${escapeHtml(variant.colour)}${Number(variant.stock) < 1 ? " · Sold out" : ""}</span>
    </label>`).join("");

    syncVariant();
  }

  function syncVariant() {
    const size = form.elements.size?.value;
    const colour = form.elements.colour?.value;
    const variant = selectedVariant(product, size, colour);

    if (!variant || Number(variant.stock) < 1) {
      addButton.disabled = true;
      addButton.textContent = "This option is sold out";
      availability.innerHTML =
        "<small>Choose another available size or colour.</small>";
      return;
    }

    price.textContent = money(variant.priceCents);
    addButton.disabled = false;
    addButton.textContent = `Add to bag · ${money(variant.priceCents)}`;

    availability.innerHTML = `<small>
      ${variant.stock} available online
      ${variant.sku ? ` · SKU ${escapeHtml(variant.sku)}` : ""}
    </small>`;
  }

  form.addEventListener("change", (event) => {
    if (event.target.name === "size") drawColours();
    if (event.target.name === "colour") syncVariant();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const size = form.elements.size?.value;
    const colour = form.elements.colour?.value;

    if (!size || !colour) {
      showToast("Choose an available size and colour.");
      return;
    }

    addToCart(product.id, size, colour);
  });

  drawColours();
}


function renderAbout() {
  app.innerHTML = `
    <section class="page-hero">
      <div>
        <p class="eyebrow">OUR STORY</p>

        <h1>Local sound. Wider movement.</h1>

        <p>
          Kompo Nation exists to help independent
          artists and labels turn loyal audiences
          into sustainable reach.
        </p>
      </div>
    </section>

    <section class="content-section story-panel glass">
      <div>
        <h2>
          Made to carry culture further.
        </h2>

        <p>
          Some of the most meaningful merchandise
          is still sold only at events, in social
          posts or through direct messages.
          We are building the shared retail layer
          between those labels and the fans already
          looking for them.
        </p>

        <p>
          Every store keeps its identity,
          manages its own online stock and fulfils
          its own packages. Kompo Nation provides
          discovery, secure checkout, order
          coordination and the operational systems
          around the sale.
        </p>
      </div>

      <div class="story-art">
        <span>KN</span>
      </div>
    </section>
  `;
}

function renderInformation(type) {
  const pages = {
    delivery: [
      "Delivery",
      "Every vendor package is quoted from its own collection address. A multi-store order can arrive in separate courier deliveries, each with its own tracking reference."
    ],

    returns: [
      "Returns",
      "Eligible delivered items can be submitted from your account. The store reviews the item and Kompo Nation coordinates the recorded decision and refund status."
    ],

    contact: [
      "Contact",
      "Customer and vendor support details will be published before the closed alpha opens."
    ],

    privacy: [
      "Privacy",
      "Kompo Nation collects only the information needed for accounts, payment records, fulfilment and support. The complete POPIA-reviewed notice must be approved before public launch."
    ],

    terms: [
      "Terms",
      "Marketplace, customer and vendor terms must receive South African legal review before public launch."
    ]
  };

  const [title, copy] = pages[type];

  app.innerHTML = `
    <section class="page-hero">
      <div>
        <p class="eyebrow">KOMPO NATION</p>

        <h1>${title}</h1>

        <p>${copy}</p>
      </div>
    </section>

    <section class="content-section empty-state glass">
      <span>◇</span>

      <h2>
        Clear details, before launch.
      </h2>

      <p>
        This page is ready for the final operational
        and legally reviewed policy.
      </p>
    </section>
  `;
}

/* ========================================================================== */
/* 04. CART AND CHECKOUT                                                      */
/* ========================================================================== */

function addToCart(productId, size, colour) {
  const product = state.products.find((item) => item.id === productId);

  if (!product) {
    showToast("This product is no longer available.");
    return;
  }

  const variant = selectedVariant(
    product,
    String(size || ""),
    String(colour || "")
  );

  if (!variant || Number(variant.stock) < 1) {
    showToast("That size and colour combination is sold out.");
    return;
  }

  const existing = state.cart.find(
    (line) =>
      line.productId === productId &&
      line.size === variant.size &&
      line.colour === variant.colour
  );

  if (existing) {
    if (existing.quantity >= Number(variant.stock)) {
      showToast(
        `Only ${variant.stock} of this option ${Number(variant.stock) === 1 ? "is" : "are"} available.`
      );
      return;
    }

    existing.quantity += 1;
  } else {
    state.cart.push({
      productId,
      variantId: variant.id,
      quantity: 1,
      size: variant.size,
      colour: variant.colour,
    });
  }

  saveCommerceState();

  showToast(
    `${product.name} · ${variant.size} · ${variant.colour} is in your bag.`
  );
}

function cartRows() {
  return state.cart
    .map((line) => {
      const product = state.products.find(
        (item) => item.id === line.productId
      );

      if (!product) return null;

      const variant = selectedVariant(
        product,
        line.size,
        line.colour
      );

      if (!variant) return null;

      return {
        ...line,
        product,
        variant,
        unitPriceCents: Number(variant.priceCents),
      };
    })
    .filter(Boolean);
}

function renderCart() {
  const rows = cartRows();

  if (!rows.length) {
    app.innerHTML = `<section class="empty-state glass">
      <span>◇</span>
      <h1>Your bag is open.</h1>
      <p>Find a piece from across the nation and bring it back here.</p>
      <a class="primary-button" href="/shop">Start shopping</a>
    </section>`;
    return;
  }

  const subtotal = rows.reduce(
    (sum, line) => sum + line.unitPriceCents * line.quantity,
    0
  );

  app.innerHTML = `<section class="commerce-layout">
    <div class="commerce-main glass">
      <p class="eyebrow">YOUR BAG</p>
      <h1>${rows.reduce((sum, line) => sum + line.quantity, 0)} pieces.</h1>

      ${rows.map((line) => `<article class="cart-line">
        <div class="cart-thumb">
          ${
            line.product.imageUrl
              ? `<img src="${escapeHtml(line.product.imageUrl)}" alt="${escapeHtml(line.product.name)}">`
              : ""
          }
        </div>

        <div>
          <h3>${escapeHtml(line.product.name)}</h3>
          <p>
            ${escapeHtml(storeFor(line.product)?.name || "Kompo Nation")}
            · ${escapeHtml(line.size)}
            · ${escapeHtml(line.colour)}
          </p>

          <small>${line.variant.stock} currently available</small>

          <div class="line-controls">
            <button
              data-quantity="-1"
              data-line="${escapeHtml(line.productId)}|${escapeHtml(line.size)}|${escapeHtml(line.colour)}"
            >−</button>

            <span>${line.quantity}</span>

            <button
              data-quantity="1"
              data-line="${escapeHtml(line.productId)}|${escapeHtml(line.size)}|${escapeHtml(line.colour)}"
              ${line.quantity >= Number(line.variant.stock) ? "disabled" : ""}
            >+</button>

            <button
              class="remove-line"
              data-remove-line="${escapeHtml(line.productId)}|${escapeHtml(line.size)}|${escapeHtml(line.colour)}"
            >Remove</button>
          </div>
        </div>

        <strong>${money(line.unitPriceCents * line.quantity)}</strong>
      </article>`).join("")}
    </div>

    <aside class="order-summary glass">
      <h2>Summary</h2>

      <div class="summary-line">
        <span>Merchandise</span>
        <strong>${money(subtotal)}</strong>
      </div>

      <div class="summary-line">
        <span>Delivery</span>
        <span>Quoted at checkout</span>
      </div>

      <div class="summary-line summary-total">
        <span>Total before delivery</span>
        <strong>${money(subtotal)}</strong>
      </div>

      <a class="primary-button" href="/checkout">
        Continue to checkout
      </a>

      <p>
        <small>
          Each store can become a separate package while you make one payment.
        </small>
      </p>
    </aside>
  </section>`;
}


// CHECKOUT_REVIEW_FLOW_V1
// CUSTOMER_HIDE_COLLECTION_CUTOFF_V2
let pendingCheckoutReview = null;

async function renderCheckout() {
  pendingCheckoutReview = null;

  if (!state.session) {
    location.href = loginPath("/checkout");
    return;
  }

  const rows = cartRows();

  if (!rows.length) {
    return renderCart();
  }

  const subtotal = rows.reduce(
    (sum, line) =>
      sum + Number(line.unitPriceCents) * Number(line.quantity),
    0
  );

  const { data: addresses, error } = await supabase
    .from("addresses")
    .select("*")
    .order("is_default", { ascending: false })
    .order("created_at");

  if (error) throw error;

  state.checkoutAddresses = addresses || [];

  const profileName =
    state.session.user.user_metadata?.full_name || "";

  const phone =
    state.session.user.user_metadata?.phone || "";

  const hasSaved =
    state.checkoutAddresses.length > 0;

  app.innerHTML = `
    <section class="commerce-layout">

      <div class="commerce-main glass">

        <p class="eyebrow">SECURE CHECKOUT</p>
        <h1>Where is it going?</h1>

        <form
          id="checkout-form"
          class="stack-form"
        >

          <div class="checkout-address-choice">

            ${
              hasSaved
                ? `
                  <label class="choice-card">
                    <input
                      type="radio"
                      name="addressMode"
                      value="saved"
                      checked
                    >
                    <span>
                      <strong>Saved address</strong>
                      <small>
                        Use one already on your account.
                      </small>
                    </span>
                  </label>
                `
                : ""
            }

            <label class="choice-card">
              <input
                type="radio"
                name="addressMode"
                value="new"
                ${hasSaved ? "" : "checked"}
              >
              <span>
                <strong>New address</strong>
                <small>
                  Enter another delivery address.
                </small>
              </span>
            </label>

          </div>

          ${
            hasSaved
              ? `
                <div id="saved-address-fields">
                  <label>
                    Deliver to

                    <select name="savedAddressId">
                      ${
                        state.checkoutAddresses
                          .map(
                            (address) => `
                              <option value="${address.id}">
                                ${escapeHtml(address.label)}
                                —
                                ${escapeHtml(address.street_address)},
                                ${escapeHtml(address.city)}
                              </option>
                            `
                          )
                          .join("")
                      }
                    </select>
                  </label>
                </div>
              `
              : ""
          }

          <div
            id="new-address-fields"
            ${hasSaved ? "hidden" : ""}
          >

            <div class="form-grid">

              <label>
                Full name
                <input
                  name="fullName"
                  value="${escapeHtml(profileName)}"
                >
              </label>

              <label>
                Phone
                <input
                  name="phone"
                  value="${escapeHtml(phone)}"
                >
              </label>

            </div>

            <label>
              Email
              <input
                name="email"
                type="email"
                value="${escapeHtml(state.session.user.email)}"
                readonly
              >
            </label>

            <label>
              Street address
              <input
                name="streetAddress"
                autocomplete="street-address"
              >
            </label>

            <div class="form-grid">

              <label>
                Area or suburb
                <input
                  name="localArea"
                  autocomplete="address-level3"
                >
              </label>

              <label>
                City
                <input
                  name="city"
                  autocomplete="address-level2"
                >
              </label>

            </div>

            <div class="form-grid">

              <label>
                Province
                <select name="province">
                  <option>Limpopo</option>
                  <option>Gauteng</option>
                  <option>Mpumalanga</option>
                  <option>North West</option>
                  <option>KwaZulu-Natal</option>
                  <option>Free State</option>
                  <option>Northern Cape</option>
                  <option>Eastern Cape</option>
                  <option>Western Cape</option>
                </select>
              </label>

              <label>
                Postal code
                <input
                  name="postalCode"
                  inputmode="numeric"
                >
              </label>

            </div>

            <label class="switch-line">
              <input
                type="checkbox"
                name="saveNewAddress"
              >
              Save this address
            </label>

            <label
              id="checkout-address-label"
              hidden
            >
              Address label
              <input
                name="addressLabel"
                placeholder="Home, Work, Campus"
              >
            </label>

          </div>

          <button
            class="primary-button"
            id="checkout-submit"
            type="submit"
          >
            Get delivery quote
          </button>

          <p
            class="form-message"
            id="checkout-message"
            aria-live="polite"
          ></p>

        </form>

      </div>

      <aside
        class="order-summary glass"
        id="checkout-summary"
      >

        <h2>Your order</h2>

        ${
          rows
            .map(
              (line) => `
                <div class="summary-line">
                  <span>
                    ${line.quantity}
                    ×
                    ${escapeHtml(line.product.name)}
                  </span>

                  <strong>
                    ${
                      money(
                        Number(line.quantity) *
                        Number(line.unitPriceCents)
                      )
                    }
                  </strong>
                </div>
              `
            )
            .join("")
        }

        <div class="summary-line summary-total">
          <span>Before delivery</span>
          <strong>${money(subtotal)}</strong>
        </div>

        <p>
          <small>
            Enter the delivery address to get the live courier price.
          </small>
        </p>

      </aside>

    </section>
  `;

  const form =
    document.querySelector("#checkout-form");

  form
    .querySelectorAll('[name="addressMode"]')
    .forEach((radio) =>
      radio.addEventListener(
        "change",
        () => {
          const useNew =
            form.elements.addressMode.value === "new";

          const newFields =
            document.querySelector(
              "#new-address-fields"
            );

          const savedFields =
            document.querySelector(
              "#saved-address-fields"
            );

          if (newFields) {
            newFields.hidden = !useNew;
          }

          if (savedFields) {
            savedFields.hidden = useNew;
          }
        }
      )
    );

  form
    .querySelector('[name="saveNewAddress"]')
    ?.addEventListener(
      "change",
      (event) => {
        const label =
          document.querySelector(
            "#checkout-address-label"
          );

        if (label) {
          label.hidden =
            !event.target.checked;
        }
      }
    );

  form.addEventListener(
    "submit",
    beginCheckout
  );
}


async function beginCheckout(event) {
  event.preventDefault();

  const formElement =
    event.currentTarget;

  const button =
    document.querySelector("#checkout-submit");

  const message =
    document.querySelector("#checkout-message");

  button.disabled = true;
  button.textContent = "Getting live delivery…";

  message.textContent = "";

  try {

    const values =
      Object.fromEntries(
        new FormData(formElement)
      );

    let address;
    let contact;

    if (
      (values.addressMode || "new") ===
      "saved"
    ) {

      const saved =
        (state.checkoutAddresses || [])
          .find(
            (item) =>
              item.id ===
              values.savedAddressId
          );

      if (!saved) {
        throw new Error(
          "Choose a saved address."
        );
      }

      if (
        !String(
          saved.local_area || ""
        ).trim()
      ) {
        throw new Error(
          "This saved address needs an area or suburb. Choose New address and enter the complete address."
        );
      }

      address = {
        streetAddress:
          saved.street_address,
        localArea:
          saved.local_area,
        city:
          saved.city,
        province:
          saved.province,
        postalCode:
          saved.postal_code,
        country:
          saved.country_code || "ZA"
      };

      contact = {
        fullName:
          saved.recipient_name,
        phone:
          saved.phone ||
          state.session.user
            .user_metadata?.phone ||
          "",
        email:
          state.session.user.email
      };

      if (!contact.phone) {
        throw new Error(
          "Add a phone number to this saved address."
        );
      }

    } else {

      for (
        const key of [
          "fullName",
          "phone",
          "streetAddress",
          "localArea",
          "city",
          "province",
          "postalCode"
        ]
      ) {
        if (
          !String(
            values[key] || ""
          ).trim()
        ) {
          throw new Error(
            "Complete all delivery details, including the area or suburb."
          );
        }
      }

      address = {
        streetAddress:
          values.streetAddress.trim(),
        localArea:
          values.localArea.trim(),
        city:
          values.city.trim(),
        province:
          values.province,
        postalCode:
          values.postalCode.trim(),
        country:
          "ZA"
      };

      contact = {
        fullName:
          values.fullName.trim(),
        phone:
          values.phone.trim(),
        email:
          state.session.user.email
      };

      if (
        values.saveNewAddress === "on"
      ) {

        const label =
          String(
            values.addressLabel || ""
          ).trim();

        if (!label) {
          throw new Error(
            "Give the saved address a label."
          );
        }

        const { error: saveError } =
          await supabase
            .from("addresses")
            .insert({
              customer_id:
                state.session.user.id,
              label,
              recipient_name:
                contact.fullName,
              phone:
                contact.phone,
              street_address:
                address.streetAddress,
              local_area:
                address.localArea,
              city:
                address.city,
              province:
                address.province,
              postal_code:
                address.postalCode,
              country_code:
                "ZA",
              is_default:
                (
                  state.checkoutAddresses ||
                  []
                ).length === 0
            });

        if (saveError) {
          throw saveError;
        }
      }
    }

    const lines =
      state.cart.map(
        ({
          productId,
          quantity,
          size,
          colour
        }) => ({
          productId,
          quantity,
          size,
          colour
        })
      );

    const headers = {
      "Content-Type":
        "application/json",
      ...(await authHeader())
    };

    const quoteResponse =
      await fetch(
        `${CONFIG.functionsBase}/shipping-quote`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            lines,
            address,
            contact
          })
        }
      );

    const quoteData =
      await quoteResponse.json();

    if (!quoteResponse.ok) {
      throw new Error(
        quoteData.error ||
        "Delivery could not be quoted."
      );
    }

    const quotes =
      Array.isArray(quoteData.quotes)
        ? quoteData.quotes
        : [];

    if (!quotes.length) {
      throw new Error(
        "No delivery quote was returned."
      );
    }

    const rows =
      cartRows();

    const subtotal =
      rows.reduce(
        (sum, line) =>
          sum +
          Number(line.unitPriceCents) *
          Number(line.quantity),
        0
      );

    const courierDelivery =
      quotes.reduce(
        (sum, quote) =>
          sum +
          Number(
            quote.courierCostCents ??
            quote.amountCents ??
            0
          ),
        0
      );

    const logisticsFulfilment =
      quotes.reduce(
        (sum, quote) =>
          sum +
          Math.max(
            0,
            Number(
              quote.logisticsFeeCents ??
              0
            )
          ),
        0
      );

    const totalDelivery =
      quotes.reduce(
        (sum, quote) =>
          sum +
          Number(
            quote.amountCents || 0
          ),
        0
      );

    const totalDue =
      subtotal +
      totalDelivery;

    pendingCheckoutReview = {
      lines,
      address,
      contact,
      quotes,
      subtotal,
      totalDelivery
    };

    const courierLines =
      quotes
        .map(
          (quote) => {

            const cutoff =
              String(
                quote.collectionCutoffTime ||
                ""
              ).slice(0, 5);

            return `
              <div class="checkout-courier-service">

                <strong>
                  ${escapeHtml(
                    quote.storeName ||
                    "Store delivery"
                  )}
                </strong>

                <small>
                  ${escapeHtml(
                    quote.courierName ||
                    "Courier"
                  )}
                  ·
                  ${escapeHtml(
                    quote.serviceName ||
                    "Door-to-door delivery"
                  )}

                </small>

              </div>
            `;
          }
        )
        .join("");

    formElement.hidden = true;

    const summary =
      document.querySelector(
        "#checkout-summary"
      );

    summary.innerHTML = `
      <p class="eyebrow">
        ORDER REVIEW
      </p>

      <h2>Check before payment</h2>

      ${
        rows
          .map(
            (line) => `
              <div class="summary-line">
                <span>
                  ${line.quantity}
                  ×
                  ${escapeHtml(
                    line.product.name
                  )}
                </span>

                <strong>
                  ${
                    money(
                      Number(
                        line.quantity
                      ) *
                      Number(
                        line.unitPriceCents
                      )
                    )
                  }
                </strong>
              </div>
            `
          )
          .join("")
      }

      <div class="checkout-review-divider"></div>

      <div class="summary-line delivery-breakdown-muted">
        <span>Courier delivery</span>
        <span>${money(courierDelivery)}</span>
      </div>

      <div class="summary-line delivery-breakdown-muted">
        <span>Logistics & fulfilment</span>
        <span>${money(logisticsFulfilment)}</span>
      </div>

      <div class="summary-line delivery-total-row">
        <span>Total delivery</span>
        <strong>${money(totalDelivery)}</strong>
      </div>

      <div class="summary-line checkout-total-due">
        <span>Total due</span>
        <strong>${money(totalDue)}</strong>
      </div>

      <div class="checkout-courier-list">
        ${courierLines}
      </div>

      <button
        class="primary-button checkout-payment-button"
        id="continue-secure-payment"
        type="button"
      >
        Continue to secure payment
      </button>

      <button
        class="quiet-button checkout-change-button"
        id="change-delivery-details"
        type="button"
      >
        Change delivery details
      </button>

      <p
        class="form-message"
        id="payment-review-message"
        aria-live="polite"
      ></p>

      <p class="checkout-review-note">
        <small>
          You will be redirected to Paystack only after you continue.
          Delivery quotes can expire, so complete payment shortly after reviewing the order.
        </small>
      </p>
    `;

    document
      .querySelector(
        "#continue-secure-payment"
      )
      .addEventListener(
        "click",
        continueCheckoutToPayment
      );

    document
      .querySelector(
        "#change-delivery-details"
      )
      .addEventListener(
        "click",
        () => renderCheckout()
      );

  } catch (error) {

    message.textContent =
      error.message;

    button.disabled = false;
    button.textContent =
      "Get delivery quote";
  }
}


async function continueCheckoutToPayment() {

  const pending =
    pendingCheckoutReview;

  const button =
    document.querySelector(
      "#continue-secure-payment"
    );

  const message =
    document.querySelector(
      "#payment-review-message"
    );

  if (!pending) {
    if (message) {
      message.textContent =
        "Request a new delivery quote first.";
    }
    return;
  }

  button.disabled = true;
  button.textContent =
    "Opening secure payment…";

  if (message) {
    message.textContent = "";
  }

  try {

    const headers = {
      "Content-Type":
        "application/json",
      ...(await authHeader())
    };

    const checkoutResponse =
      await fetch(
        `${CONFIG.functionsBase}/create-checkout`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            lines:
              pending.lines,
            address:
              pending.address,
            contact:
              pending.contact,
            quotes:
              pending.quotes
          })
        }
      );

    const checkout =
      await checkoutResponse.json();

    if (!checkoutResponse.ok) {
      throw new Error(
        checkout.error ||
        "Checkout could not be started."
      );
    }

    if (!checkout.authorizationUrl) {
      throw new Error(
        "Secure payment link was not returned."
      );
    }

    location.href =
      checkout.authorizationUrl;

  } catch (error) {

    if (message) {
      message.textContent =
        error.message;
    }

    button.disabled = false;
    button.textContent =
      "Continue to secure payment";
  }
}

/* 05. CUSTOMER ACCOUNT                                                       */
/* ========================================================================== */

async function renderAccount() {
  if (!state.session) {
    location.href =
      loginPath("/account");

    return;
  }

  const name =
    state.session.user.user_metadata?.full_name ||
    state.session.user.email;

  app.innerHTML = `
    <section class="account-layout">

      <nav class="account-nav glass">
        <button
          class="active"
          data-account-view="overview"
        >
          Overview
        </button>

        <button data-account-view="orders">
          Orders
        </button>

        <button data-account-view="addresses">
          Addresses
        </button>

        <button data-account-view="returns">
          Returns
        </button>

        <button data-account-view="signout">
          Sign out
        </button>
      </nav>

      <div
        class="account-panel glass"
        id="account-panel"
      >
        <p class="eyebrow">
          YOUR ACCOUNT
        </p>

        <h1>
          Hello,
          ${escapeHtml(name.split(" ")[0])}.
        </h1>

        <p>
          Your orders, saved details and
          after-sales requests live here.
        </p>
      </div>

    </section>
  `;

  document
    .querySelectorAll("[data-account-view]")
    .forEach((button) => {
      button.addEventListener(
        "click",
        () =>
          renderAccountView(
            button.dataset.accountView,
            button
          )
      );
    });

  document
    .querySelector("#account-panel")
    .addEventListener(
      "click",
      handleAccountAction
    );
}

async function renderAccountView(
  view,
  button
) {
  if (view === "signout") {
    await supabase.auth.signOut();

    location.href =
      homePath();

    return;
  }

  document
    .querySelectorAll("[data-account-view]")
    .forEach((item) =>
      item.classList.toggle(
        "active",
        item === button
      )
    );

  const panel =
    document.querySelector("#account-panel");

  panel.innerHTML = `
    <section class="loading-state">
      <span class="loading-orbit"></span>
    </section>
  `;

  if (!supabase) {
    panel.innerHTML = `
      <h1>Connect the database.</h1>

      <p>
        Account records become available after
        config.js is connected to Supabase.
      </p>
    `;

    return;
  }

  if (view === "overview") {
    panel.innerHTML = `
      <p class="eyebrow">
        YOUR ACCOUNT
      </p>

      <h1>
        ${
          escapeHtml(
            state.session.user.user_metadata?.full_name ||
            "Your nation"
          )
        }
      </h1>

      <p>
        ${escapeHtml(state.session.user.email)}
      </p>

      <p>
        Use the sections beside this panel to
        follow orders, manage two delivery
        addresses and submit eligible return
        requests.
      </p>
    `;

    return;
  }

  if (view === "orders") {
    const { data, error } =
      await supabase
        .from("vendor_orders")
        .select(
          "id,public_reference,fulfilment_status,merchandise_total_cents,shipping_charge_cents,created_at,orders!inner(customer_id),vendors(business_name)"
        )
        .eq(
          "orders.customer_id",
          state.session.user.id
        )
        .order(
          "created_at",
          { ascending: false }
        );

    if (error) {
      throw error;
    }

    panel.innerHTML = `
      <p class="eyebrow">
        ORDER HISTORY
      </p>

      <h1>Your packages.</h1>

      ${
        data.length
          ? data.map((order) => {
              const vendor =
                Array.isArray(order.vendors)
                  ? order.vendors[0]
                  : order.vendors;

              const canCancel =
                ["new", "accepted"]
                  .includes(
                    order.fulfilment_status
                  );

              const canReturn =
                order.fulfilment_status ===
                "delivered";

              return `
                <article class="order-card">
                  <div>
                    <strong>
                      ${publicReference(order.public_reference)}
                    </strong>

                    <p>
                      ${escapeHtml(vendor?.business_name || "Store")}
                      ·
                      ${
                        new Date(order.created_at)
                          .toLocaleDateString(CONFIG.locale)
                      }
                      ·
                      ${
                        money(
                          Number(order.merchandise_total_cents) +
                          Number(order.shipping_charge_cents)
                        )
                      }
                    </p>

                    ${
                      canCancel
                        ? `
                          <button
                            class="table-action"
                            data-request-cancellation="${order.id}"
                          >
                            Request cancellation
                          </button>
                        `
                        : ""
                    }

                    ${
                      canReturn
                        ? `
                          <button
                            class="table-action"
                            data-request-return="${order.id}"
                          >
                            Request return
                          </button>
                        `
                        : ""
                    }
                  </div>

                  <span class="status-pill">
                    ${
                      escapeHtml(
                        order.fulfilment_status
                          .replaceAll("_", " ")
                      )
                    }
                  </span>
                </article>
              `;
            }).join("")
          : `
            <p>
              No orders have been placed
              from this account yet.
            </p>
          `
      }
    `;

    return;
  }

  if (view === "addresses") {
    const { data, error } =
      await supabase
        .from("addresses")
        .select("*")
        .order("created_at");

    if (error) {
      throw error;
    }

    panel.innerHTML = `
      <p class="eyebrow">
        DELIVERY DETAILS
      </p>

      <h1>
        Saved addresses.
      </h1>

      ${
        data.length
          ? data.map((address) => `
              <article class="order-card">

                <div>
                  <strong>
                    ${escapeHtml(address.label)}
                  </strong>

                  <p>
                    ${escapeHtml(address.recipient_name)}
                    <br>

                    ${escapeHtml(address.street_address)},<br>
                ${
                  address.local_area
                    ? `${escapeHtml(address.local_area)}, `
                    : ""
                }
                ${escapeHtml(address.city)},
                ${escapeHtml(address.postal_code)}
                  </p>

                  <div class="line-controls">

                    <button
                      type="button"
                      class="table-action"
                      data-edit-address="${address.id}"
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      class="table-action"
                      data-delete-address="${address.id}"
                    >
                      Delete
                    </button>

                  </div>
                </div>

                <span class="status-pill">
                  ${
                    address.is_default
                      ? "Default"
                      : "Saved"
                  }
                </span>

              </article>
            `).join("")
          : `
            <p>
              No delivery addresses have been
              saved yet.
            </p>
          `
      }

      <form
        class="stack-form"
        id="address-form"
      >

        <input
          type="hidden"
          name="address_id"
        >

        <h2 id="address-form-title">
          Add an address
        </h2>

        <div class="form-grid">

          <label>
            Label

            <input
              name="label"
              placeholder="Home"
              required
            >
          </label>

          <label>
            Recipient

            <input
              name="recipient_name"
              required
            >
          </label>

        </div>

        <label>
          Street address

          <input
            name="street_address"
            required
          >
        </label>

        <!-- CUSTOMER_ADDRESS_LOCAL_AREA_V1 -->
        <label>
          Area / suburb
          <input
            name="local_area"
            autocomplete="address-level3"
            required
          >
        </label>


        <div class="form-grid">

          <label>
            City

            <input
              name="city"
              required
            >
          </label>

          <label>
            Postal code

            <input
              name="postal_code"
              required
            >
          </label>

        </div>

        <label>
          Province

          <input
            name="province"
            value="Limpopo"
            required
          >
        </label>

        <button
          class="primary-button"
          id="address-save-button"
          type="submit"
        >
          Save address
        </button>

        <button
          class="quiet-button"
          id="address-cancel-edit"
          type="button"
          hidden
        >
          Cancel edit
        </button>

        <p class="form-message"></p>

      </form>
    `;

    document
      .querySelector("#address-form")
      .addEventListener(
        "submit",
        saveAddress
      );

    return;
  }

  if (view === "returns") {
    const { data, error } =
      await supabase
        .from("returns")
        .select(
          "public_reference,reason,status,refund_amount_cents,requested_at"
        )
        .order(
          "requested_at",
          { ascending: false }
        );

    if (error) {
      throw error;
    }

    panel.innerHTML = `
      <p class="eyebrow">
        AFTER-SALES
      </p>

      <h1>Returns.</h1>

      ${
        data.length
          ? data.map((item) => `
              <article class="order-card">
                <div>
                  <strong>
                    ${publicReference(item.public_reference)}
                  </strong>

                  <p>
                    ${
                      escapeHtml(
                        item.reason.replaceAll("_", " ")
                      )
                    }
                    ·
                    ${money(item.refund_amount_cents)}
                  </p>
                </div>

                <span class="status-pill">
                  ${
                    escapeHtml(
                      item.status.replaceAll("_", " ")
                    )
                  }
                </span>
              </article>
            `).join("")
          : `
            <p>
              No return requests are attached
              to this account.
            </p>
          `
      }

      <p>
        <small>
          Start a return from an eligible
          delivered order. The full workflow
          activates with live order data.
        </small>
      </p>
    `;
  }
}

async function handleAccountAction(event) {
  const editAddressButton =
    event.target.closest(
      "[data-edit-address]"
    );

  if (editAddressButton) {
    const addressId =
      editAddressButton.dataset.editAddress;

    const {
      data: address,
      error
    } = await supabase
      .from("addresses")
      .select("*")
      .eq("id", addressId)
      .eq(
        "customer_id",
        state.session.user.id
      )
      .single();

    if (error) {
      showToast(error.message);
      return;
    }

    const form =
      document.querySelector("#address-form");

    if (!form) {
      return;
    }

    form.elements.address_id.value =
      address.id;

    form.elements.label.value =
      address.label || "";

    form.elements.recipient_name.value =
      address.recipient_name || "";

    form.elements.street_address.value =
      address.street_address || "";

        form.elements.local_area.value = address.local_area || "";
    form.elements.city.value =
      address.city || "";

    form.elements.postal_code.value =
      address.postal_code || "";

    form.elements.province.value =
      address.province || "Limpopo";

    document
      .querySelector("#address-form-title")
      .textContent =
        "Edit address";

    document
      .querySelector("#address-save-button")
      .textContent =
        "Save changes";

    document
      .querySelector("#address-cancel-edit")
      .hidden =
        false;

    form.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });

    return;
  }

  const deleteAddressButton =
    event.target.closest(
      "[data-delete-address]"
    );

  if (deleteAddressButton) {
    const addressId =
      deleteAddressButton.dataset.deleteAddress;

    if (
      !window.confirm(
        "Delete this saved address?"
      )
    ) {
      return;
    }

    const { error } =
      await supabase
        .from("addresses")
        .delete()
        .eq("id", addressId)
        .eq(
          "customer_id",
          state.session.user.id
        );

    if (error) {
      showToast(error.message);
      return;
    }

    showToast(
      "Address deleted."
    );

    return renderAccountView(
      "addresses",
      document.querySelector(
        '[data-account-view="addresses"]'
      )
    );
  }

  const cancelEditButton =
    event.target.closest(
      "#address-cancel-edit"
    );

  if (cancelEditButton) {
    const form =
      document.querySelector("#address-form");

    if (!form) {
      return;
    }

    form.reset();

    form.elements.address_id.value =
      "";

    form.elements.province.value =
      "Limpopo";

    document
      .querySelector("#address-form-title")
      .textContent =
        "Add an address";

    document
      .querySelector("#address-save-button")
      .textContent =
        "Save address";

    cancelEditButton.hidden =
      true;

    return;
  }

  const cancellation =
    event.target.closest(
      "[data-request-cancellation]"
    );

  if (cancellation) {
    const reason =
      window.prompt(
        "Why would you like to cancel this package?"
      );

    if (!reason?.trim()) {
      return;
    }

    const { error } =
      await supabase.rpc(
        "request_order_cancellation",
        {
          p_vendor_order_id:
            cancellation.dataset.requestCancellation,

          p_reason:
            reason.trim()
        }
      );

    if (error) {
      return showToast(
        error.message
      );
    }

    showToast(
      "Cancellation request submitted."
    );

    return renderAccountView(
      "orders",
      document.querySelector(
        '[data-account-view="orders"]'
      )
    );
  }

  const returnButton =
    event.target.closest(
      "[data-request-return]"
    );

  if (returnButton) {
    const reason =
      window.prompt(
        "What is the reason for this return?"
      );

    if (!reason?.trim()) {
      return;
    }

    const note =
      window.prompt(
        "Add any details that will help the store review the item."
      ) || "";

    const { error } =
      await supabase.rpc(
        "request_return",
        {
          p_vendor_order_id:
            returnButton.dataset.requestReturn,

          p_reason:
            reason.trim(),

          p_note:
            note.trim()
        }
      );

    if (error) {
      return showToast(
        error.message
      );
    }

    showToast(
      "Return request submitted."
    );

    return renderAccountView(
      "returns",
      document.querySelector(
        '[data-account-view="returns"]'
      )
    );
  }
}

async function saveAddress(event) {
  event.preventDefault();

  const form =
    event.currentTarget;

  const message =
    form.querySelector(".form-message");

  message.textContent = "";

  const values =
    Object.fromEntries(
      new FormData(form)
    );

  const addressId =
    values.address_id || "";

  delete values.address_id;

  if (addressId) {
    const { error } =
      await supabase
        .from("addresses")
        .update({
          label:
            values.label.trim(),

          recipient_name:
            values.recipient_name.trim(),

          street_address: values.street_address.trim(),
        local_area: values.local_area.trim(),

          city:
            values.city.trim(),

          postal_code:
            values.postal_code.trim(),

          province:
            values.province.trim()
        })
        .eq(
          "id",
          addressId
        )
        .eq(
          "customer_id",
          state.session.user.id
        );

    if (error) {
      message.textContent =
        error.message;

      return;
    }

    showToast(
      "Address updated."
    );

  } else {
    const { error } =
      await supabase
        .from("addresses")
        .insert({
          label:
            values.label.trim(),

          recipient_name:
            values.recipient_name.trim(),

          street_address: values.street_address.trim(),
        local_area: values.local_area.trim(),

          city:
            values.city.trim(),

          postal_code:
            values.postal_code.trim(),

          province:
            values.province.trim(),

          customer_id:
            state.session.user.id,

          country_code:
            "ZA"
        });

    if (error) {
      message.textContent =
        error.message;

      return;
    }

    showToast(
      "Address saved."
    );
  }

  return renderAccountView(
    "addresses",
    document.querySelector(
      '[data-account-view="addresses"]'
    )
  );
}

/* ========================================================================== */
/* 06. WISHLIST, PAYMENT RETURN AND ERROR PAGES                               */
/* ========================================================================== */

function renderWishlist() {
  const products =
    state.products.filter(
      (product) =>
        state.wishlist.includes(product.id)
    );

  app.innerHTML = `
    <section class="page-hero">
      <div>
        <p class="eyebrow">
          SAVED FOR LATER
        </p>

        <h1>Your shortlist.</h1>

        <p>
          Keep an eye on the pieces you want before
          a limited run moves on.
        </p>
      </div>
    </section>

    <section class="catalogue-section">
      ${productGrid(products)}
    </section>
  `;
}

function renderPaymentResult(success) {
  if (success) {
    state.cart = [];
    saveCommerceState();
  }

  app.innerHTML = `
    <section class="empty-state glass">
      <span>
        ${success ? "✓" : "◇"}
      </span>

      <h1>
        ${
          success
            ? "Payment received for verification."
            : "Payment was not completed."
        }
      </h1>

      <p>
        ${
          success
            ? "Your account will show the order as paid only after Kompo Nation receives and verifies Paystack's payment confirmation."
            : "Your bag is still available when you are ready to try again."
        }
      </p>

      <a
        class="primary-button"
        href="${success ? "/account" : "/cart"}"
      >
        ${
          success
            ? "View account"
            : "Return to bag"
        }
      </a>
    </section>
  `;
}

function renderNotFound() {
  app.innerHTML = `
    <section class="empty-state glass">
      <span>404</span>

      <h1>
        This path has gone quiet.
      </h1>

      <p>
        Return to the nation and keep exploring.
      </p>

      <a
        class="primary-button"
        href="/"
      >
        Go home
      </a>
    </section>
  `;
}

/* ========================================================================== */
/* 07. GLOBAL INTERACTION HANDLERS                                            */
/* ========================================================================== */

async function toggleWishlist(productId) {
  if (state.session && supabase) {
    const isSaved =
      await toggleRemoteWishlist(
        productId
      );

    state.wishlist =
      isSaved
        ? [
            ...new Set([
              ...state.wishlist,
              productId
            ])
          ]
        : state.wishlist.filter(
            (id) =>
              id !== productId
          );

  } else {
    state.wishlist =
      state.wishlist.includes(productId)
        ? state.wishlist.filter(
            (id) =>
              id !== productId
          )
        : [
            ...state.wishlist,
            productId
          ];
  }

  saveCommerceState();

  document
    .querySelectorAll(
      `[data-wish="${CSS.escape(productId)}"]`
    )
    .forEach((button) => {
      button.classList.toggle(
        "active",
        state.wishlist.includes(productId)
      );

      button.textContent =
        state.wishlist.includes(productId)
          ? "Saved"
          : "♡";
    });
}

function changeLine(key, delta) {
  const [productId, size, colour] = key.split("|");

  const line = state.cart.find(
    (item) =>
      item.productId === productId &&
      item.size === size &&
      item.colour === colour
  );

  const product = state.products.find(
    (item) => item.id === productId
  );

  const variant = product
    ? selectedVariant(product, size, colour)
    : null;

  if (!line || !variant) return;

  if (delta > 0 && line.quantity >= Number(variant.stock)) {
    showToast(
      `Only ${variant.stock} of this option ${Number(variant.stock) === 1 ? "is" : "are"} available.`
    );
    return;
  }

  line.quantity = Math.max(
    1,
    Math.min(Number(variant.stock), line.quantity + delta)
  );

  saveCommerceState();
  renderCart();
}


function setupHeader() {
  document
    .querySelector("#year")
    .textContent =
      new Date().getFullYear();

  document
    .querySelector("#menu-button")
    .addEventListener(
      "click",
      (event) => {
        const nav =
          document.querySelector(".main-nav");

        nav.classList.toggle("open");

        event.currentTarget.setAttribute(
          "aria-expanded",
          String(
            nav.classList.contains("open")
          )
        );
      }
    );

  const dialog =
    document.querySelector("#search-dialog");

  document
    .querySelector("#search-button")
    .addEventListener(
      "click",
      () => {
        dialog.showModal();

        setTimeout(
          () =>
            document
              .querySelector("#global-search")
              .focus(),
          50
        );
      }
    );

  document
    .querySelector("#global-search")
    .addEventListener(
      "input",
      (event) => {
        const query =
          event.target.value
            .trim()
            .toLowerCase();

        const products =
          query
            ? state.products
                .filter((product) =>
                  `${
                    product.name
                  } ${
                    product.category
                  } ${
                    storeFor(product)?.name
                  }`
                    .toLowerCase()
                    .includes(query)
                )
                .slice(0, 7)
            : [];

        document
          .querySelector("#search-results")
          .innerHTML =
            products.map((product) => `
              <a
                class="search-result"
                href="/product/${encodeURIComponent(product.slug)}"
              >
                <span>
                  ${
                    escapeHtml(
                      storeFor(product)?.mark ||
                      "KN"
                    )
                  }
                </span>

                <span>
                  <strong>
                    ${escapeHtml(product.name)}
                  </strong>

                  <br>

                  <small>
                    ${
                      escapeHtml(
                        storeFor(product)?.name
                      )
                    }
                  </small>
                </span>

                <strong>
                  ${money(product.priceCents)}
                </strong>
              </a>
            `).join("");
      }
    );

  document
    .querySelector("#newsletter-form")
    .addEventListener(
      "submit",
      async (event) => {
        event.preventDefault();

        const email =
          document
            .querySelector("#newsletter-email")
            .value
            .trim()
            .toLowerCase();

        if (!supabase) {
          return showToast(
            "Newsletter signup activates when Supabase is connected."
          );
        }

        const { error } =
          await supabase.rpc(
            "subscribe_newsletter",
            {
              p_email: email
            }
          );

        showToast(
          error
            ? error.message
            : "You are on the list."
        );

        if (!error) {
          event.currentTarget.reset();
        }
      }
    );
}

function setupDelegatedEvents() {
  document.addEventListener(
    "click",
    (event) => {
      const wish =
        event.target.closest(
          "[data-wish]"
        );

      if (wish) {
        event.preventDefault();

        toggleWishlist(
          wish.dataset.wish
        ).catch(
          (error) =>
            showToast(error.message)
        );

        return;
      }

      const quantity =
        event.target.closest(
          "[data-quantity]"
        );

      if (quantity) {
        changeLine(
          quantity.dataset.line,
          Number(
            quantity.dataset.quantity
          )
        );

        return;
      }

      const remove =
        event.target.closest(
          "[data-remove-line]"
        );

      if (remove) {
        const [
          productId,
          size,
          colour
        ] =
          remove.dataset.removeLine
            .split("|");

        state.cart =
          state.cart.filter(
            (line) =>
              !(
                line.productId === productId &&
                line.size === size &&
                line.colour === colour
              )
          );

        saveCommerceState();

        renderCart();

        return;
      }

      const localLink =
        isLocalFile
          ? event.target.closest(
              'a[href^="/"]'
            )
          : null;

      if (
        localLink &&
        !event.defaultPrevented
      ) {
        event.preventDefault();

        location.hash =
          localLink.getAttribute(
            "href"
          );
      }
    }
  );
}

/* ========================================================================== */
/* 08. ROUTER AND STARTUP                                                     */
/* ========================================================================== */

async function renderRoute() {
  const { path } =
    currentRoute();

  if (path === "/") {
    return renderHome();
  }

  if (path === "/shop") {
    return renderShop();
  }

  if (path === "/stores") {
    return renderStores();
  }

  if (path.startsWith("/store/")) {
    return renderStore();
  }

  if (path.startsWith("/product/")) {
    return renderProduct();
  }

  if (path === "/cart") {
    return renderCart();
  }

  if (path === "/checkout") {
    return renderCheckout();
  }

  if (path === "/wishlist") {
    return renderWishlist();
  }

  if (path === "/account") {
    return renderAccount();
  }

  if (path === "/about") {
    return renderAbout();
  }

  if (
    [
      "/delivery",
      "/returns",
      "/contact",
      "/privacy",
      "/terms"
    ].includes(path)
  ) {
    return renderInformation(
      path.slice(1)
    );
  }

  if (path === "/payment-success") {
    return renderPaymentResult(true);
  }

  if (path === "/payment-cancelled") {
    return renderPaymentResult(false);
  }

  renderNotFound();
}

async function start() {
  setupHeader();

  setupDelegatedEvents();

  updateCounts();

  state.session =
    await getSession();

  if (state.session) {
    document
      .querySelector("#account-link")
      .textContent =
        "Account";

    try {
      state.wishlist =
        await loadWishlist(
          state.session.user.id
        );

    } catch (error) {
      console.warn(
        "Wishlist could not be loaded",
        error
      );
    }

  } else {
    document
      .querySelector("#account-link")
      .textContent =
        "Sign in";
  }

  if (isSupabaseConfigured()) {
    try {
      const catalogue =
        await loadRemoteCatalogue();

      if (catalogue?.stores.length) {
        state.stores =
          catalogue.stores;
      }

      if (catalogue?.products.length) {
        state.products =
          catalogue.products;
      }

    } catch (error) {
      console.warn(
        "Remote catalogue is unavailable; retained catalogue is being shown.",
        error
      );
    }
  }

  updateCounts();

  if (isLocalFile) {
    window.addEventListener(
      "hashchange",
      () => {
        renderRoute()
          .then(() => {
            window.scrollTo({
              top: 0,
              behavior: "smooth"
            });

            document
              .querySelector("#app")
              ?.focus({
                preventScroll: true
              });
          })
          .catch(
            (error) =>
              showToast(error.message)
          );
      }
    );
  }

  await renderRoute();
}

start().catch((error) => {
  console.error(error);

  app.innerHTML = `
    <section class="empty-state glass">
      <span>!</span>

      <h1>
        The page could not open.
      </h1>

      <p>
        ${escapeHtml(error.message)}
      </p>

      <button
        class="primary-button"
        onclick="location.reload()"
      >
        Try again
      </button>
    </section>
  `;
});

})();
