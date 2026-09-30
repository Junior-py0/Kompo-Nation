# Frontend guide

`site/` is the static application published by Netlify. It does not use a build step or a framework: HTML loads classic browser scripts directly, and JavaScript creates the changing content. This makes edits approachable, but script order and the `data-*` hooks are important.

## Page shells and load order

| File | Purpose | Loads |
| --- | --- | --- |
| `site/index.html` | Public storefront shell and the server-visible home/SEO fallback. The `#app` element is replaced by `app.js`. | `boot.js` before paint; then Supabase CDN → `config.js` → `catalog.js` → `supabase.js` → `app.js`. |
| `site/account.html` | Static fallback/shell for customer account routes. The same storefront runtime takes over. | `config.js`, `catalog.js`, `supabase.js`, `app.js`. |
| `site/login.html` | Sign-in/sign-up form with a redirect target in `?next=`. | Supabase CDN → `config.js` → `supabase.js` → `auth.js`. |
| `site/admin.html` | Protected admin portal shell. Its navigation exposes stores, products, discounts, orders, settlements, cancellations, returns, and settings. | Supabase CDN → `config.js` → `supabase.js` → `portal.js`. |
| `site/vendor.html` | Protected vendor portal shell. It shares `portal.js` but presents vendor-appropriate navigation. | Supabase CDN → `config.js` → `supabase.js` → `portal.js`. |
| `site/google2060ed331d66fb97.html` | Google Search Console verification file for the published `site/` directory. Do not alter its content. |

The root-level `google2060ed331d66fb97.html` is a second verification file kept for hosts that serve from the repository root. It is documented in [deployment-and-files.md](deployment-and-files.md).

## Browser JavaScript

### `site/config.js` — public, environment-specific browser settings

Defines immutable `window.KOMPO_CONFIG` containing `CONFIG` and `isSupabaseConfigured()`.

- `siteName`, `siteUrl`, `currency`, and `locale` determine labels, links, money format, and SEO URL creation.
- `supabaseUrl` and `supabasePublishableKey` initialize the public client. Publishable keys are designed for browser use; row-level security still protects the data.
- `functionsBase` selects the live Supabase Edge Function base URL.
- `fallbackDeliveryCents` is used only when the application needs a default delivery amount.

Edit this file when switching the public site URL or Supabase project. Update `functions/_seo.js` at the same time because that optional worker keeps its own public constants. Never add private keys here.

### `site/catalog.js` — offline/fallback catalogue and ranking

Defines `window.KOMPO_CATALOG`.

- `LOCAL_STORES` gives the storefront a small fallback store list when live data is unavailable.
- `LOCAL_PRODUCTS` is currently empty, so a disconnected site has no purchasable fallback products.
- `rankProducts()` accepts only active, in-stock products and favours sales, stock, and scarce products.
- `rankStores()` excludes suspended/unfeatured stores and sorts explicit features before sales.

This file is a graceful-degradation fixture, not the live product database. Change it only when the disconnected preview should change.

### `site/supabase.js` — one browser-facing Supabase gateway

Initializes the CDN client only if `isSupabaseConfigured()` succeeds and exposes `window.KOMPO_SUPABASE`.

| Export | Used for |
| --- | --- |
| `supabase` | Direct table, storage, and RPC calls from the storefront and portals. It is `null` in an unconfigured local preview. |
| `getSession`, `signIn`, `signUp`, `signOut` | Auth session lifecycle; sign-up also writes profile/terms data expected by the database. |
| `loadRemoteCatalogue` | Fetches vendors, products/variants, and product media, then normalizes them into the shape used by `app.js`. |
| `loadWishlist`, `toggleRemoteWishlist` | Syncs a signed-in customer wishlist through the `toggle_wishlist` RPC. |
| `authHeader` | Supplies a bearer token for authenticated Edge Function calls. |

Keep data-shape normalization here rather than scattering Supabase row handling through UI files. Any new browser table/RPC access should respect the existing RLS model.

### `site/boot.js` — no-flash marker

