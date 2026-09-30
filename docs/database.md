# Database and migration guide

Kompo Nation uses Supabase PostgreSQL. Authorization is primarily implemented through Row Level Security (RLS) plus stored functions. The browser deliberately calls RPCs for sensitive mutations rather than writing arbitrary table rows.

## Which SQL file to use

| File/location | Meaning | Normal use |
| --- | --- | --- |
| `database.sql` | Baseline schema: tables, views, functions, RLS enablement, policies, and grants. | Create a new empty development database after reviewing its current compatibility with the migrations. |
| `seed.sql` | A small, explicitly named development seed data set. | Local/testing environments only; never assume it is safe for a live store. |
| `supabase/migrations/*.sql` | Ordered, append-only changes made after the baseline. | Apply to an existing database in filename/timestamp order through Supabase migration tooling. |

Do not edit an old applied migration. Create a new timestamped migration. Do not run the baseline and every migration blindly against a production project; the baseline may already include concepts later altered by migrations. First inspect the target migration history.

## Base data model (`database.sql`)

| Area | Tables | What they hold |
| --- | --- | --- |
| Identity and roles | `profiles`, `platform_roles` | Customer profile metadata and platform owner/admin roles. |
| Store membership | `vendors`, `vendor_members`, `vendor_private_settings` | Public store identity, people allowed to operate a store, and private payout/collection/package/contact settings. |
| Catalogue and stock | `products`, `product_variants`, `product_media`, `inventory_movements` | Product records, SKU/size/colour/stock/price variants, ordered media, and stock audit movements. |
| Customer data | `addresses`, `wishlists`, `wishlist_items`, `newsletter_subscribers` | Addresses, saved products, and consented newsletter subscriptions. |
| Commerce | `orders`, `vendor_orders`, `order_items`, `stock_reservations`, `payments` | Customer order header, per-vendor fulfilment units, snapshot line items, checkout stock holds, and payment status/provider payloads. |
| Delivery/operations | `shipments`, `webhook_events`, `returns`, `order_cancellation_requests`, `notification_outbox`, `marketplace_settings`, `audit_logs` | Courier data, idempotency audit trail, returns/cancellations, queued email, editable platform settings, and administrative audit entries. |

### Base functions and views

`database.sql` defines user/profile creation, address limiting, role/membership/order authorization helpers, public product/customer-order views, wishlist/newsletter/product/order/store actions, checkout/payment finalization, and expired-reservation release. It then enables RLS on every public table and installs policies/grants.

The most important rule is that database RPC code—not UI code—must enforce ownership, stock, price, and status transitions. For a new sensitive action, add an RPC or an Edge Function backed by RLS rather than granting broader table writes to `authenticated`.

## Seed data (`seed.sql`)

Creates named development-oriented marketplace/settings data. It is intentionally short and should be read before use. Keep credentials, real customer data, provider tokens, and production operational history out of it.

## Migration catalogue

The following catalogue describes every migration currently present, including newer uncommitted migrations. File ordering is its execution order.

| Migration | Change |
| --- | --- |
| `20260822152214_add_paystack_marketplace.sql` | Adds Paystack marketplace/settlement support and Paystack checkout/finalization RPCs. |
| `20260823001600_step11_management_terminal.sql` | Adds/updates product management, variants, address defaults, vendor-member administration, and product-image storage policies. |
| `20260823002700_step11a3_storefront_cleanup.sql` | Improves admin vendor create/update operations and public storefront product access/storage policy cleanup. |
| `20260823012500_step11b2_vendor_members.sql` | Adds admin assignment/listing operations for vendor-store members. |
| `20260823014000_step11b3_store_network_cleanup.sql` | Refines multi-store/vendor network data, permissions, and related management operations. |
| `20260824181500_standard_shipping_package.sql` | Adds standard store package dimensions/tare/capacity needed for repeatable courier quoting. |
| `20260825143000_terms_acceptance_v1.sql` | Records terms acceptance, adds policies/indexes/RPCs, and updates sign-up enforcement. |
| `20260825161500_return_logistics_v1.sql` | Adds return shipments/payments/liabilities/recovery logic and secure return lifecycle RPCs. |
| `20260827004402_fix_service_role_claim_detection.sql` | Corrects service-role claim detection in permission-sensitive routines. |
| `20260827004914_prelaunch_transaction_cleanup.sql` | Removes/reset prelaunch transactional data before launch. Treat as operational history, not a routine seed. |
| `20260831180000_payment_provider_switch.sql` | Moves payment integration toward the selectable provider model. |
| `20260901110000_manual_settlement_ledger.sql` | Adds manual vendor/courier settlement ledgers and admin settlement dashboard/mark-paid operations. |
| `20260901130000_production_catalog_and_sales_reset.sql` | Performs a production catalogue/sales reset. Operational migration—review carefully before any reuse. |
| `20260901130500_restore_empty_product_image_bucket.sql` | Repairs/recreates an empty product-image storage bucket/policy state. |
| `20260901150000_store_discount_codes.sql` | Adds store discount-code data, validation and application rules. |
| `20260901210000_platform_markup_pricing.sql` | Defines platform markup/customer pricing, checkout flow, and discount integration; it is the pricing source of truth. |
| `20260902170000_charm_price_rounding.sql` | Applies charm-price rounding behaviour. Keep browser/SEO pricing helpers aligned. |
| `20260908193000_separate_store_memberships.sql` | Separates store memberships more clearly from platform admin access. |
| `20260908194500_backfill_legacy_kompo_accounts.sql` | Backfills legacy Kompo account/membership data to the newer model. |
| `20260909120000_custom_embroidery_products.sql` | Adds support for custom-embroidery product data/behaviour. |
| `20260909131500_prevent_duplicate_line_oversell.sql` | Prevents duplicate checkout lines from overselling the same variant. |
| `20260909173000_remove_kaycherlow_test_store.sql` | Removes a specifically named test store and its test data. Do not repurpose this migration for general cleanup. |
| `20260909180000_remove_external_apps_from_kompo.sql` | Removes external-app-related Kompo data/configuration. |

## When changing the schema

1. Write a new migration with a descriptive timestamped name.
2. Make it safe to apply once; use transactions and `if exists`/`if not exists` where appropriate.
3. Add or revise RLS policies, grants, indexes, triggers, and RPCs in the same migration when the new data needs them.
4. Update the affected Edge Function and browser code, then document the path in the relevant guide.
5. Test as a customer, a vendor member, an admin, and an unauthenticated visitor. A policy that works as an administrator may still fail—or over-permit—for a customer.

## Cross-file contracts to protect

- Product prices and delivery/payment totals are integer cents in the database and application.
- `product-images` storage is written by portal product management and must retain vendor/admin ownership checks.
- Shipment quotes must be server-issued, signed, and unexpired when checkout uses them.
- Vendor membership (`vendor_members`) is distinct from platform role (`platform_roles`). An admin does not automatically become a vendor store member.
- Returns advance through RPC/Edge Function actions; direct client updates to return/payment/shipment operational tables are intentionally restricted.

