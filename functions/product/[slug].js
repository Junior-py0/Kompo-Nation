import {
  SITE_URL,
  absoluteUrl,
  breadcrumbList,
  compactDescription,
  customerPriceCents,
  escapeHtml,
  storefrontDocument,
  storeAliases,
  supabaseRows,
} from "../_seo.js";

export async function onRequest(context) {
  const slug = String(context.params.slug || "").trim().toLowerCase();
  const [product] = await supabaseRows("products", {
    select: "id,vendor_id,slug,name,description,category,status,updated_at",
    slug: `eq.${slug}`,
    status: "eq.active",
    limit: 1,
  });

  if (!product) {
    return storefrontDocument(context, {
      title: "Product not found | Kompo Nation",
      description: "This Kompo Nation product is no longer available.",
      canonical: `/product/${encodeURIComponent(slug)}`,
      structuredData: { "@context": "https://schema.org", "@type": "WebPage", name: "Product not found" },
      bodyHtml: '<section class="empty-state glass"><h1>Product not found.</h1><p>This item is no longer available.</p><a class="primary-button" href="/shop">Shop available products</a></section>',
      status: 404,
    });
  }

  const [[vendor], variants, media] = await Promise.all([
    supabaseRows("vendors", {
      select: "id,slug,business_name,description,short_description,mark,status,commission_rate_bps,updated_at",
      id: `eq.${product.vendor_id}`,
      status: "eq.active",
      retired_at: "is.null",
      limit: 1,
    }),
    supabaseRows("product_variants", {
      select: "sku,size,colour,price_cents,stock_quantity,active",
      product_id: `eq.${product.id}`,
      active: "eq.true",
      order: "price_cents.asc",
    }),
    supabaseRows("product_media", {
      select: "public_url,alt_text,sort_order",
      product_id: `eq.${product.id}`,
      order: "sort_order.asc,created_at.asc",
    }),
  ]);

  if (!vendor) {
    return storefrontDocument(context, {
      title: "Product not found | Kompo Nation",
      description: "This Kompo Nation product is no longer available.",
      canonical: `/product/${encodeURIComponent(slug)}`,
      structuredData: { "@context": "https://schema.org", "@type": "WebPage", name: "Product not found" },
      status: 404,
    });
  }

  const images = media.map((item) => absoluteUrl(item.public_url)).filter(Boolean);
  const aliases = storeAliases(vendor.business_name, vendor.slug);
  const markupRateBps = Number(vendor.commission_rate_bps ?? 1000);
  const aliasCopy = aliases.length ? `, also searched as ${aliases.join(" and ")}` : "";
  const description = compactDescription(`Shop ${product.name} by ${vendor.business_name}${aliasCopy} on Kompo Nation. ${product.description}`);
  const canonical = `${SITE_URL}/product/${encodeURIComponent(product.slug)}`;
  const offers = variants.map((variant) => ({
    "@type": "Offer",
    url: canonical,
    priceCurrency: "ZAR",
    price: (customerPriceCents(variant.price_cents, markupRateBps) / 100).toFixed(2),
    availability: Number(variant.stock_quantity) > 0
      ? "https://schema.org/InStock"
      : "https://schema.org/OutOfStock",
    itemCondition: "https://schema.org/NewCondition",
    sku: variant.sku,
    name: `${product.name}, ${variant.size}, ${variant.colour}`,
    seller: { "@type": "Organization", name: vendor.business_name, url: `${SITE_URL}/store/${encodeURIComponent(vendor.slug)}` },
  }));
  const productData = {
    "@type": "Product",
    "@id": `${canonical}#product`,
    name: product.name,
    description: product.description,
    category: product.category,
    url: canonical,
    image: images,
    sku: variants[0]?.sku,
    brand: {
      "@type": "Brand",
      name: vendor.business_name,
      ...(aliases.length ? { alternateName: aliases } : {}),
    },
    offers,
  };
  const structuredData = {
    "@context": "https://schema.org",
    "@graph": [
      productData,
      breadcrumbList([
        { name: "Home", url: "/" },
        { name: "Shop", url: "/shop" },
        { name: vendor.business_name, url: `/store/${encodeURIComponent(vendor.slug)}` },
        { name: product.name, url: canonical },
      ]),
    ],
  };
  const lowestPrice = variants.length
    ? Math.min(...variants.map((item) => customerPriceCents(item.price_cents, markupRateBps)))
    : 0;
  const totalStock = variants.reduce((sum, item) => sum + Number(item.stock_quantity), 0);
  const gallery = images.length
    ? images.map((image, index) => `<img src="${escapeHtml(image)}" alt="${escapeHtml(media[index]?.alt_text || `${product.name} product photo`)}" ${index ? 'loading="lazy"' : ""}>`).join("")
    : "";
  const bodyHtml = `<section class="product-detail seo-server-shell">
    <div class="seo-server-gallery">${gallery}</div>
    <article class="product-detail-copy glass">
      <p class="eyebrow"><a href="/store/${encodeURIComponent(vendor.slug)}">${escapeHtml(vendor.business_name)}</a> · ${escapeHtml(product.category)}</p>
      <h1>${escapeHtml(product.name)}</h1>
      ${lowestPrice ? `<p class="product-detail-price">From R${(lowestPrice / 100).toFixed(2)}</p>` : ""}
      <p>${escapeHtml(product.description)}</p>
      <p><strong>${totalStock > 0 ? "Available online" : "Currently sold out"}</strong></p>
      <a class="primary-button" href="/product/${encodeURIComponent(product.slug)}">View product options</a>
    </article>
  </section>`;

  return storefrontDocument(context, {
    title: `${product.name} by ${vendor.business_name} | Kompo Nation`,
    description,
    canonical,
    image: images[0],
    imageAlt: media[0]?.alt_text || `${product.name} by ${vendor.business_name}`,
    type: "product",
    structuredData,
    bodyHtml,
  });
}
