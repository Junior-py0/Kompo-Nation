import { SITE_URL, escapeHtml, storefrontDocument, supabaseRows } from "./_seo.js";

const PAGE_COPY = {
  "/": [
    "Kompo Nation | Independent South African Fashion",
    "Shop artist-led fashion and independent merchandise from Limpopo, delivered across South Africa.",
  ],
  "/shop": [
    "Shop Independent South African Fashion | Kompo Nation",
    "Shop independent clothing, streetwear, limited artist merchandise and emerging South African fashion brands on Kompo Nation.",
  ],
  "/stores": [
    "Independent Fashion Stores | Kompo Nation",
    "Discover independent clothing stores, artist-led labels and emerging fashion voices from Limpopo and South Africa.",
  ],
  "/about": [
    "About Kompo Nation | Independent Fashion Marketplace",
    "Meet Kompo Nation, the marketplace helping independent South African artists and fashion labels reach fans nationwide.",
  ],
  "/delivery": [
    "Delivery Across South Africa | Kompo Nation",
    "Learn how Kompo Nation coordinates tracked delivery from independent stores to customers across South Africa.",
  ],
  "/returns": [
    "Returns & Exchanges | Kompo Nation",
    "Read the Kompo Nation returns and exchanges process for products purchased from independent marketplace stores.",
  ],
  "/contact": [
    "Contact Kompo Nation",
    "Contact Kompo Nation for customer order, delivery, return, store and vendor support.",
  ],
  "/privacy": [
    "Privacy Policy | Kompo Nation",
    "Read how Kompo Nation handles personal information for accounts, checkout, fulfilment and customer support.",
  ],
  "/terms": [
    "Terms of Service | Kompo Nation",
    "Read the Kompo Nation marketplace terms for customers, vendors, orders, fulfilment, returns and settlements.",
  ],
};

function resolvedPath(value) {
  if (Array.isArray(value)) return value.length ? `/${value.join("/")}` : "/";
  return value ? `/${value}` : "/";
}

export async function onRequest(context) {
  const path = resolvedPath(context.params.path);
  const page = PAGE_COPY[path];
  if (!page) return context.next();

  const [title, description] = page;
  let bodyHtml;
  let structuredData = {
    "@context": "https://schema.org",
    "@type": path === "/about" ? "AboutPage" : "WebPage",
    name: title.replace(/ \| Kompo Nation.*$/, ""),
    description,
    url: `${SITE_URL}${path === "/" ? "/" : path}`,
  };

  if (["/", "/shop", "/stores"].includes(path)) {
    const [stores, products] = await Promise.all([
      supabaseRows("vendors", {
        select: "id,slug,business_name,short_description,updated_at",
        status: "eq.active",
        retired_at: "is.null",
        order: "business_name.asc",
      }),
      supabaseRows("products", {
        select: "id,vendor_id,slug,name,description,category,updated_at",
        status: "eq.active",
        order: "updated_at.desc",
      }),
    ]);
    const vendorNames = new Map(stores.map((store) => [store.id, store.business_name]));
    const storeLinks = stores.map((store) => `<article><h2><a href="/store/${encodeURIComponent(store.slug)}">${escapeHtml(store.business_name)}</a></h2><p>${escapeHtml(store.short_description)}</p></article>`).join("");
    const productLinks = products.map((product) => `<article><p class="eyebrow">${escapeHtml(vendorNames.get(product.vendor_id) || "Kompo Nation")} · ${escapeHtml(product.category)}</p><h2><a href="/product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h2><p>${escapeHtml(product.description)}</p></article>`).join("");
    const itemSource = path === "/stores"
      ? stores.map((store) => ({ name: store.business_name, url: `${SITE_URL}/store/${encodeURIComponent(store.slug)}` }))
      : products.map((product) => ({ name: product.name, url: `${SITE_URL}/product/${encodeURIComponent(product.slug)}` }));
    structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: "Kompo Nation", url: `${SITE_URL}/`, logo: `${SITE_URL}/assets/kompo-nation-logo-transparent-v2.png` },
        { "@type": path === "/" ? "WebSite" : "CollectionPage", "@id": `${SITE_URL}${path === "/" ? "/" : path}#page`, name: title, description, url: `${SITE_URL}${path === "/" ? "/" : path}`, mainEntity: { "@type": "ItemList", numberOfItems: itemSource.length, itemListElement: itemSource.map((item, index) => ({ "@type": "ListItem", position: index + 1, ...item })) } },
      ],
    };
    const listing = path === "/stores" ? storeLinks : productLinks;
    bodyHtml = `<section class="page-hero seo-server-shell"><div><p class="eyebrow">KOMPO NATION</p><h1>${escapeHtml(title.split(" | ")[0])}</h1><p>${escapeHtml(description)}</p></div></section><section class="content-section seo-server-products">${listing || "<p>New releases are coming soon.</p>"}</section>${path === "/" ? `<section class="content-section"><h2>Explore every independent store</h2><div class="seo-server-products">${storeLinks}</div></section>` : ""}`;
  } else {
    bodyHtml = `<section class="page-hero seo-server-shell"><div><p class="eyebrow">KOMPO NATION</p><h1>${escapeHtml(title.split(" | ")[0])}</h1><p>${escapeHtml(description)}</p></div></section>`;
  }

  return storefrontDocument(context, {
    title,
    description,
    canonical: path,
    structuredData,
    bodyHtml,
  });
}
