# Kompo Nation payment providers

Checkout and customer-paid return logistics use the same server-side provider
switch. The storefront does not contain provider credentials and always follows
the authorization URL returned by the Edge Function.

## Default and rollback

`PAYMENT_PROVIDER` accepts `paystack`, `stitch`, or `yoco`. If it is absent, checkout
defaults to `paystack`.

Switch back to Paystack by setting:

```text
PAYMENT_PROVIDER=paystack
PAYSTACK_SECRET_KEY=...
```

The existing `paystack-webhook` endpoint and Paystack flat vendor-split logic
remain in place.

## Activate Stitch

Deploy the migration and the `create-checkout`, `return-logistics`, and new
`stitch-webhook` functions. Configure these Edge Function secrets:

```text
PAYMENT_PROVIDER=stitch
STITCH_CLIENT_ID=...
STITCH_CLIENT_SECRET=...
STITCH_WEBHOOK_SECRET=whsec_...
STITCH_MERCHANT_ID=...
STITCH_ENABLE_EFT=false
PAYMENT_ALLOW_PLATFORM_COLLECTION=false
SITE_URL=https://komponation.co.za
```

Register this production webhook with Stitch:

```text
https://<supabase-project-ref>.supabase.co/functions/v1/stitch-webhook
```

Subscribe it to payment events, and ask Stitch to allowlist these HTTPS return
URLs:

```text
https://komponation.co.za/payment-success
https://komponation.co.za/payment-cancelled
```

Card is enabled explicitly. Pay by Bank remains disabled until
`STITCH_ENABLE_EFT=true`; a Stitch merchant ID is required before enabling it.

## Activate Yoco

Yoco uses a single Checkout API secret and is the quickest code path to
configure. Live keys remain locked until Yoco approves a verified production
domain.

```text
PAYMENT_PROVIDER=yoco
YOCO_SECRET_KEY=sk_live_...
YOCO_WEBHOOK_SECRET=whsec_...
PAYMENT_ALLOW_PLATFORM_COLLECTION=true
SITE_URL=https://komponation.co.za
```

Register this webhook using the same live Yoco Checkout API secret:

```text
POST https://payments.yoco.com/api/webhooks
Authorization: Bearer <YOCO_SECRET_KEY>

{
  "name": "Kompo Nation production",
  "url": "https://<supabase-project-ref>.supabase.co/functions/v1/yoco-webhook"
}
```

Save the one-time `secret` from that response as `YOCO_WEBHOOK_SECRET`.

## Marketplace settlement safety

Paystack distributes a single customer payment to multiple vendor subaccounts.
Stitch's current public split-payment API supports only one split destination
and card payments, so it cannot reproduce Kompo's multi-vendor settlement.

For platform-owned products, Stitch or Yoco can be used with the default safety
setting. For an outside-vendor product, checkout fails closed unless this is explicitly
set:

```text
PAYMENT_ALLOW_PLATFORM_COLLECTION=true
```

That setting means Stitch or Yoco pays the full checkout into Kompo's merchant account.
Vendor net amounts remain recorded in `vendor_orders`, but must be paid out and
reconciled from Admin → Settlements. Store payouts and Bob Go charges require a
reference before they can be marked paid.

## Go-live smoke test

1. Use Stitch test credentials and a low-value platform-owned item.
2. Confirm the webhook changes the order from `pending_payment` to `paid`.
3. Confirm the payment row has provider `stitch`, the Stitch request ID, and a
   completed verification payload.
4. Confirm stock is reduced only after the webhook.
5. Test a failed/cancelled checkout and confirm stock stays reserved only until
   the normal reservation expiry.
6. Repeat a successful webhook and confirm finalization is idempotent.
7. Only then use production credentials for a real purchase.