Runs before the first paint and adds `has-js` to `<html>`. CSS uses this to hide the SEO fallback once JavaScript is taking over. It must remain tiny and first in `index.html`.

### `site/auth.js` — login and registration form controller

Controls the form in `login.html`.

- `safeNext()` accepts only same-site paths, preventing an open-redirect through `?next=`.
- `setMode()` toggles sign-in/sign-up UI and required fields.
- Sign-up requires terms acceptance and passes version `1.0` plus an ISO acceptance timestamp to `signUp()`.
- On email-confirmation projects it explains the pending-confirmation state instead of treating it as an error.
- Local `file:` previews use `*.html`/hash routes; deployed users use clean paths.

If new registration fields are added, update this file, `login.html`, the `signUp` helper, and the profile/database contract together.

### `site/app.js` — customer storefront application

This is the main customer application (5,000+ lines). It owns public routing, dynamic HTML, customer state, checkout, account screens, and delegated interaction handlers. It is split by labelled sections; use the table below instead of treating it as a single undifferentiated file.

| Section / approximate lines | Responsibilities | Edit here when… |
| --- | --- | --- |
| 1–269: state and safe formatters | `state`, localStorage reads/writes, money/HTML formatting, routes, SEO metadata, JSON-LD, toasts, product image/badge helpers. | Changing cart/wishlist persistence, URL handling, structured data, product visual rules, or shared formatting. |
| 270–534: reusable components | Product cards/grids, store cards, galleries, image rotation. | Changing reusable catalogue card markup or product gallery behaviour. |
| 535–1266: public renderers | Home, shop, stores, one store, one product, about, information/legal content. | Adding a public page or changing catalogue/store/product presentation. |
| 1267–2582: cart and checkout | Cart mutations, discount-code preview/application, address/contact review, shipping quotes, payment handoff, collection rules. | Editing customer purchase flow. Preserve cents, quote expiry, and server-side validation. |
| 2583–3406: customer account | Orders, addresses, cancellation and return controls, return-payment flow. | Editing post-purchase customer screens. Return actions call the `return-logistics` Edge Function and return RPCs. |
| 3407–3506: small route views | Wishlist, payment success/cancelled, and not-found UI. | Editing these special destination pages. |
| 3507–3836: global interactions | Header/search/mobile menu, cart buttons, subscription, delegated clicks/submits. | Wiring a new `data-*` action after adding dynamic markup. |
| 3837–end: router/startup | Legal-page restoration, `renderRoute()`, data loading, auth/wishlist synchronization, error fallback. | Adding/changing URL routes or startup loading behaviour. |

#### How `app.js` works

1. It starts from fallback `LOCAL_*` catalogue data and localStorage cart/wishlist state.
2. `start()` loads the remote catalogue when configuration is valid, refreshes UI counts, then calls `renderRoute()`.
3. `renderRoute()` maps clean URLs such as `/shop`, `/store/:slug`, `/product/:slug`, `/cart`, `/checkout`, `/account`, `/terms`, `/privacy`, `/returns`, and payment return URLs to renderer functions.
4. Renderers replace `#app` content. Events for short-lived rendered markup are attached locally or delegated through `setupDelegatedEvents()`.
5. Signed-in users receive a remote wishlist after the first render; cart remains local until checkout.

When adding a customer feature, keep display-only calculations in this file, but enforce price, stock, access, and payment decisions in SQL/Edge Functions. The checkout code deliberately rechecks prices, stock, discounts, and signed shipping quotes server-side.

### `site/portal.js` — shared admin and vendor management portal

This is the main management file (about 2,500 lines) for both `admin.html` and `vendor.html`. `document.body.dataset.portal` decides the active area. The same source reduces duplication, so every new action must explicitly consider whether an admin, a vendor, or both may perform it.

