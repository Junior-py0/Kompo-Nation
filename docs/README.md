# Kompo Nation technical guide

This folder explains the maintained files in the repository, the way they work together, and the safest place to make common edits. Start here before changing application code.

## What this project is

Kompo Nation is a browser-rendered marketplace. `site/` is the public site published by Netlify. The browser reads public configuration from `site/config.js`, uses Supabase for identity and data, and calls Supabase Edge Functions for payments, shipment quotes, bookings, returns, and webhooks.

There are also two supporting server layers:

- `netlify/functions/` runs Netlify-side scheduled and webhook functions specified in `netlify.toml`.
- `functions/` is a Cloudflare Pages-compatible server-rendering layer for SEO routes. It is kept because it provides product/store HTML and a dynamic sitemap when the project is deployed to that runtime; Netlify does not load this folder from `netlify.toml`.

The database is PostgreSQL in Supabase. `database.sql` is the base schema for a fresh environment. The files in `supabase/migrations/` are chronological, forward-only changes for an existing environment. See [database.md](database.md) before applying either one.

## Read in this order

1. [frontend.md](frontend.md) — public pages, portals, styles, routing, and browser state.
2. [database.md](database.md) — the data model, migrations, permissions, and seed data.
3. [server.md](server.md) — Edge Functions, Netlify functions, SEO workers, secrets, payments, and delivery.
4. [deployment-and-files.md](deployment-and-files.md) — every configuration, asset, documentation, and operational file.

## Runtime map

```text
Visitor
  │
  ├── site/index.html + config.js + catalog.js + supabase.js + app.js
  │     ├── Supabase Auth / PostgREST / Storage
  │     └── Supabase Edge Functions
  │           ├── checkout, shipping, booking, returns
  │           └── payment / courier webhooks
  │
  ├── site/vendor.html or site/admin.html + portal.js
  │     └── Supabase tables, RPC functions, and product-images storage
  │
  └── Netlify (publishes site/)
        └── scheduled notification and reservation jobs

Optional Cloudflare Pages deployment
  └── functions/ renders SEO-aware product, store, generic, and sitemap pages
```

## The safest edit map

| If you want to change… | Start with… | Also check… |
| --- | --- | --- |
| Site name, URL, currency, public Supabase project | `site/config.js` | `functions/_seo.js` has a separate SEO-runtime copy of the public site/Supabase values. |
| Public layout or customer behaviour | `site/app.js` | `site/styles.css`, then `site/index.html` for the permanent shell. |
| Admin/vendor experience | `site/portal.js` | `site/admin.html` or `site/vendor.html`, `site/styles.css`, and the RPC/table it calls. |
| Sign in/sign up fields | `site/auth.js` | `site/login.html`, `site/supabase.js`, the profile/terms schema. |
| Product or store data | Portal UI first | Database migration only if the shape of the data must change. |
| Checkout, payment, courier or return flow | `supabase/functions/` | The relevant migration/RPC and `PAYMENTS.md`; test in sandbox first. |
| Email or scheduled work | `supabase/functions/process-notifications/` and `netlify/functions/process-notifications.js` | `netlify.toml` schedules only the Netlify version. |
| SEO previews, product/store social cards, sitemap | `functions/` | The static site still renders normally without this optional runtime. |
| Colours, typography, responsive styles | `site/styles.css` | It is sectioned by feature; append a focused block only when a nearby section cannot own the rule. |

## Important editing rules

- Browser JavaScript runs as classic scripts, not ES modules. Keep the load order in the HTML files: configuration, catalogue where needed, Supabase wrapper, then the page script.
- `config.js` and the constants in `functions/_seo.js` may contain a Supabase **publishable** key, never a service-role key or any payment/courier secret. Secrets belong only in the deployment environment.
- `app.js` and `portal.js` render most HTML dynamically. When adding an interactive element, add its delegated handler in that same file; an inline `onclick` is the exception, not the pattern.
- Use SQL migrations for production database changes. Do not edit an old migration that may already have been applied.
- Prices are integers in cents. Keep the same unit across UI, database RPCs, and payment calls.
- Keep authorization on the server/database. UI visibility is not an access-control mechanism.
- Before publishing payment, shipping, or migration changes, use the smoke-test guidance in [../PAYMENTS.md](../PAYMENTS.md).

## Source of truth and legacy-looking files

Some functionality is intentionally duplicated because two deploy targets were used during the project:

- `supabase/functions/` is the active API target for the browser: `site/config.js` points `functionsBase` at Supabase.
- `netlify/functions/` remains configured for Netlify cron jobs and some compatible webhook endpoints.
- `functions/` is an alternative Cloudflare Pages SEO runtime. It is not dead code merely because it is not a Netlify function.

Do not delete one of these folders without first changing deployment and confirming no webhook, cron, or alternate host uses it.

## Repository hygiene

The repository deliberately keeps source, migrations, deployment configuration, documented brand assets, and reference documentation. It ignores local dependency installs, host caches, temporary render output, patch backups, and one-off image-export workspaces. See [deployment-and-files.md](deployment-and-files.md#local-only-files) for the exact policy.

