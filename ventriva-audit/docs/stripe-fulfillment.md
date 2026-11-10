# Audit-credit fulfillment

`public.fulfill_audit_checkout` grants one audit credit for an eligible Checkout Session. The fulfillment row (`checkout_session_id`), the `entitlements.audit_credits` increment, and the `stripe_events` row commit in one database transaction.

Eligible means all of the following:

- Checkout `mode` is `payment`
- `payment_status` is `paid`
- metadata `kind` is `audit`
- `user_id` (metadata, otherwise `client_reference_id`) is a real user with an entitlements row

The webhook route still rejects missing or invalid `Stripe-Signature` values before this function runs.

## Idempotency

| Delivery | Result |
|---|---|
| First eligible event for a session | `granted` (one credit) |
| Same event again | `duplicate` |
| Different event id, same session | `duplicate` |
| Two concurrent calls for one session | one `granted`, one `duplicate` |
| Error before commit | no fulfillment row, no event row, no credit |
| Commit succeeded, HTTP response lost | retry is `duplicate` |

Ineligible sessions record the event and grant nothing.

## Deploy order

Apply `supabase/migrations/0005_audit_checkout_fulfillment.sql` before the webhook revision that calls `fulfill_audit_checkout`. If the code ships first, the missing function returns HTTP 500 and Stripe retries; no credit is granted twice. Do not run this against production as part of review.

## Older event rows

Events inserted by the previous handler have a `stripe_events` row and no `audit_credit_fulfillments` row. The same event id now returns `unreconciled` and does **not** grant a credit. That avoids paying a second credit when the old handler already granted one, and it also does not guess when the old handler crashed after the insert.

Reconcile one historical session only after checking Stripe and the user's credit balance:

- Credit already granted: insert the fulfillment row yourself (`checkout_session_id`, `user_id`, original `stripe_event_id`) and leave the event row in place.
- Credit never granted: delete that single `stripe_events` row, then redeliver the webhook. The function grants once.

A different event id cannot be tied to an old row, because `stripe_events` did not store the session id. Do not redeliver a second event for a historical session until the fulfillment row exists.

Subscription checkout and `customer.subscription.*` events still use event-id tracking in `handleStripeEvent`. They do not grant audit credits.