| Section / approximate lines | Responsibilities | Key integration points |
| --- | --- | --- |
| 1–92: authorization | Reads the session, `platform_roles`, and active `vendor_members`; denies unauthorized access before revealing the shell. | Admin means `owner`/`admin`; vendor access requires an active membership. |
| 93–151: shared shell | Mobile sidebar, active view, store switcher, sign-out, and delegated click/change/submit listeners. | `#portal-content` is replaced for each view. |
| 152–179: overview | Sales/order summary cards scoped to the selected vendor or all stores. | `vendor_orders`, `vendors`. |
| 180–577: store management | Admin store list/create/edit/status controls; vendor team view and membership management. | `vendors`, `vendor_members`, `vendor_private_settings`, admin RPCs. |
| 578–803: product management | Product/variant forms, image checks/upload to `product-images`, stock actions, archive/delete. | `products`, `product_variants`, `product_media`, storage policies/RPCs. |
| 804–938: discount codes | Store-scoped code list, create/update/disable controls. | `discount_codes` and its migration/RPC rules. |
| 939–1346: order management | Vendor-order lists, line-item display, fulfilment progression, courier booking/collection details. | `vendor_orders`, `orders`, `order_items`, shipment functions/RPCs. |
| 1347–1420: settlements | Admin-only platform collection settlement dashboard and paid markers. | `admin_settlement_dashboard`, payout/courier-settlement tables. |
| 1421–1443: return management | Decisions, reverse/exchange preparation, receipt, refund confirmation, exchange close. | return RPCs plus `return-logistics` Edge Function. |
| 1444–1746: settings/information | Store collection/contact/package settings and vendor guidance. | `vendor_private_settings`, `marketplace_settings`. |
| 1747–2291: event handlers | All button actions and form submissions emitted by portal views. | Add new action branches here; preserve role/scope checks. |
| 2292–2493: vendor terms gate | Blocks vendor work until the current terms acceptance is recorded. | Terms schema/RPCs. |
| 2494–end: startup | Authorizes, reveals UI, wires shell, renders the initial view. | Do not bypass `authorize()`. |

`portal.js` uses event delegation on `#portal-content`. A new dynamically rendered button should have a unique `data-*` attribute and a corresponding branch in `handlePortalClick()`; a form is handled by `handlePortalSubmit()`. Escape strings placed in template HTML with `escapeHtml()`. Keep `customerPriceCents()` consistent with the SQL/SEO equivalent if you change the pricing rule.

### `site/styles.css` — complete visual system

One stylesheet serves storefront, authentication, portals, legal/returns UI, and responsive layouts. Its first 1,100 lines have numbered sections: design tokens/reset; controls; header; hero; home sections; catalogue/store/product; cart/checkout/account; search/toasts; footer; auth; portal; loading/motion; responsive. Later labelled blocks add focused changes for product management, vendor teams, packaging, checkout, terms, returns, brand assets, mobile navigation, and discounts.

Prefer the closest existing section. Do not use random overrides just because they work at one screen size; add a labelled feature block only when the rule genuinely spans an isolated feature. Test desktop and mobile because this file contains several narrow-screen corrections.

## Static site routing and policy files

| File | What it controls |
| --- | --- |
| `site/_redirects` | Static-host fallback route aliases for storefront paths such as product/store deep links. It supports local/static hosting behaviour; Netlify also has redirects in `netlify.toml`. Keep route intent aligned in both places. |
| `site/_headers` | Per-path cache and security headers for static hosting. It gives immutable caching to versioned/static assets and controlled cache behaviour to app files. Netlify additionally declares site-wide security headers in `netlify.toml`. |
| `site/_routes.json` | Cloudflare Pages function routing: only paths that need the SEO worker are included. |
| `site/robots.txt` | Crawler rules and sitemap location. Update if the canonical host changes. |
| `site/sitemap.xml` | Static sitemap fallback. The Cloudflare function can generate a live version when that runtime is deployed. |

## Assets

`site/assets/` contains the public logo, mark, favicon, and campaign images. The source references `campaign-kompo-apparel-v2.png` as the default social/hero image and uses the transparent logo/mark in page chrome. Older campaign files remain tracked because public content or database records may still refer to them; do not remove an image based only on a JavaScript search.

