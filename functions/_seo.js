export const SITE_URL = "https://komponation.co.za";
export const SUPABASE_URL = "https://vfifwtqbsdaxsikjpvku.supabase.co";
export const SUPABASE_KEY = "sb_publishable_AaLevppY9LCW1tRIPoEjSw_SGgy_SDQ";

export function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

export function escapeXml(value = "") {
  return escapeHtml(value);
}

export function absoluteUrl(value = "") {
  if (!value) return "";
  try { return new URL(value, SITE_URL).href; }
  catch (_) { return ""; }
}

export function compactDescription(value = "", maximum = 160) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maximum) return text;
  const shortened = text.slice(0, maximum - 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || text.slice(0, maximum - 1).trim()}…`;
}

export function breadcrumbList(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.url),
    })),
  };
}

export function customerPriceCents(baseCents, markupRateBps = 1000) {
  const base = Math.max(0, Math.round(Number(baseCents) || 0));
  const rate = Math.max(0, Number(markupRateBps) || 0);
  const markedUp = base * (10000 + rate) / 10000;
  const charmPrice = Math.round(markedUp / 5000) * 5000 - 100;
  return Math.max(base, charmPrice);
}

export function storeAliases(name = "", slug = "") {
  const compact = `${name} ${slug}`.toLowerCase().replace(/[^a-z0-9]/g, "");
  return compact.includes("letwosix") || compact.includes("le26")
    ? ["Le Two Six", "Le 26"]
    : [];
}

export function jsonLd(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export async function supabaseRows(table, parameters = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
  return response.json();
}

export async function allSupabaseRows(table, parameters = {}) {
  const rows = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    const page = await supabaseRows(table, { ...parameters, limit: pageSize, offset });
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export async function storefrontDocument(context, {
  title,
  description,
  canonical,
  image,
  imageAlt,
  type = "website",
  structuredData,
  bodyHtml,
  status = 200,
}) {
  const assetUrl = new URL("/", context.request.url);
  const asset = await context.env.ASSETS.fetch(new Request(assetUrl, context.request));
  let html = await asset.text();
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  const safeCanonical = escapeHtml(absoluteUrl(canonical));
  const safeImage = escapeHtml(absoluteUrl(image || "/assets/campaign-kompo-apparel-v2.png"));
  const safeImageAlt = escapeHtml(imageAlt || `${title} on Kompo Nation`);
  const robots = status >= 400
    ? "noindex, nofollow"
    : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1";

  html = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${safeTitle}</title>`)
    .replace(/\s*<script\s+id=["']kompo-structured-data["'][^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/\s*<meta\s+name=["'](?:description|robots|twitter:[^"']+)["'][^>]*>/gi, "")
    .replace(/\s*<meta\s+property=["']og:[^"']+["'][^>]*>/gi, "")
    .replace(/\s*<link\s+rel=["']canonical["'][^>]*>/gi, "");

  const socialTags = `
  <meta name="description" content="${safeDescription}">
  <meta name="robots" content="${robots}">
  <link rel="canonical" href="${safeCanonical}">
  <link rel="alternate" hreflang="en-ZA" href="${safeCanonical}">
  <link rel="alternate" hreflang="x-default" href="${safeCanonical}">
  <meta property="og:site_name" content="Kompo Nation">
  <meta property="og:locale" content="en_ZA">
  <meta property="og:type" content="${escapeHtml(type)}">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeCanonical}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:image:alt" content="${safeImageAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImage}">
  <meta name="twitter:image:alt" content="${safeImageAlt}">
  <script id="kompo-structured-data" type="application/ld+json">${jsonLd(structuredData)}</script>`;
  html = html.replace("</head>", `${socialTags}\n</head>`);

  if (bodyHtml) {
    html = html.replace(
      /<main id="app" tabindex="-1">[\s\S]*?<\/main>/i,
      `<main id="app" tabindex="-1"><div class="seo-server-content">${bodyHtml}</div><section class="app-loading-shell" aria-label="Loading Kompo Nation"><span class="loading-orbit"></span><span>Opening the nation…</span></section></main>`,
    );
  }

  const headers = new Headers(asset.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://sandbox.payfast.co.za https://www.payfast.co.za; upgrade-insecure-requests");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.delete("Content-Length");
  return new Response(html, { status, headers });
}
