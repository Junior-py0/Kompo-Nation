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
  appliedDiscount: null,
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

function setMeta(title, description, options = {}) {
  const pageTitle =
    String(title || "").trim();

  document.title =
    !pageTitle
    || pageTitle === "Home"
    || pageTitle === "Kompo Nation"
      ? "Kompo Nation | Independent South African Fashion"
      : `${pageTitle} | Kompo Nation`;

  const upsertMeta = (selector, attributes) => {
    let tag = document.querySelector(selector);
    if (!tag) {
      tag = document.createElement("meta");
      document.head.append(tag);
    }
    Object.entries(attributes).forEach(([name, value]) => tag.setAttribute(name, value));
  };

  const routePath = currentRoute().path;
  const canonicalUrl = `${CONFIG.siteUrl}${routePath === "/" ? "/" : routePath}`;
  const imageUrl = new URL(options.image || "/assets/campaign-kompo-apparel-v2.png", CONFIG.siteUrl).href;
  const robots = options.robots || "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";
  const fullTitle = document.title;

  upsertMeta('meta[name="description"]', { name: "description", content: description });
  upsertMeta('meta[name="robots"]', { name: "robots", content: robots });
  upsertMeta('meta[property="og:title"]', { property: "og:title", content: fullTitle });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
  upsertMeta('meta[property="og:type"]', { property: "og:type", content: options.type || "website" });
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonicalUrl });
  upsertMeta('meta[property="og:image"]', { property: "og:image", content: imageUrl });
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary_large_image" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: fullTitle });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
  upsertMeta('meta[name="twitter:image"]', { name: "twitter:image", content: imageUrl });

  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.append(canonical);
  }
  canonical.href = canonicalUrl;
}

function setStructuredData(data) {
  let script = document.querySelector("#kompo-structured-data");
  if (!script) {
    script = document.createElement("script");
    script.id = "kompo-structured-data";
    script.type = "application/ld+json";
    document.head.append(script);
  }
  script.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
}

function storeSearchAliases(store) {
  const compact = `${store?.name || ""} ${store?.slug || ""}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return compact.includes("letwosix") || compact.includes("le26")
    ? ["Le Two Six", "Le 26"]
    : [];
}

function productStructuredData(product, store) {
  const canonical = `${CONFIG.siteUrl}/product/${encodeURIComponent(product.slug)}`;
  const aliases = storeSearchAliases(store);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    "@id": `${canonical}#product`,
    name: product.name,
    description: product.description,
    category: product.category,
    url: canonical,
    image: productImages(product).map((image) => new URL(image.url, CONFIG.siteUrl).href),
    sku: productVariants(product)[0]?.sku,
    brand: {
      "@type": "Brand",
      name: store?.name || "Kompo Nation",
      ...(aliases.length ? { alternateName: aliases } : {}),
    },
    offers: productVariants(product).map((variant) => ({
      "@type": "Offer",
      url: canonical,
      priceCurrency: CONFIG.currency,
      price: (Number(variant.priceCents) / 100).toFixed(2),
      availability: Number(variant.stock) > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      itemCondition: "https://schema.org/NewCondition",
      sku: variant.sku,
      seller: { "@type": "Organization", name: store?.name || "Kompo Nation" },
    })),
  };
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
  state.appliedDiscount = null;

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

function productImages(product) {
  const seen = new Set();
  const images = (Array.isArray(product.images) ? product.images : [])
    .map((item, index) => typeof item === "string"
      ? { url: item, alt: product.name, sortOrder: index }
      : {
          url: item?.url || item?.public_url || "",
          alt: item?.alt || item?.alt_text || product.name,
          sortOrder: Number(item?.sortOrder ?? item?.sort_order ?? index),
        })
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((left, right) => left.sortOrder - right.sortOrder);

  if (!images.length && product.imageUrl) {
    images.push({ url: product.imageUrl, alt: product.name, sortOrder: 0 });
  }

  return images;
}

function productBadges(product) {
  return `<div class="product-badges">
    ${product.isRare ? "<span>LIMITED</span>" : "<span>IN THE MOVEMENT</span>"}
    <span>${product.stock} LEFT</span>
  </div>`;
}

function productVisual(product) {
  const images = productImages(product);
  const media = images.length
    ? `<div class="product-media-slides">
        ${images.map((image, index) => `<img
          class="product-media-slide ${index === 0 ? "is-active" : ""}"
          data-product-slide
          src="${escapeHtml(image.url)}"
          alt="${escapeHtml(image.alt || product.name)}"
          loading="lazy"
          decoding="async"
          draggable="false"
          aria-hidden="${index === 0 ? "false" : "true"}"
        >`).join("")}
      </div>`
    : `<span class="garment-shape" aria-hidden="true"></span>`;

  return `
    <div
      class="product-visual"
      style="--product-tone:${tone(product.tone)}"
      ${images.length > 1 ? `data-product-carousel data-next-rotation="${Date.now() + 2600}" aria-label="${escapeHtml(product.name)} · ${images.length} photos"` : ""}
    >
      ${media}
      ${productBadges(product)}
      ${images.length > 1 ? `<span class="product-media-count" data-product-count>1 / ${images.length}</span>` : ""}
      <button
        class="wish-button ${state.wishlist.includes(product.id) ? "active" : ""}"
        data-wish="${product.id}"
        aria-label="Save ${escapeHtml(product.name)}"
      >♡</button>
    </div>
  `;
}

function productGallery(product) {
  const images = productImages(product);

  if (!images.length) {
    return `<div class="product-gallery">
      <div class="product-gallery-stage product-detail-visual" style="--product-tone:${tone(product.tone)}">
        <span class="garment-shape" aria-hidden="true"></span>
        ${productBadges(product)}
      </div>
    </div>`;
  }

  const hasMultiple = images.length > 1;
  return `<div class="product-gallery" data-product-gallery>
    <div class="product-gallery-stage product-detail-visual" tabindex="${hasMultiple ? "0" : "-1"}" aria-label="${escapeHtml(product.name)} product photos">
      <img
        data-gallery-main
        src="${escapeHtml(images[0].url)}"
        alt="${escapeHtml(images[0].alt || product.name)}"
        draggable="false"
      >
      ${productBadges(product)}
      ${hasMultiple ? `
        <button class="gallery-arrow gallery-arrow-previous" type="button" data-gallery-step="-1" aria-label="Previous product photo">‹</button>
        <button class="gallery-arrow gallery-arrow-next" type="button" data-gallery-step="1" aria-label="Next product photo">›</button>
        <span class="gallery-count" data-gallery-count>1 / ${images.length}</span>
      ` : ""}
    </div>
    ${hasMultiple ? `<div class="product-gallery-thumbnails" aria-label="Choose a product photo">
      ${images.map((image, index) => `<button
        class="product-gallery-thumbnail ${index === 0 ? "is-active" : ""}"
        type="button"
        data-gallery-index="${index}"
        aria-label="Show photo ${index + 1} of ${images.length}"
        aria-current="${index === 0 ? "true" : "false"}"
      ><img src="${escapeHtml(image.url)}" alt="" loading="lazy" draggable="false"></button>`).join("")}
    </div>` : ""}
  </div>`;
}

