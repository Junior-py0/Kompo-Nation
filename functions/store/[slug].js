import {
  SITE_URL,
  breadcrumbList,
  compactDescription,
  escapeHtml,
  storefrontDocument,
  storeAliases,
  supabaseRows,
} from "../_seo.js";

export async function onRequest(context) {
  const slug = String(context.params.slug || "").trim().toLowerCase();
  const [store] = await supabaseRows("vendors", {
    select: "id,slug,business_name,description,short_description,mark,status,updated_at",
    slug: `eq.${slug}`,
    status: "eq.active",
    retired_at: "is.null",
    limit: 1,
  });

  if (!store) {
    return storefrontDocument(context, {
      title: "Store not found | Kompo Nation",
      description: "This Kompo Nation store is no longer available.",
      canonical: `/store/${encodeURIComponent(slug)}`,
      structuredData: { "@context": "https://schema.org", "@type": "WebPage", name: "Store not found" },
      bodyHtml: '<section class="empty-state glass"><h1>Store not found.</h1><p>This store is no longer available.</p><a class="primary-button" href="/stores">Browse active stores</a></section>',
      status: 404,
    });
  }

  const products = await supabaseRows("products", {
    select: "id,slug,name,description,category,updated_at",
    vendor_id: `eq.${store.id}`,
    status: "eq.active",
    order: "updated_at.desc",
  });
  const aliases = storeAliases(store.business_name, store.slug);
  const canonical = `${SITE_URL}/store/${encodeURIComponent(store.slug)}`;
  const aliasCopy = aliases.length ? ` Also known as ${aliases.join(" and ")}.` : "";
  const description = compactDescription(`${store.short_description || store.description}${aliasCopy} Shop ${store.business_name} clothing and new releases on Kompo Nation.`);
  const itemList = products.map((product, index) => ({
    "@type": "ListItem",
    position: index + 1,
    url: `${SITE_URL}/product/${encodeURIComponent(product.slug)}`,
    name: product.name,
  }));
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Brand",
        "@id": `${canonical}#brand`,
        name: store.business_name,
        ...(aliases.length ? { alternateName: aliases } : {}),
        description: store.description,
        url: canonical,
      },
      {
        "@type": "CollectionPage",
        "@id": `${canonical}#page`,
        name: `${store.business_name} store on Kompo Nation`,
        description,
        url: canonical,
        mainEntity: { "@type": "ItemList", numberOfItems: itemList.length, itemListElement: itemList },
      },
      breadcrumbList([
        { name: "Home", url: "/" },
        { name: "Stores", url: "/stores" },
        { name: store.business_name, url: canonical },
      ]),
    ],
  };
  const productLinks = products.length
    ? products.map((product) => `<article class="dashboard-panel"><p class="eyebrow">${escapeHtml(product.category)}</p><h2><a href="/product/${encodeURIComponent(product.slug)}">${escapeHtml(product.name)}</a></h2><p>${escapeHtml(product.description)}</p></article>`).join("")
    : "<p>New products are coming soon.</p>";
  const bodyHtml = `<section class="page-hero seo-server-shell"><div><p class="eyebrow">KOMPO NATION STORE</p><h1>${escapeHtml(store.business_name)}</h1><p>${escapeHtml(store.description)}</p></div><strong>${products.length} product${products.length === 1 ? "" : "s"}</strong></section><section class="content-section seo-server-products">${productLinks}</section>`;

  return storefrontDocument(context, {
    title: `${store.business_name} Clothing & Products | Kompo Nation`,
    description,
    canonical,
    structuredData,
    bodyHtml,
  });
}
