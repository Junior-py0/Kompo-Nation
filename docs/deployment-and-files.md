# Deployment, operations, and remaining file guide

This page documents maintained files not covered by the frontend, server, or database guides and records the repository-cleanliness policy.

## Deployment files

### `netlify.toml`

This is the Netlify deployment contract.

- Publishes `site/` and deploys `netlify/functions/` using the `esbuild` Node bundler.
- Schedules `release-reservations` every 10 minutes and `process-notifications` every 5 minutes.
- Maps clean `/admin`, `/vendor`, and `/login` paths to their static HTML shells.
- Explicitly blocks accidental publication of `/netlify/*`, `database.sql`, and `seed.sql`, then sends other client-side routes to `index.html`.
- Sets security headers: HSTS, no-sniff, referrer policy, permissions policy, frame denial, cross-origin opener policy, and a Content Security Policy permitting the known Supabase, jsDelivr, Google Fonts, and PayFast sources.
- Marks portal/login paths as `noindex, nofollow`.

Change this file when adding a Netlify function schedule, clean route, host-level security requirement, or newly required trusted domain. Test routing and CSP after any change; an overly restrictive policy can make the browser application look broken.

### `scripts/activate-yoco.ps1`

An operator helper for switching the configured deployment to Yoco. It is a PowerShell script, intended to guide/automate environment activation rather than run in the browser or production function. Review the environment names and run it only in the intended deployment context. Keep secrets out of its output and out of Git.

### `PAYMENTS.md`

Existing payment-operations runbook. It documents default/rollback behaviour, activating Stitch/Yoco, marketplace settlement safety, and go-live smoke tests. It complements [server.md](server.md): `PAYMENTS.md` explains the operational procedure, while `server.md` explains the source files that implement it.

### `supabase/.gitignore`

Supabase-local ignore policy. It prevents Supabase CLI local/generated state from entering source control. Leave it in place when using the local Supabase stack.

## Public assets and verification

| Path | Purpose |
| --- | --- |
| `site/assets/favicon.svg` | Browser tab icon. |
| `site/assets/kompo-nation-logo-v1.png` | Opaque/light-background logo variant. |
| `site/assets/kompo-nation-logo-transparent-v2.png` | Transparent logo used in current public and portal page chrome. |
| `site/assets/kompo-nation-mark-v1.png` | Opaque compact brand mark. |
| `site/assets/kompo-nation-mark-transparent-v2.png` | Transparent compact mark used for favicons/page chrome. |
| `site/assets/campaign-kompo-apparel-v2.png` | Current default social-card and main campaign image. |
| `site/assets/campaign.png`, `campaign-20260825.png`, `campaign-crew-v4.png` | Earlier campaign assets retained for content/database compatibility. Confirm no CMS/database URLs use them before removing. |
| `site/google2060ed331d66fb97.html` | Google Search Console verification at the actual Netlify publish root. |
| `google2060ed331d66fb97.html` | A root-host verification copy for deployments that publish the repository root. |

Binary assets cannot be explained line-by-line like code, but their role is captured here. Keep filenames stable if external links, product content, or social previews may use them.

## Local-only files

These paths are not application source and must stay out of Git:

| Path/pattern | Why it is ignored |
| --- | --- |
| `.netlify/` | Netlify CLI site state and generated function bundles. |
| `.wrangler/` | Cloudflare/Wrangler local state and temporary worker bundles. |
| `node_modules/` | Reinstallable dependencies; no package manifest is currently committed, so do not treat a local install as source. |
| `_patch_backups/` | Local point-in-time patch backup files. |
| `tmp/` | Temporary renders such as PDF page PNGs. |
| `iot-marketplace-images/` and `iot-marketplace-images.zip` | One-off, unreferenced image-generation/export material—not part of the Kompo site. |
| `.env`, `.env.*`, `*.local` | Local configuration and secrets. Use the host/Supabase secret store for deployed values. |
| OS/editor clutter | `Thumbs.db`, `.DS_Store`, and `.vscode/` workspace state. |

The Git cleanup in this change prevents these artifacts from appearing in repository status after confirming that no maintained source file references them. Existing local binary copies are safe to delete when no longer needed; they are intentionally ignored rather than treated as project source. Deployed source, migrations, and historical public campaign assets are untouched.

## What is intentionally retained

- `functions/`, `netlify/functions/`, and `supabase/functions/` serve different runtimes/triggers; see [server.md](server.md).
- Every historical SQL migration remains because migration history is an audit trail and an environment-rebuild requirement.
- Both Google verification files remain because hosts may expose different publish roots.
- Earlier campaign assets remain because database-held URLs cannot be proved absent by searching the repository.

## Before committing or pushing

1. Run `git status --short` and make sure only intentional source/docs/migration changes are listed.
2. Check `git diff --check` for whitespace mistakes.
3. Run JavaScript syntax checks on browser/Netlify/SEO JavaScript after editing it.
4. Use the payment smoke tests when touching payment, webhook, delivery, reservation, or return code.
5. Never commit an environment file, service role key, provider secret, webhook secret, exported database dump, or local runtime folder.
