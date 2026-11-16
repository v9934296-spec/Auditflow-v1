# M5: Product-scoped billing, safe migration boundary

Status: **IN PROGRESS / NOT DEPLOYED / NO PRODUCTION MIGRATION**.

This branch implements the first safe portion of M5. It is not a declaration that
both Stripe and Mongo ledgers have been consolidated or end-to-end tested.

## Current authorities

| Product | Account | Stripe integration | Entitlement ledger | Checkout |
| --- | --- | --- | --- | --- |
| AuditFlow full audit + audit Pro | Supabase Auth UUID | AuditFlow signing secret and price IDs | Supabase Postgres | Next.js `/api/billing/checkout` |
| Ventriva idea pack + founder + validation Pro | Legacy FastAPI session | Ventriva signing secret and price IDs | Mongo `billing_accounts` | Legacy FastAPI `/api/billing/checkout` |

A linked account is not permission to transfer payments. In particular:
- Neither plan named `pro` grants access to the other product.
- Existing subscriptions stay on their issuing processor/ledger.
- A shared email or Stripe customer ID is insufficient proof of legacy ownership.
- No automatic database merge, balance copy or subscription cancellation.

## Code implemented in this branch

- The catalog in `src/lib/billing/products.ts` declares explicit product ownership.
- New AuditFlow checkout sessions carry `product=audit`. Existing pre-M5
  AuditFlow checkout sessions without a product label stay supported.
- Payment fulfillments reject metadata identifying a different product.
- The pricing page shows both products but directs validation purchases to
  the existing validation application's current plan list and checkout.
- `0007_m5_scoped_subscription.sql` adds a service-role-only atomic audit
  subscription reconciliation function. It validates Stripe customer ownership
  against `profiles.stripe_customer_id`, validates the audit Pro Price ID,
  deduplicates Stripe events, serializes account writes, rejects older events
  and commits plan/period/monitoring changes with the event ID.
- Webhook handling fetches the current subscription from Stripe rather than
  trusting a delayed event's embedded snapshot.
- Unit and disposable-Postgres tests cover product isolation, replay, stale
  events, renewal, cancellation, price and tenant checks.

## Required deployment sequence

1. Review and test the implementation on a disposable/staging Postgres.
2. Apply migration `0007_m5_scoped_subscription.sql` **to verified staging only**.
3. Configure staging Stripe test-mode event delivery and audit Pro price.
4. Deploy the webhook branch to an isolated preview. Without migration 0007,
   subscription delivery returns 500 and Stripe retries. Never deploy
   the webhook before migration 0007.
5. Test active, renewal, payment failure, cancellation, out-of-order events
   and competing subscriptions, including confirmed customer mapping.
6. Do not promote to production without successful end-to-end reconciliation.

## Remaining M5 acceptance gaps

- No source-of-truth billing migration has been performed for legacy Ventriva
  customers, subscriptions or remaining allowances. This requires verified
  existing-user mapping, explicit consent and a tested migration/reversal plan.
- Refund/chargeback handling is still not end-to-end reconciled for both products.
- A common self-service payment management UX remains separate. This is
  deliberate until the cross-service read contracts and ownership checks
  have passed real staging testing.
- No proof that both legacy and AuditFlow webhooks safely coexist in one
  Stripe account (or with separate accounts) has yet been collected.
- Existing legacy Stripe sessions and subscriptions must be reconciled from
  Stripe directly, not inferred from email or stale Mongo records.
- No live staging checkout, cancellation, renewal, refund, or tenant-isolation
  exercise has been run from this branch.

A public launch is **NO-GO** until these gaps and M6 staging checks are closed.
