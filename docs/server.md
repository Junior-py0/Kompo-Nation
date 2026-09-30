# Server and integrations guide

The browser uses the Supabase Edge Function URL declared in `site/config.js`. These functions run with Deno. They are responsible for security-sensitive operations that must not be trusted to the browser: payment initiation/verification, delivery quotes/bookings, authenticated return actions, provider webhooks, and scheduled maintenance.

## Shared Edge Function modules

| File | Purpose | Edit carefully because… |
| --- | --- | --- |
| `supabase/functions/_shared/runtime.ts` | Shared CORS responses, JSON errors, required-environment-variable lookup, raw-body handling, Supabase REST/RPC calls, authenticated-user lookup, membership checks, and HMAC quote signing/verification. | Most Edge Functions import it. Changing response, auth, quote, or CORS rules changes several APIs at once. |
| `supabase/functions/_shared/payments.ts` | Selects the configured provider (`paystack`, `stitch`, or `yoco`) and initializes provider-specific payments. It also retrieves Stitch payment status. | All provider secrets live in the environment; preserve provider amount/reference handling and redirect URLs. |
| `supabase/functions/_shared/payments_test.ts` | Deno test coverage for payment-provider selection and initialization requests. | It is test code, not a deployed endpoint; keep it alongside payment changes. |

### `runtime.ts` contract

`required()` fails closed for missing secrets. `corsHeaders()`/`preflight()` accepts the configured site/CORS origins. `supabaseRequest()` uses the service role by default but can use a customer bearer token where RLS must apply. `authenticatedUser()` validates the bearer token and returns its user. Quote values are canonicalized and signed using `QUOTE_SIGNING_SECRET`; do not change their fields/order unless every quote producer and verifier is changed together.

## Supabase Edge endpoints

Every function folder has an `index.ts` entrypoint and a small `deno.json`. The JSON files import `npm:@supabase/supabase-js@2`; they are deployment configuration, not separate application logic.

| Endpoint folder | Request / trigger | What `index.ts` does |
| --- | --- | --- |
| `create-checkout/` | Authenticated customer POST from checkout. | Validates basket/address/contact data, protects stock/reservations, verifies delivery quotes, creates order/payment records, applies discounts/liabilities, and starts the configured payment provider. This is the authoritative checkout path. |
| `shipping-quote/` | Customer checkout POST. | Groups cart lines by vendor, validates weights/standard packages and address fields, fetches Bob Go rates or allowed fallback delivery, applies markups, signs the selected quotes, and returns quote expiry data. |
| `book-shipment/` | Authenticated vendor/admin POST. | Confirms the caller can see the vendor order, builds a Bob Go shipment from store/customer/package data, books it, persists tracking/shipment state, and advances fulfilment. |
| `bobgo-webhook/` | Bob Go delivery callback with webhook token. | De-duplicates callbacks, optionally fetches/verifies provider shipment data, maps provider statuses, updates normal or return shipments, and advances related fulfilment/return state. |
| `release-reservations/` | Scheduled/internal maintenance. | Releases expired stock reservations, reconciles open Bob Go shipments, and ensures required courier webhook subscriptions exist. |
| `process-notifications/` | Scheduled/internal maintenance. | Processes pending rows in `notification_outbox`, uses Resend-compatible email API settings, then records attempts, sent time, or retry/failure state. |
| `return-logistics/` | Authenticated customer/vendor/admin POST; one internal action. | Quotes and books reverse/exchange legs, charges the customer when responsible, creates vendor liabilities when appropriate, and exposes `prepare-reverse`, `prepare-exchange`, `initialize-payment`, and internal `book-paid-leg` actions. |
| `paystack-webhook/` | Paystack callback. | Verifies signatures and provider transaction data, de-duplicates events, finalizes normal or return payments, starts a paid return leg, and settles vendor-liability recoveries. |
| `stitch-webhook/` | Stitch/Svix callback. | Verifies the Svix signature, recognizes completed payment requests, finalizes normal or return payments, triggers paid-return booking, and settles recoveries. |
| `yoco-webhook/` | Yoco callback. | Verifies Yoco HMAC signatures, handles normal and return payments, calls return booking for paid legs, records provider events, and finalizes payment data. |

### Edge Function edit checklist

1. Preserve `OPTIONS`/CORS handling and reject unsupported methods.
2. Authenticate a user before user-facing actions; reserve service-role/internal headers for server-to-server work only.
3. Treat all IDs, prices, quote expiry values, provider callbacks, and browser input as untrusted.
4. For a new endpoint, add its function configuration to `supabase/config.toml`; use a matching `deno.json` when it imports npm packages.
5. Test the provider sandbox/webhook path and the failure/retry path before deploying.

## Supabase configuration

