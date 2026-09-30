# Kompo Nation

Kompo Nation is a South African fashion marketplace with a public storefront, customer account area, vendor portal, admin portal, Supabase backend, payment integrations, and courier/return workflows.

## Documentation

Start with [the technical guide](docs/README.md). It explains the architecture and links to detailed guides for the frontend, database/migrations, server integrations, and deployment/file structure.

## Repository layout

| Folder/file | Purpose |
| --- | --- |
| `site/` | Published browser application and public assets. |
| `supabase/` | Database migrations, Edge Functions, and Supabase project configuration. |
| `netlify/` | Netlify scheduled/webhook functions. |
| `functions/` | Optional Cloudflare Pages SEO-rendering functions. |
| `docs/` | Maintainer documentation. |
| `netlify.toml` | Netlify build, routes, schedules, and security policy. |
| `PAYMENTS.md` | Payment-provider activation and go-live runbook. |

Do not commit local caches, generated exports, dependency folders, or secret environment files. The repository `.gitignore` lists the supported local-only paths.