function setupProductCardRotation() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  window.setInterval(() => {
    if (document.hidden) return;
    const now = Date.now();

    document.querySelectorAll("[data-product-carousel]").forEach((carousel, cardIndex) => {
      const slides = [...carousel.querySelectorAll("[data-product-slide]")];
      if (slides.length < 2 || now < Number(carousel.dataset.nextRotation || 0)) return;

      const bounds = carousel.getBoundingClientRect();
      const isVisible = bounds.bottom > 0 && bounds.top < window.innerHeight && bounds.right > 0 && bounds.left < window.innerWidth;
      const isPaused = carousel.matches(":hover") || carousel.contains(document.activeElement);
      if (!isVisible || isPaused) return;

      const current = Math.max(0, slides.findIndex((slide) => slide.classList.contains("is-active")));
      const next = (current + 1) % slides.length;
      slides[current].classList.remove("is-active");
      slides[current].setAttribute("aria-hidden", "true");
      slides[next].classList.add("is-active");
      slides[next].setAttribute("aria-hidden", "false");
      const count = carousel.querySelector("[data-product-count]");
      if (count) count.textContent = `${next + 1} / ${slides.length}`;
      carousel.dataset.nextRotation = String(now + 3800 + (cardIndex % 3) * 220);
    });
  }, 700);
}

function setupProductGallery(product) {
  const gallery = document.querySelector("[data-product-gallery]");
  const images = productImages(product);
  if (!gallery || images.length < 2) return;

  const stage = gallery.querySelector(".product-gallery-stage");
  const mainImage = gallery.querySelector("[data-gallery-main]");
  const count = gallery.querySelector("[data-gallery-count]");
  const thumbnails = [...gallery.querySelectorAll("[data-gallery-index]")];
  let current = 0;
  let pointerStart = null;

  const show = (requestedIndex) => {
    current = (requestedIndex + images.length) % images.length;
    const image = images[current];
    mainImage.src = image.url;
    mainImage.alt = image.alt || product.name;
    count.textContent = `${current + 1} / ${images.length}`;
    thumbnails.forEach((thumbnail, index) => {
      const active = index === current;
      thumbnail.classList.toggle("is-active", active);
      thumbnail.setAttribute("aria-current", String(active));
    });
    thumbnails[current]?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  };

  gallery.querySelectorAll("[data-gallery-step]").forEach((button) => {
    button.addEventListener("click", () => show(current + Number(button.dataset.galleryStep)));
  });
  thumbnails.forEach((thumbnail) => {
    thumbnail.addEventListener("click", () => show(Number(thumbnail.dataset.galleryIndex)));
  });
  stage.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      show(current + (event.key === "ArrowLeft" ? -1 : 1));
    }
  });
  stage.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "touch") pointerStart = event.clientX;
  });
  stage.addEventListener("pointerup", (event) => {
    if (pointerStart === null || event.pointerType !== "touch") return;
    const distance = event.clientX - pointerStart;
    pointerStart = null;
    if (Math.abs(distance) > 45) show(current + (distance < 0 ? 1 : -1));
  });
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
        <h2>No products are available here yet.</h2>
        <p>Check back soon for the next drop.</p>
      </section>
    `;

/* ========================================================================== */
/* 03. PUBLIC PAGE RENDERERS                                                  */
/* ========================================================================== */

function renderHome() {
  setMeta("Home",
    "Independent fashion and artist-led merchandise from Limpopo, delivered across South Africa."
  );
  setStructuredData({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${CONFIG.siteUrl}/#organization`, name: "Kompo Nation", url: `${CONFIG.siteUrl}/`, logo: `${CONFIG.siteUrl}/assets/kompo-nation-logo-transparent-v2.png` },
      { "@type": "WebSite", "@id": `${CONFIG.siteUrl}/#website`, name: "Kompo Nation", url: `${CONFIG.siteUrl}/`, publisher: { "@id": `${CONFIG.siteUrl}/#organization` } },
    ],
  });

  const hotStores =
    rankStores(state.stores).slice(0, 5);

  const hotProducts =
    rankProducts(state.products).slice(0, 8);

  app.innerHTML = `
    <section class="hero">
      <div class="hero-card">
        <img
          class="hero-image"
          src="${assetPath("/assets/campaign-kompo-apparel-v2.png")}"
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
          Shop independent stores in one place
        </span>
      </article>

      <article>
        <strong>Independent energy</strong>
        <span>
          Every order supports an independent local brand
        </span>
      </article>

      <article>
        <strong>Tracked delivery</strong>
        <span>
          Track your parcel from collection to delivery
        </span>
      </article>
    </section>

    <section class="content-section">
      <div class="section-heading">
        <div>
          <p class="eyebrow">HOT STORES</p>
          <h2>The labels moving now.</h2>

          <p>
            Discover independent labels gaining momentum across Kompo Nation.

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
            Browse customer favourites, new releases and limited runs from across the platform.
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
  setStructuredData({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Shop independent South African fashion",
    url: `${CONFIG.siteUrl}/shop`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: products.map((product, index) => ({ "@type": "ListItem", position: index + 1, name: product.name, url: `${CONFIG.siteUrl}/product/${encodeURIComponent(product.slug)}` })),
    },
  });

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
  setStructuredData({
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Independent stores on Kompo Nation",
    url: `${CONFIG.siteUrl}/stores`,
    mainEntity: {
      "@type": "ItemList",
      itemListElement: stores.map((store, index) => ({ "@type": "ListItem", position: index + 1, name: store.name, url: `${CONFIG.siteUrl}/store/${encodeURIComponent(store.slug)}` })),
    },
  });

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

  const aliases = storeSearchAliases(store);
  const storeDescription = `${store.shortDescription}${aliases.length ? ` Also known as ${aliases.join(" and ")}.` : ""} Shop ${store.name} clothing and products on Kompo Nation.`;
  setMeta(`${store.name} Clothing & Products`, storeDescription);

  const products =
    rankProducts(
      state.products.filter(
        (product) =>
          product.vendorId === store.id
      )
    );
  const canonical = `${CONFIG.siteUrl}/store/${encodeURIComponent(store.slug)}`;
  setStructuredData({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Brand", "@id": `${canonical}#brand`, name: store.name, ...(aliases.length ? { alternateName: aliases } : {}), description: store.description, url: canonical },
      { "@type": "CollectionPage", "@id": `${canonical}#page`, name: `${store.name} store on Kompo Nation`, description: storeDescription, url: canonical, mainEntity: { "@type": "ItemList", numberOfItems: products.length, itemListElement: products.map((product, index) => ({ "@type": "ListItem", position: index + 1, name: product.name, url: `${CONFIG.siteUrl}/product/${encodeURIComponent(product.slug)}` })) } },
    ],
  });

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

  const store = storeFor(product);
  const aliases = storeSearchAliases(store);
  setMeta(
    `${product.name} by ${store?.name || "Kompo Nation"}`,
    `Shop ${product.name} by ${store?.name || "Kompo Nation"}${aliases.length ? `, also searched as ${aliases.join(" and ")}` : ""}. ${product.description}`,
    { image: productImages(product)[0]?.url, type: "product" }
  );
  setStructuredData(productStructuredData(product, store));
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
    <div>${productGallery(product)}</div>

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
  setupProductGallery(product);
}


