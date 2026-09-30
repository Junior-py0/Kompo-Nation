import { SITE_URL, allSupabaseRows, escapeXml } from "./_seo.js";

function entry(location, lastModified, priority, image) {
  return `<url><loc>${escapeXml(location)}</loc>${lastModified ? `<lastmod>${escapeXml(new Date(lastModified).toISOString())}</lastmod>` : ""}<changefreq>${priority >= .8 ? "daily" : "weekly"}</changefreq><priority>${priority.toFixed(1)}</priority>${image ? `<image:image><image:loc>${escapeXml(image)}</image:loc></image:image>` : ""}</url>`;
}

export async function onRequest() {
  try {
    const [stores, products, media] = await Promise.all([
      allSupabaseRows("vendors", {
        select: "id,slug,updated_at",
        status: "eq.active",
        retired_at: "is.null",
        order: "updated_at.desc",
      }),
      allSupabaseRows("products", {
        select: "id,slug,updated_at,vendors!inner(status,retired_at)",
        status: "eq.active",
        "vendors.status": "eq.active",
        "vendors.retired_at": "is.null",
        order: "updated_at.desc",
      }),
      allSupabaseRows("product_media", {
        select: "product_id,public_url,sort_order,created_at",
        order: "sort_order.asc,created_at.asc",
      }),
    ]);
    const firstImage = new Map();
    media.forEach((item) => {
      if (item.public_url && !firstImage.has(item.product_id)) firstImage.set(item.product_id, item.public_url);
    });
    const staticPages = [
      ["/", 1], ["/shop", .9], ["/stores", .9], ["/about", .7],
      ["/delivery", .6], ["/returns", .6], ["/contact", .6],
      ["/privacy", .4], ["/terms", .4],
    ];
    const urls = [
      ...staticPages.map(([path, priority]) => entry(`${SITE_URL}${path}`, null, priority)),
      ...stores.map((store) => entry(`${SITE_URL}/store/${encodeURIComponent(store.slug)}`, store.updated_at, .8)),
      ...products.map((product) => entry(`${SITE_URL}/product/${encodeURIComponent(product.slug)}`, product.updated_at, .8, firstImage.get(product.id))),
    ];
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join("\n")}\n</urlset>`;
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=0, s-maxage=900, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    return new Response(`Sitemap generation failed: ${error.message}`, { status: 503 });
  }
}