`supabase/config.toml` is the Supabase CLI project configuration. It includes local service ports, Auth settings, storage/development defaults, and Edge Function declarations at the bottom. The declarations set each deployed entrypoint and `verify_jwt = false`; each function therefore performs its own auth/secret validation. Do not read `verify_jwt = false` as “unprotected.”

The function sections presently configure `shipping-quote`, `book-shipment`, `bobgo-webhook`, `release-reservations`, `process-notifications`, `create-checkout`, `paystack-webhook`, `stitch-webhook`, and `yoco-webhook`. `return-logistics` uses the normal discovered function layout; ensure it is included in the deployment command when deploying functions manually.

## Required environment variables

Do not commit values for these variables. Environment naming is derived from the code; make the actual deployment configuration the source of truth.

| Area | Variables used |
| --- | --- |
| Supabase runtime | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and public/publishable key variants read by the shared runtime. |
| Browser/return CORS | `SITE_URL`, optionally `CORS_ORIGINS`. |
| Quote integrity | `QUOTE_SIGNING_SECRET`. |
| Payment selection | `PAYMENT_PROVIDER` (`paystack` default), and provider enable/credential variables. |
| Paystack | `PAYSTACK_SECRET_KEY`, `PAYSTACK_WEBHOOK_SECRET`/signature configuration used by webhook code. |
| Stitch | `STITCH_CLIENT_ID`, `STITCH_CLIENT_SECRET`, optional `STITCH_MERCHANT_ID`, `STITCH_WEBHOOK_SECRET`. |
| Yoco | `YOCO_SECRET_KEY`, `YOCO_WEBHOOK_SECRET`. |
| Courier | `BOBGO_API_TOKEN`, optional `BOBGO_API_BASE_URL`, `BOBGO_WEBHOOK_SECRET`; shipping functions also read delivery fallback/markup settings. |
| Mail | `EMAIL_API_KEY`, `EMAIL_FROM`, optional `EMAIL_API_BASE_URL`. |
| Internal scheduled calls | `CRON_SECRET`. |

Search the target function before adding or renaming a variable; security code intentionally fails when a required value is absent.

## Netlify functions

`netlify/functions/` is a CommonJS/Node-compatible implementation used by Netlify. `netlify.toml` explicitly deploys this directory and schedules two handlers. Do not remove it simply because the browser calls Supabase directly.

| File | Purpose |
| --- | --- |
| `netlify/functions/lib/runtime.js` | Node equivalent of common helpers: required variables, JSON replies, raw event body, Supabase REST/RPC calls, authenticated user lookup, and signed shipping quote verification. |
| `netlify/functions/create-checkout.js` | Netlify checkout alternative: validates the session, calls checkout RPC, signs PayFast data, and responds with payment form data. |
| `netlify/functions/payfast-itn.js` | PayFast ITN receiver: validates provider origin/signature with PayFast, de-duplicates events, and finalizes payment through an RPC. |
| `netlify/functions/shipping-quote.js` | Netlify shipping quote alternative: loads products, groups shipping, calls Bob Go or permitted fixed delivery, and signs quotes. |
| `netlify/functions/book-shipment.js` | Netlify vendor shipment-booking alternative using Bob Go, then persists tracking and fulfilment state. |
| `netlify/functions/bobgo-webhook.js` | Netlify Bob Go status receiver for normal shipments. |
| `netlify/functions/release-reservations.js` | Calls `release_expired_reservations`; scheduled every 10 minutes by `netlify.toml`. |
| `netlify/functions/process-notifications.js` | Sends/updates notification-outbox email rows; scheduled every 5 minutes by `netlify.toml`. |

The Netlify functions use `process.env`, whereas Supabase functions use `Deno.env`. Their business logic overlaps, but their runtimes and deployment triggers differ. If consolidating these later, first move the schedules/webhooks and test a complete payment and courier lifecycle.

## Cloudflare Pages SEO functions

The root `functions/` directory is a separate Pages Functions-style SEO adapter. It has no Netlify build declaration; it runs only if this repository is deployed to a compatible Pages runtime.

| File | Purpose |
| --- | --- |
| `functions/_seo.js` | Shared site/Supabase constants, escaping, canonical URL/description helpers, markup pricing, store aliases, paginated public Supabase reads, and HTML-document injection with security/cache headers. |
| `functions/[[path]].js` | Catch-all server renderer for public non-product/store paths. It builds a canonical document, metadata, structured data, and server HTML before the client app hydrates. |
| `functions/product/[slug].js` | Loads one public product and media from Supabase, then renders product-specific SEO metadata, JSON-LD, and fallback HTML. |
| `functions/store/[slug].js` | Loads a public store/catalogue view and renders store-specific SEO metadata and fallback HTML. |
| `functions/sitemap.xml.js` | Generates a current XML sitemap from public stores/products. |

This layer uses only the publishable key and public catalogue queries. Keep escaping in place when editing HTML templates, and update the duplicate public host/project values if `site/config.js` changes.