function renderAbout() {
  setMeta("About", "Meet Kompo Nation, the marketplace helping independent South African artists and fashion labels reach fans nationwide.");
  setStructuredData({ "@context": "https://schema.org", "@type": "AboutPage", name: "About Kompo Nation", url: `${CONFIG.siteUrl}/about` });
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
      "Get help with an order, delivery, return, store or vendor account."
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
  setMeta(title, copy);
  setStructuredData(type === "contact"
    ? {
        "@context": "https://schema.org",
        "@type": "ContactPage",
        name: "Contact Kompo Nation",
        description: copy,
        url: `${CONFIG.siteUrl}/contact`,
        mainEntity: {
          "@type": "Organization",
          name: "Kompo Nation",
          url: CONFIG.siteUrl,
          email: "mailto:ramashilokgotsofatso@gmail.com",
          telephone: "+27727718727",
          contactPoint: {
            "@type": "ContactPoint",
            contactType: "customer and vendor support",
            email: "ramashilokgotsofatso@gmail.com",
            telephone: "+27727718727",
            areaServed: "ZA",
            availableLanguage: "English"
          }
        }
      }
    : { "@context": "https://schema.org", "@type": "WebPage", name: title, description: copy, url: `${CONFIG.siteUrl}/${type}` });

  app.innerHTML = `
    <section class="page-hero">
      <div>
        <p class="eyebrow">KOMPO NATION</p>

        <h1>${title}</h1>

        <p>${copy}</p>
      </div>
    </section>

    ${type === "contact" ? `
      <section class="content-section contact-support-grid" aria-label="Kompo Nation support channels">
        <a class="contact-support-card glass" href="mailto:ramashilokgotsofatso@gmail.com">
          <span class="eyebrow">EMAIL SUPPORT</span>
          <h2>Send us an email</h2>
          <p>ramashilokgotsofatso@gmail.com</p>
          <strong>Open email →</strong>
        </a>

        <a class="contact-support-card glass" href="tel:+27727718727">
          <span class="eyebrow">PHONE SUPPORT</span>
          <h2>Call us</h2>
          <p>072 771 8727</p>
          <strong>Call now →</strong>
        </a>

        <a class="contact-support-card glass" href="https://wa.me/27727718727" target="_blank" rel="noopener noreferrer">
          <span class="eyebrow">WHATSAPP</span>
          <h2>Message us</h2>
          <p>072 771 8727</p>
          <strong>Open WhatsApp →</strong>
        </a>
      </section>

      <section class="content-section contact-support-note">
        <h2>How we can help</h2>
        <p>Include your order reference when asking about an existing purchase. Vendors can include their store name so we can route the request quickly.</p>
      </section>
    ` : `
      <section class="content-section empty-state glass">
        <span>◇</span>
        <h2>Marketplace information</h2>
        <p>${copy}</p>
      </section>
    `}
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
      <h1>Your bag is empty.</h1>
      <p>Explore the marketplace and add something you love.</p>
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

const checkoutLines = () => state.cart.map(({
  productId,
  quantity,
  size,
  colour
}) => ({ productId, quantity, size, colour }));

function syncDiscountSummary(subtotal) {
  const discount = state.appliedDiscount;
  const amount = Math.max(0, Number(discount?.discountCents || 0));
  const line = document.querySelector("#checkout-discount-line");
  const beforeDelivery = document.querySelector("#checkout-before-delivery");
  const message = document.querySelector("#discount-code-message");
  const removeButton = document.querySelector("#remove-discount-code");
  const input = document.querySelector("#discount-code-input");

  if (line) {
    line.hidden = !discount;
    line.innerHTML = discount
      ? `<span>${escapeHtml(discount.code)} · ${escapeHtml(discount.storeName)}</span><strong>−${money(amount)}</strong>`
      : "";
  }
  if (beforeDelivery) beforeDelivery.textContent = money(Math.max(0, subtotal - amount));
  if (removeButton) removeButton.hidden = !discount;
  if (input && discount) input.value = discount.code;
  if (message && discount) {
    message.textContent = `${discount.code} applied to ${discount.storeName}: ${money(amount)} off. ${discount.remainingUses} use${Number(discount.remainingUses) === 1 ? "" : "s"} remaining.`;
  }
}

async function applyCheckoutDiscount(subtotal) {
  const input = document.querySelector("#discount-code-input");
  const button = document.querySelector("#apply-discount-code");
  const message = document.querySelector("#discount-code-message");
  const code = String(input?.value || "").trim().toUpperCase();

  if (!code) {
    message.textContent = "Enter a discount code.";
    return;
  }

  button.disabled = true;
  button.textContent = "Checking…";
  message.textContent = "";

  try {
    const { data, error } = await supabase.rpc("preview_discount_code", {
      p_code: code,
      p_lines: checkoutLines(),
    });
    if (error) throw error;
    if (!data?.valid || !Number(data.discountCents)) throw new Error("This code did not return a valid discount.");
    state.appliedDiscount = data;
    syncDiscountSummary(subtotal);
  } catch (error) {
    state.appliedDiscount = null;
    syncDiscountSummary(subtotal);
    message.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = "Apply";
  }
}

function bindCheckoutDiscountControls(subtotal) {
  document.querySelector("#apply-discount-code")?.addEventListener("click", () => applyCheckoutDiscount(subtotal));
  document.querySelector("#discount-code-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      applyCheckoutDiscount(subtotal);
    }
  });
  document.querySelector("#remove-discount-code")?.addEventListener("click", () => {
    state.appliedDiscount = null;
    const input = document.querySelector("#discount-code-input");
    if (input) input.value = "";
    const message = document.querySelector("#discount-code-message");
    if (message) message.textContent = "Discount code removed.";
    syncDiscountSummary(subtotal);
  });
  syncDiscountSummary(subtotal);
}

async function renderCheckout() {
  if (restoreLegalCheckout()) return;
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

        <div class="summary-line">
          <span>Merchandise subtotal</span>
          <strong>${money(subtotal)}</strong>
        </div>

        <div class="summary-line checkout-discount-line" id="checkout-discount-line" hidden></div>

        <div class="summary-line summary-total">
          <span>Before delivery</span>
          <strong id="checkout-before-delivery">${money(subtotal)}</strong>
        </div>

        <section class="discount-code-box" aria-labelledby="discount-code-heading">
          <div>
            <strong id="discount-code-heading">Discount code</strong>
            <small>Codes apply only to merchandise from the issuing store.</small>
          </div>
          <div class="discount-code-row">
            <input id="discount-code-input" autocomplete="off" maxlength="32" placeholder="Enter code" value="${escapeHtml(state.appliedDiscount?.code || "")}">
            <button class="table-action" id="apply-discount-code" type="button">Apply</button>
          </div>
          <button class="discount-remove-button" id="remove-discount-code" type="button" hidden>Remove code</button>
          <p class="form-message" id="discount-code-message" aria-live="polite"></p>
        </section>

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

  bindCheckoutDiscountControls(subtotal);
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

    const lines = checkoutLines();

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

    let discount = state.appliedDiscount;
    if (discount?.code) {
      const { data, error: discountError } = await supabase.rpc("preview_discount_code", {
        p_code: discount.code,
        p_lines: lines,
      });
      if (discountError) throw discountError;
      discount = data;
      state.appliedDiscount = data;
    }
    const discountCents = Math.max(0, Number(discount?.discountCents || 0));

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
      subtotal -
      discountCents +
      totalDelivery;

    pendingCheckoutReview = {
      lines,
      address,
      contact,
      quotes,
      subtotal,
      totalDelivery,
      discountCode: discount?.code || null,
      discount,
      discountCents,
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

      <div class="summary-line">
        <span>Merchandise subtotal</span>
        <strong>${money(subtotal)}</strong>
      </div>

      ${discount ? `<div class="summary-line checkout-discount-line">
        <span>${escapeHtml(discount.code)} · ${escapeHtml(discount.storeName)}</span>
        <strong>−${money(discountCents)}</strong>
      </div>` : ""}

      <div class="summary-line">
        <span>Merchandise after discount</span>
        <strong>${money(subtotal - discountCents)}</strong>
      </div>

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
      <!-- CHECKOUT_TERMS_ACCEPTANCE_V1 -->
      <label class="legal-consent checkout-legal-consent">
        <input
          id="checkout-terms-acceptance"
          type="checkbox"
        >

        <span>
          I agree to the
          <a
            href="/terms"
          >Terms of Service</a>,
          acknowledge the
          <a
            href="/privacy"
          >Privacy Policy</a>
          and accept the delivery charges shown
          above.
        </span>
      </label>



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
          You will be redirected to our secure payment provider only after you continue.
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

  const termsCheckbox =
    document.querySelector(
      "#checkout-terms-acceptance"
    );

  if (!termsCheckbox?.checked) {

    if (message) {
      message.textContent =
        "Accept the Terms of Service before continuing to payment.";
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

    const {
      data: termsAcceptanceId,
      error: termsError
    } =
      await supabase.rpc(
        "accept_current_terms",
        {
          p_context:
            "checkout"
        }
      );


    if (termsError) {
      throw termsError;
    }


    if (!termsAcceptanceId) {
      throw new Error(
        "Terms acceptance could not be recorded."
      );
    }


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
            lines: pending.lines,
            address: pending.address,
            contact: pending.contact,
            quotes: pending.quotes,
            discountCode: pending.discountCode,
            termsVersion: CURRENT_TERMS_VERSION,
            termsAcceptanceId,
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
    const {data,error}=await supabase.from("returns").select("id,public_reference,resolution_type,reason,exchange_note,responsibility,status,refund_amount_cents,requested_at,return_shipments(id,leg,payer,status,courier_cost_cents,logistics_fee_cents,total_charge_cents,quote_expires_at,courier_name,service_name,tracking_reference,tracking_url)").order("requested_at",{ascending:false});
    if(error)throw error;
    panel.innerHTML=`<p class="eyebrow">AFTER-SALES</p><h1>Returns & exchanges.</h1><p>Every courier movement is quoted separately. If the return is your responsibility, payment happens before that courier leg is booked.</p><div class="return-list">${data.length?data.map(r=>{const ships=Array.isArray(r.return_shipments)?r.return_shipments:[];const shipCards=ships.map(s=>{const expired=s.quote_expires_at&&Date.parse(s.quote_expires_at)<=Date.now();const action=s.payer==="customer"&&s.status==="awaiting_payment"?(expired?`<button class="table-action" data-refresh-return="${r.id}" data-return-leg="${s.leg}">Refresh courier quote</button>`:`<button class="primary-button" data-pay-return="${s.id}">Pay ${s.leg==="reverse"?"return delivery":"replacement delivery"}</button>`):"";return `<section class="return-shipment-card"><div><strong>${s.leg==="reverse"?"Return to store":"Replacement delivery"}</strong><p>${escapeHtml(s.courier_name||"Courier")} Â· ${escapeHtml(s.status.replaceAll("_"," "))}</p></div>${s.total_charge_cents!=null?`<div class="return-price-grid"><span>Courier delivery</span><strong>${money(s.courier_cost_cents||0)}</strong><span>Logistics &amp; fulfilment</span><strong>${money(s.logistics_fee_cents||0)}</strong><span>Total delivery</span><strong>${money(s.total_charge_cents||0)}</strong></div>`:""}<div class="return-actions">${action}${s.tracking_url?`<a class="table-action" href="${escapeHtml(s.tracking_url)}" target="_blank" rel="noopener">Track</a>`:""}</div></section>`}).join("");return `<article class="return-card"><div class="return-heading"><div><strong>${publicReference(r.public_reference)}</strong><p>${r.resolution_type==="exchange"?"Exchange":"Refund"} Â· ${escapeHtml(r.reason)}</p></div><span class="status-pill">${escapeHtml(r.status.replaceAll("_"," "))}</span></div>${r.exchange_note?`<p><strong>Replacement:</strong> ${escapeHtml(r.exchange_note)}</p>`:""}${r.responsibility!=="undetermined"?`<p>Logistics responsibility: <strong>${r.responsibility==="vendor"?"Store":r.responsibility==="kompo"?"Kompo Nation":"Customer"}</strong></p>`:"<p>Responsibility is being reviewed.</p>"}${shipCards}${!ships.length&&r.status==="approved"&&r.responsibility==="customer"?`<button class="table-action" data-refresh-return="${r.id}" data-return-leg="reverse">Get return delivery price</button>`:""}</article>`}).join(""):"<p>No return requests yet. Start one from an eligible delivered package.</p>"}</div>`;
    return;
  }

}

// CUSTOMER_RETURN_V2
async function returnApi(action,body={}){const res=await fetch(`${CONFIG.functionsBase}/return-logistics`,{method:"POST",headers:{"Content-Type":"application/json",...(await authHeader())},body:JSON.stringify({action,...body})}),x=await res.json();if(!res.ok)throw new Error(x.error||"Return logistics failed.");return x}
async function openReturnDialog(id){document.querySelector("#return-dialog")?.remove();const d=document.createElement("dialog");d.id="return-dialog";d.className="return-dialog";d.innerHTML=`<form id="return-form" class="return-form"><div class="return-heading"><div><p class="eyebrow">RETURN REQUEST</p><h2>Refund or exchange</h2></div><button type="button" class="quiet-button" id="return-close">Close</button></div><label>Resolution<select name="resolution" id="return-resolution"><option value="refund">Refund</option><option value="exchange">Exchange</option></select></label><label>Reason<select name="reason" required><option value="">Choose a reason</option><option value="wrong_size_ordered">I selected the wrong size</option><option value="change_of_mind">I changed my mind</option><option value="wrong_size_received">The store sent the wrong size</option><option value="wrong_item_received">The store sent the wrong item</option><option value="defective">The item is defective</option><option value="not_as_described">The item is not as described</option><option value="other">Other</option></select></label><label id="exchange-note" hidden>Replacement required<input name="exchange" placeholder="Example: Large / Black"></label><label>Details<textarea name="note" rows="4"></textarea></label><p><small>Return delivery is separate from the original delivery. If you are responsible, you will see and pay the courier + logistics amount before collection is booked. <a href="/returns">Read the return policy.</a></small></p><button class="primary-button" type="submit">Submit return request</button><p class="form-message"></p></form>`;document.body.append(d);const f=d.querySelector("#return-form"),sel=f.elements.resolution,note=d.querySelector("#exchange-note");sel.addEventListener("change",()=>{note.hidden=sel.value!=="exchange";f.elements.exchange.required=sel.value==="exchange"});d.querySelector("#return-close").addEventListener("click",()=>d.close());f.addEventListener("submit",async e=>{e.preventDefault();const v=Object.fromEntries(new FormData(f)),btn=f.querySelector('button[type="submit"]'),msg=f.querySelector(".form-message");btn.disabled=true;const{error}=await supabase.rpc("request_return_v2",{p_vendor_order_id:id,p_resolution_type:v.resolution,p_reason_code:v.reason,p_note:String(v.note||"").trim(),p_exchange_note:String(v.exchange||"").trim()});if(error){msg.textContent=error.message;btn.disabled=false;return}d.close();d.remove();showToast("Return request submitted.");renderAccountView("returns",document.querySelector('[data-account-view="returns"]'))});d.showModal()}
async function handleAccountAction(event) {
  const payReturn=event.target.closest("[data-pay-return]");if(payReturn){try{const x=await returnApi("initialize-payment",{returnShipmentId:payReturn.dataset.payReturn});location.href=x.authorizationUrl}catch(e){showToast(e.message)}return}
  const refreshReturn=event.target.closest("[data-refresh-return]");if(refreshReturn){try{await returnApi(refreshReturn.dataset.returnLeg==="exchange_outbound"?"prepare-exchange":"prepare-reverse",{returnId:refreshReturn.dataset.refreshReturn});showToast("Courier quote updated.");return renderAccountView("returns",document.querySelector('[data-account-view="returns"]'))}catch(e){return showToast(e.message)}}
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

  const returnButton=event.target.closest("[data-request-return]");
  if(returnButton)return openReturnDialog(returnButton.dataset.requestReturn);
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
            ? "Payment received."
            : "Payment was not completed."
        }
      </h1>

      <p>
        ${
          success
            ? "We're confirming your payment. Your order will appear as paid in your account once confirmation is complete."
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
  setMeta("Page not found", "This Kompo Nation page could not be found.", { robots: "noindex, nofollow" });
  setStructuredData({ "@context": "https://schema.org", "@type": "WebPage", name: "Page not found" });
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

  const header = document.querySelector("#site-header");
  const nav = document.querySelector(".main-nav");
  const menuButton = document.querySelector("#menu-button");
  const setMenuOpen = (open, returnFocus = false) => {
    nav.classList.toggle("open", open);
    menuButton.classList.toggle("is-open", open);
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menuButton.innerHTML = open
      ? '<span aria-hidden="true">×</span> Close'
      : '<span aria-hidden="true">☰</span> Menu';
    if (!open && returnFocus) menuButton.focus();
  };

  menuButton.addEventListener("click", () => setMenuOpen(!nav.classList.contains("open")));
  nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenuOpen(false)));
  document.addEventListener("pointerdown", (event) => {
    if (nav.classList.contains("open") && !header.contains(event.target)) setMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && nav.classList.contains("open")) setMenuOpen(false, true);
  });
  window.addEventListener("resize", () => {
    if (window.innerWidth > 1050 && nav.classList.contains("open")) setMenuOpen(false);
  });

  const dialog =
    document.querySelector("#search-dialog");

  document
    .querySelectorAll("#search-button, [data-mobile-search]")
    .forEach((button) => button.addEventListener(
      "click",
      () => {
        setMenuOpen(false);
        dialog.showModal();

        setTimeout(
          () =>
            document
              .querySelector("#global-search")
              .focus(),
          50
        );
      }
    ));

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


// LEGAL_TERMS_V1
const CURRENT_TERMS_VERSION = "1.0";


// LEGAL_RETURN_NAV_V2
const LEGAL_CTX="kompoLegalContextV2",LEGAL_SNAP="kompoCheckoutLegalSnapshotV2",LEGAL_RESTORE="kompoCheckoutLegalRestoreV2";
document.addEventListener("click",(e)=>{const x=e.target.closest('a[href="/terms"],a[href="/privacy"],a[href="/returns"]');if(!x)return;let label="Return to home";if(location.pathname==="/checkout")label="Return to order review";else if(location.pathname==="/account")label="Return to your account";else if(location.pathname!=="/")label="Go back";sessionStorage.setItem(LEGAL_CTX,JSON.stringify({path:location.pathname+location.search,label}));if(location.pathname==="/checkout"&&pendingCheckoutReview)sessionStorage.setItem(LEGAL_SNAP,JSON.stringify({pending:pendingCheckoutReview,html:app.innerHTML}));});
function legalContext(){try{return JSON.parse(sessionStorage.getItem(LEGAL_CTX)||"null")}catch{return null}}
function returnFromLegal(){const c=legalContext();if(c?.path?.startsWith("/checkout"))sessionStorage.setItem(LEGAL_RESTORE,"1");if(history.length>1){history.back();return}location.href=c?.path||"/"}
function legalReturnButton(){const c=legalContext();return `<section class="legal-return-panel"><button class="primary-button" id="legal-return-button" type="button">${escapeHtml(c?.label||"Return to home")}</button></section>`}
function restoreLegalCheckout(){if(sessionStorage.getItem(LEGAL_RESTORE)!=="1")return false;sessionStorage.removeItem(LEGAL_RESTORE);let s=null;try{s=JSON.parse(sessionStorage.getItem(LEGAL_SNAP)||"null")}catch{}sessionStorage.removeItem(LEGAL_SNAP);const expiries=(s?.pending?.quotes||[]).map(q=>Date.parse(q?.expiresAt||"")).filter(Number.isFinite);if(!s?.pending||!s?.html||!expiries.length||Math.min(...expiries)<=Date.now())return false;pendingCheckoutReview=s.pending;state.appliedDiscount=s.pending.discount||null;app.innerHTML=s.html;document.querySelector("#continue-secure-payment")?.addEventListener("click",continueCheckoutToPayment);document.querySelector("#change-delivery-details")?.addEventListener("click",()=>renderCheckout());return true}
const KOMPO_LEGAL_PAGES = {

  terms: {
    eyebrow: "LEGAL",
    title: "Terms of Service",
    meta:
      "Version 1.0 · Effective 25 August 2026",

    intro: `
      <p>
        These Terms govern use of Kompo Nation,
        customer accounts, purchases made through
        the marketplace and, where applicable,
        participation by vendors selling through
        Kompo Nation.
      </p>

      <p>
        By creating an account, completing a
        purchase or accepting the Vendor Clause,
        you agree to the provisions that apply to
        you.
      </p>

      <p>
        Nothing in these Terms is intended to
        exclude, restrict or waive any right that
        cannot lawfully be excluded under South
        African law.
      </p>
    `,

    sections: [

      [
        "1. Kompo Nation and the marketplace",
        `
          <p>
            Kompo Nation is a South African online
            marketplace operated under the Kompo
            Nation trading name.
          </p>

          <p>
            The platform allows independent vendors
            to offer merchandise, provides
            marketplace technology, facilitates
            payment processing and coordinates
            delivery and fulfilment services.
          </p>

          <p>
            Unless a product is expressly identified
            as being sold directly by Kompo Nation,
            the vendor shown on the relevant product
            or store page is the supplier of that
            merchandise.
          </p>

          <p>
            Notices and enquiries may be submitted
            using the contact information published
            on the Kompo Nation Contact page.
          </p>
        `
      ],


      [
        "2. Accounts",
        `
          <p>
            Account information must be accurate and
            kept reasonably current. Users are
            responsible for keeping passwords and
            login credentials secure.
          </p>

          <p>
            Kompo Nation may suspend access where
            there is reasonable evidence of fraud,
            unlawful activity, abuse, attempted
            interference with the platform or a
            material breach of these Terms.
          </p>

          <p>
            Acceptance of the current Terms may be
            required at signup, checkout, vendor
            access or when a materially updated
            version becomes effective.
          </p>
        `
      ],


      [
        "3. Products and independent vendors",
        `
          <p>
            Vendors are responsible for the
            accuracy of their product descriptions,
            photographs, sizes, colours, prices,
            stock quantities and other material
            information.
          </p>

          <p>
            Kompo Nation may suspend or remove
            unlawful, misleading, unsafe,
            counterfeit or materially inaccurate
            listings.
          </p>
        `
      ],


      [
        "4. Prices and payment",
        `
          <p>
            Amounts displayed to South African
            customers are stated in South African
            rand unless otherwise indicated.
          </p>

          <p>
            Before payment, the customer is shown
            the merchandise amount, delivery
            charges and total amount due.
          </p>

          <p>
            Payments are processed through an
            authorised payment provider, currently
            Paystack, Stitch or Yoco. A transaction is not treated
            as successfully paid merely because a
            browser returns to Kompo Nation.
            Payment must be confirmed through the
            authorised payment process.
          </p>
        `
      ],


      [
        "5. Courier delivery and logistics fees",
        `
          <p>
            The delivery amount shown at checkout
            may contain two components:
            <strong>Courier delivery</strong> and
            <strong>Logistics &amp; fulfilment</strong>.
          </p>

          <p>
            Courier delivery represents the
            underlying courier component attributed
            to the shipment.
          </p>

          <p>
            Logistics &amp; fulfilment is a Kompo
            Nation service charge for functions such
            as courier-rate sourcing, shipment
            administration, fulfilment support,
            tracking infrastructure and logistics
            coordination. That amount may be retained
            by Kompo Nation.
          </p>

          <p>
            Kompo Nation may apply a minimum total
            delivery amount or an uplift to lower
            courier rates. The exact delivery amount
            charged to the customer is always shown
            before payment.
          </p>

          <p>
            The total delivery amount can therefore
            be higher than the underlying courier
            charge.
          </p>
        `
      ],


      [
        "6. Delivery",
        `
          <p>
            Delivery is carried out by independent
            courier providers made available through
            Kompo Nation's logistics systems.
          </p>

          <p>
            Courier service levels and delivery
            times are estimates unless expressly
            guaranteed by the relevant courier.
          </p>

          <p>
            Customers must provide a complete and
            accurate street address, area or suburb,
            city, province, postal code and usable
            contact information.
          </p>

          <p>
            Additional costs reasonably caused by
            an incorrect address, failed customer
            handover or another customer-caused
            delivery issue may be recoverable where
            permitted by law.
          </p>
        `
      ],


      [
        "7. Ordinary order cancellation",
        `
          <p>
            Kompo Nation may allow ordinary
            cancellation while an order remains in
            an early fulfilment stage.
          </p>

          <p>
            The normal cancellation facility may
            close once the vendor moves the order
            into <strong>Packing</strong>, because
            fulfilment has begun.
          </p>

          <p>
            Closing the ordinary cancellation button
            does not remove any cooling-off, return,
            refund or other consumer right that
            applies by law.
          </p>
        `
      ],


      [
        "8. Returns",
        `
          <p>
            Customers may submit qualifying return
            requests through Kompo Nation.
          </p>

          <p>
            A request may require a reason,
            photographs or other information that
            is reasonably necessary to assess the
            return.
          </p>

          <p>
            A vendor may review a return request,
            but a vendor cannot reject a return where
            the customer has a non-excludable legal
            right to the return.
          </p>
        `
      ],


      [
        "9. Return courier charges",
        `
          <p>
            A return shipment is separate from the
            original outbound delivery. The original
            delivery amount does not automatically
            include a later return shipment.
          </p>

          <p>
            A new courier charge may therefore apply
            when goods need to travel from the
            customer back to a vendor.
          </p>

          <p>
            Where the return arises from a vendor
            sending the wrong item, supplying
            defective goods, materially
            misdescribing goods or another
            vendor-responsible problem, the vendor
            may be responsible for the return
            transport where required by law.
          </p>

          <p>
            Where a lawful change-of-mind or
            cooling-off return allows the direct
            return cost to be borne by the customer,
            the customer may be required to pay that
            cost.
          </p>
        `
      ],


      [
        "10. Refunds",
        `
          <p>
            Approved refunds are processed through
            the applicable payment process and may
            require additional banking or payment
            processing time before appearing in the
            customer's account.
          </p>

          <p>
            Refund values and any lawful deductions
            depend on the reason for cancellation or
            return and applicable South African law.
          </p>
        `
      ],


      [
        "11. Defective or incorrectly supplied goods",
        `
          <p>
            Nothing in these Terms removes statutory
            rights relating to defective, unsafe,
            incorrectly supplied or materially
            misdescribed goods.
          </p>

          <p>
            Where applicable legislation requires a
            supplier to bear the risk or expense of
            a return, these Terms do not transfer
            that legally required cost to the
            customer.
          </p>
        `
      ],


      [
        "12. Returned product condition",
        `
          <p>
            Customers must take reasonable care of
            goods while they remain in their
            possession.
          </p>

          <p>
            Where legally permitted, a reasonable
            deduction may apply where goods have
            been damaged, altered or used beyond
            what was reasonably necessary to inspect
            them.
          </p>
        `
      ],


      [
        "13. Fraud, chargebacks and payment disputes",
        `
          <p>
            Kompo Nation may investigate suspected
            fraud, misuse, chargebacks or
            unauthorised transactions.
          </p>

          <p>
            Relevant transaction, fulfilment,
            payment and delivery records may be
            provided to payment providers, financial
            institutions, regulators or law
            enforcement where reasonably necessary
            and lawful.
          </p>
        `
      ],


      [
        "14. Privacy",
        `
          <p>
            Personal information is processed for
            account administration, payment,
            delivery, fraud prevention, support and
            other legitimate marketplace operations.
          </p>

          <p>
            Further information appears in the
            <a href="/privacy">Kompo Nation Privacy Policy</a>.
          </p>
        `
      ],


      [
        "15. Intellectual property",
        `
          <p>
            The Kompo Nation name, platform design,
            software and original platform material
            may not be commercially copied or
            exploited without permission.
          </p>

          <p>
            Vendors are responsible for ensuring
            that they have the right to use the
            product images, trademarks, designs,
            names and other material they provide.
          </p>
        `
      ],


      [
        "16. Third-party services and availability",
        `
          <p>
            Kompo Nation uses third-party services
            including hosting, Supabase, Paystack,
            Stitch, Yoco,
            courier and communication providers.
          </p>

          <p>
            Reasonable efforts are made to keep the
            marketplace available, but uninterrupted
            operation cannot be guaranteed where
            outages, maintenance or third-party
            failures occur.
          </p>
        `
      ],


      [
        "17. Liability",
        `
          <p>
            To the fullest extent permitted by law,
            Kompo Nation is not liable for indirect
            or consequential loss arising solely
            from events outside its reasonable
            control.
          </p>

          <p>
            Nothing in this clause excludes or
            limits liability that South African law
            does not permit to be excluded or
            limited.
          </p>
        `
      ],


      [
        "18. Changes to these Terms",
        `
          <p>
            Kompo Nation may update these Terms for
            legal, operational, technical or
            commercial reasons.
          </p>

          <p>
            Each published set of Terms carries a
            version and effective date. Material
            updates may require fresh acceptance.
          </p>

          <p>
            Historical acceptance records may be
            retained for evidentiary and compliance
            purposes.
          </p>
        `
      ],


      [
        "19. Governing law and disputes",
        `
          <p>
            These Terms are governed by the laws of
            the Republic of South Africa.
          </p>

          <p>
            Users and Kompo Nation should first try
            in good faith to resolve disputes
            directly.
          </p>

          <p>
            Nothing prevents a consumer from using
            an applicable regulator, ombud,
            tribunal, complaint process or court.
          </p>
        `
      ],


      [
        "20. Vendor Clause: responsibility",
        `
          <p>
            The following clauses apply additionally
            to vendors selling through Kompo Nation.
          </p>

          <p>
            Vendors remain responsible for the
            legality, safety, quality, authenticity,
            description and availability of their
            merchandise and for complying with
            applicable consumer-protection duties.
          </p>
        `
      ],


      [
        "21. Vendor Clause: customer price markup",
        `
          <p>
            Unless a different rate is expressly
            agreed with or configured for a vendor,
            Kompo Nation's standard customer price
            target is calculated at <strong>10% above
            the vendor's submitted base price</strong>.
            The result is rounded to the nearest R50
            and set R1 below that threshold.
          </p>

          <p>
            For example, a R550 vendor base price has
            a R605 target and is shown to the customer
            as R599. For an undiscounted sale, the
            vendor settlement remains R550 and the R49
            difference is paid to Kompo Nation. Retail
            rounding may reduce Kompo Nation's markup,
            but never the vendor's base settlement.
          </p>
        `
      ],


      [
        "22. Vendor Clause: returns and refunds",
        `
          <p>
            When an approved transaction is refunded,
            Kompo Nation returns the corresponding
            platform markup portion and the vendor
            remains responsible for the vendor-net
            merchandise amount where applicable.
          </p>

          <p>
            This rule does not reduce any refund
            legally owed to the customer. Store-created
            discounts may reduce both the customer
            price and vendor settlement proportionally.
          </p>
        `
      ],


      [
        "23. Vendor Clause: vendor-caused returns",
        `
          <p>
            Where a return results from the wrong
            item or size being supplied, defective
            merchandise, a material
            misrepresentation or another
            vendor-responsible problem, return
            courier costs may be charged to or
            deducted from amounts due to the vendor
            where legally permitted.
          </p>
        `
      ],


      [
        "24. Vendor Clause: fulfilment and packaging",
        `
          <p>
            Vendors must maintain accurate product
            weights, stock and package information.
          </p>

          <p>
            Standard package dimensions, packaging
            weight and item capacity must reasonably
            represent the parcel handed to the
            courier.
          </p>

          <p>
            A vendor should move an order to Packed
            only when the physical parcel is
            complete.
          </p>
        `
      ],


      [
        "25. Vendor Clause — courier collection",
        `
          <p>
            Ready for collection means the parcel is
            physically available at the vendor's
            saved collection address.
          </p>

          <p>
            A courier collection cut-off is the
            deadline for requesting that courier
            service. It is not a guarantee of the
            driver's arrival time.
          </p>

          <p>
            Vendors must ensure that somebody is
            available to hand over a booked parcel
            and must follow any waybill or label
            requirements.
          </p>
        `
      ],


      [
        "26. Vendor Clause — payouts, deductions and suspension",
        `
          <p>
            Kompo Nation may deduct agreed
            marketplace commissions, refunds,
            chargebacks, vendor-responsible return
            costs and other amounts properly due
            under the vendor arrangement from
            amounts otherwise payable to the vendor,
            subject to applicable law.
          </p>

          <p>
            Products or vendor access may be
            suspended for fraud, unlawful goods,
            counterfeit merchandise, serious
            consumer harm, repeated material stock
            inaccuracies or serious breach of these
            Terms.
          </p>
        `
      ]

    ]
  },


  privacy: {
    eyebrow: "PRIVACY",
    title: "Privacy Policy",
    meta:
      "Effective 25 August 2026",

    intro: `
      <p>
        Kompo Nation processes personal information
        only where reasonably necessary to operate
        the marketplace and associated services.
      </p>
    `,

    sections: [

      [
        "Information we collect",
        `
          <p>
            We may process names, email addresses,
            telephone numbers, account identifiers,
            delivery addresses, order information,
            return information, support messages and
            technical information associated with
            use of the platform.
          </p>

          <p>
            Card details are handled by the
            authorised payment provider and are not
            intentionally stored as raw card
            credentials by Kompo Nation.
          </p>
        `
      ],


      [
        "Why we use information",
        `
          <p>
            Information may be used to create and
            manage accounts, process transactions,
            deliver orders, coordinate couriers,
            prevent fraud, administer returns,
            provide customer support, maintain
            platform security and comply with legal
            obligations.
          </p>
        `
      ],


      [
        "Who information is shared with",
        `
          <p>
            Relevant information may be shared with
            the vendor fulfilling an order,
            payment providers (including Paystack
            Stitch or Yoco), Bob Go and participating
            couriers, Supabase, hosting providers,
            communication providers and authorised
            professional or regulatory parties where
            necessary and lawful.
          </p>

          <p>
            Vendors receive only information
            reasonably required to fulfil and
            administer their orders.
          </p>
        `
      ],


      [
        "Retention",
        `
          <p>
            Records may be retained for as long as
            reasonably necessary for transactions,
            accounting, fraud prevention, dispute
            handling, legal compliance and
            legitimate operational needs.
          </p>

          <p>
            Legal acceptance and transaction records
            may be retained after an account is no
            longer actively used where there is a
            legitimate or legal reason to do so.
          </p>
        `
      ],


      [
        "Security",
        `
          <p>
            Kompo Nation uses reasonable technical
            and organisational safeguards, including
            authenticated access, database access
            controls and server-side handling of
            private API credentials.
          </p>

          <p>
            No internet service can guarantee
            absolute security.
          </p>
        `
      ],


      [
        "Your choices and rights",
        `
          <p>
            Users may request reasonable assistance
            relating to the personal information
            associated with their account and may
            exercise applicable rights provided by
            South African data-protection law.
          </p>

          <p>
            Privacy enquiries may be submitted
            through the
            <a href="/contact">Contact page</a>.
          </p>
        `
      ]

    ]
  },


  returns: {
    eyebrow: "RETURNS",
    title: "Returns & Refunds",
    meta:
      "Customer policy · Effective 25 August 2026",

    intro: `
      <p>
        This policy explains the Kompo Nation return
        process. It operates together with the Terms
        of Service and does not remove statutory
        consumer rights.
      </p>
    `,

    sections: [

      [
        "Requesting a return",
        `
          <p>
            A return request may be submitted for an
            eligible delivered order. Customers
            should provide the reason and any
            reasonably required photographs or
            supporting information.
          </p>
        `
      ],


      [
        "Vendor review",
        `
          <p>
            The relevant vendor may review the
            request through the vendor portal.
            Approval cannot be withheld where the
            customer has a non-excludable legal
            right to return the goods.
          </p>
        `
      ],


      [
        "Return courier",
        `
          <p>
            Return transport is a separate courier
            movement and is not automatically
            included in the original delivery
            charge.
          </p>

          <p>
            After a return is approved, Kompo Nation
            may coordinate a return collection or
            provide further return instructions.
            A fresh courier charge may apply.
          </p>
        `
      ],


      [
        "Who pays for return transport",
        `
          <p>
            Where the vendor supplied the wrong
            item, defective goods or materially
            misdescribed merchandise, the vendor may
            be responsible for the return cost where
            required by law.
          </p>

          <p>
            Where applicable law permits a customer
            to bear the direct cost of a
            change-of-mind or cooling-off return,
            that direct return cost may be charged
            to the customer.
          </p>
        `
      ],


      [
        "Refund timing",
        `
          <p>
            Refunds are processed only after the
            return or cancellation reaches the
            appropriate approved stage. Payment
            provider and banking processing times
            may apply after Kompo Nation submits the
            refund.
          </p>
        `
      ],


      [
        "Ordinary cancellation",
        `
          <p>
            The ordinary cancellation button may
            become unavailable once a vendor begins
            Packing the order.
          </p>

          <p>
            This operational rule does not remove
            consumer rights that apply by law.
          </p>
        `
      ]

    ]
  }

};


function renderLegalPage(kind) {

  const page =
    KOMPO_LEGAL_PAGES[kind];

  if (!page) {
    return renderNotFound();
  }
  setMeta(page.title, `${page.title} for customers, vendors and visitors using Kompo Nation.`);
  setStructuredData({ "@context": "https://schema.org", "@type": "WebPage", name: page.title, url: `${CONFIG.siteUrl}/${kind}` });


  app.innerHTML = `
    <section class="legal-page">

      <header class="legal-hero">

        <p class="eyebrow">
          ${page.eyebrow}
        </p>

        <h1>
          ${page.title}
        </h1>

        <p class="legal-meta">
          ${page.meta}
        </p>

        <div class="legal-intro">
          ${page.intro}
        </div>

        <div class="legal-actions">
          <button
            class="quiet-button"
            type="button"
            onclick="window.print()"
          >
            Print / save a copy
          </button>
        </div>

      </header>


      <div class="legal-sections">

        ${
          page.sections
            .map(
              ([title, body]) => `
                <section class="legal-section">

                  <h2>
                    ${title}
                  </h2>

                  <div>
                    ${body}
                  </div>

                </section>
              `
            )
            .join("")
        }

      </div>

    ${legalReturnButton()}
    </section>
  `;
  document.querySelector("#legal-return-button")?.addEventListener("click",returnFromLegal);
}


async function renderRoute() {
  const { path } =
    currentRoute();

  if (["/cart", "/checkout", "/wishlist", "/account", "/payment-success", "/payment-cancelled"].includes(path)) {
    setMeta("Private page", "Secure Kompo Nation customer page.", { robots: "noindex, nofollow" });
    setStructuredData({ "@context": "https://schema.org", "@type": "WebPage", name: "Kompo Nation customer page" });
  }

  if (path === "/terms") {
    return renderLegalPage("terms");
  }

  if (path === "/privacy") {
    return renderLegalPage("privacy");
  }

  if (path === "/returns") {
    return renderLegalPage("returns");
  }

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

  setupProductCardRotation();

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

      if (Array.isArray(catalogue?.products)) {
        state.products =
          catalogue.products;

        const liveProductIds = new Set(
          state.products.map((product) => product.id)
        );

        state.cart = state.cart.filter(
          (line) => liveProductIds.has(line.productId)
        );

        state.wishlist = state.wishlist.filter(
          (productId) => liveProductIds.has(productId)
        );

        saveCommerceState();
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
