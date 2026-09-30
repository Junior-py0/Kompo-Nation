import { SITE_URL, breadcrumbList, escapeHtml, storefrontDocument, supabaseRows } from "./_seo.js";

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
  const requestUrl = new URL(context.request.url);
  const cleanPath = requestUrl.pathname.length > 1
    ? requestUrl.pathname.replace(/\/+$/, "")
    : "/";
  if (requestUrl.hostname === "www.komponation.co.za" || cleanPath !== requestUrl.pathname) {
    return Response.redirect(`${SITE_URL}${cleanPath}${requestUrl.search}`, 301);
  }
  const path = resolvedPath(context.params.path);
  const page = PAGE_COPY[path];
  if (!page) return context.next();

  const [title, description] = page;
  let bodyHtml;
  let structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": path === "/about" ? "AboutPage" : "WebPage",
        name: title.replace(/ \| Kompo Nation.*$/, ""),
        description,
        url: `${SITE_URL}${path === "/" ? "/" : path}`,
      },
      ...(path === "/" ? [] : [breadcrumbList([
        { name: "Home", url: "/" },
        { name: title.split(" | ")[0], url: path },
      ])]),
    ],
  };

  if (["/", "/shop", "/stores"].includes(path)) {
    const [stores, products, media] = await Promise.all([
      supabaseRows("vendors", {
        select: "id,slug,business_name,description,short_description,mark,accent,status,sales_count,featured_override,is_platform_owned,updated_at",
        status: "eq.active",
        retired_at: "is.null",
        order: "business_name.asc",
      }),
      supabaseRows("rpc/get_storefront_products"),
      supabaseRows("product_media", {
        select: "id,product_id,public_url,alt_text,sort_order,created_at",
        order: "sort_order.asc,created_at.asc",
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
        { "@type": "Organization", "@id": `${SITE_URL}/#organization`, name: "Kompo Nation", url: `${SITE_URL}/`, logo: `${SITE_URL}/assets/kompo-nation-logo-transparent-v2.png`, email: "mailto:ramashilokgotsofatso@gmail.com", telephone: "+27727718727", contactPoint: { "@type": "ContactPoint", contactType: "customer and vendor support", email: "ramashilokgotsofatso@gmail.com", telephone: "+27727718727", areaServed: "ZA", availableLanguage: "English" } },
        { "@type": path === "/" ? "WebSite" : "CollectionPage", "@id": `${SITE_URL}${path === "/" ? "/" : path}#page`, name: title, description, url: `${SITE_URL}${path === "/" ? "/" : path}`, mainEntity: { "@type": "ItemList", numberOfItems: itemSource.length, itemListElement: itemSource.map((item, index) => ({ "@type": "ListItem", position: index + 1, ...item })) } },
        ...(path === "/" ? [] : [breadcrumbList([
          { name: "Home", url: "/" },
          { name: title.split(" | ")[0], url: path },
        ])]),
      ],
    };
    const listing = path === "/stores" ? storeLinks : productLinks;
    const bootstrapCatalogue = escapeHtml(JSON.stringify({ stores, products, media }));
    bodyHtml = `<template id="kompo-bootstrap-catalogue">${bootstrapCatalogue}</template><section class="page-hero seo-server-shell"><div><p class="eyebrow">KOMPO NATION</p><h1>${escapeHtml(title.split(" | ")[0])}</h1><p>${escapeHtml(description)}</p></div></section><section class="content-section seo-server-products">${listing || "<p>New releases are coming soon.</p>"}</section>${path === "/" ? `<section class="content-section"><h2>Explore every independent store</h2><div class="seo-server-products">${storeLinks}</div></section>` : ""}`;
  } else if (path === "/contact") {
    structuredData = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "ContactPage", name: "Contact Kompo Nation", description, url: `${SITE_URL}/contact` },
        { "@type": "Organization", name: "Kompo Nation", url: SITE_URL, email: "mailto:ramashilokgotsofatso@gmail.com", telephone: "+27727718727", contactPoint: { "@type": "ContactPoint", contactType: "customer and vendor support", email: "ramashilokgotsofatso@gmail.com", telephone: "+27727718727", areaServed: "ZA", availableLanguage: "English" } },
        breadcrumbList([{ name: "Home", url: "/" }, { name: "Contact", url: "/contact" }]),
      ],
    };
    bodyHtml = `<section class="page-hero seo-server-shell"><div><p class="eyebrow">KOMPO NATION</p><h1>Contact Kompo Nation</h1><p>${escapeHtml(description)}</p></div></section><section class="content-section seo-server-products"><article><h2>Email support</h2><p><a href="mailto:ramashilokgotsofatso@gmail.com">ramashilokgotsofatso@gmail.com</a></p></article><article><h2>Phone and WhatsApp</h2><p><a href="tel:+27727718727">072 771 8727</a></p></article></section>`;
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
