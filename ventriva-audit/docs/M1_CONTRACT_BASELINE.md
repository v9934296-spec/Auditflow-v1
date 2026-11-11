# M1: AuditFlow contract baseline

Recorded 2026-11-11. **Characterization only, not an identity or data migration.**

## Version pinned

- Repository `v9934296-spec/Auditflow-v1`, `main` at `e564d4689ee0de17744603f6e3942e13a90535a0`.
- `ventriva-audit/`: Next.js 16 App Router, Supabase Auth/Postgres, GitHub App, Stripe, Anthropic and Trigger.dev.
- Supabase staging project `vsxojedidraeczfcqevp` had migrations through `atomic_audit_completion` applied and function grants checked. Staging **end-to-end customer flow remains unverified**.

## API contract

| Method and route | Identity and guard | Output / behavior |
| --- | --- | --- |
| POST `/api/audits` | Same-origin, verified Supabase user and confirmed email, rate limit | `{id}` (201); `repositoryId` UUID and `kind=free_scan\|full_audit\|recheck`; ownership and credits verified server-side |
| POST `/api/billing/checkout` | Same-origin, verified Supabase user with email, rate limit | `{url}`; only `kind=audit\|pro`, no legacy Ventriva plan names |
| POST `/api/stripe/webhook` | Signed Stripe event | `{received:true,result}`, invalid signature 400; atomic paid-audit grant RPC |
| GET `/api/audits/[id]/export` | Supabase user and row-level read policy | Markdown or JSON tickets for eligible paid audits |
| POST `/api/github/install`, GET `/api/github/callback`, POST `/api/github/webhook` | GitHub OAuth/app installation and signed webhook | Repository link/sync, installation updates |
| POST `/api/repos/sync`, POST `/api/repos/[id]/monitoring` | Auth and ownership | Repository state / monitoring controls |

## Data and billing boundary

- Supabase Auth `auth.users.id` (UUID) is the sole authenticated principal for AuditFlow.
- Postgres ownership is `user_id` UUID across `repositories`, `audits`, `findings`, `tickets`, and entitlements.
- Webhook `fulfill_audit_checkout` grants a single audit credit per Stripe checkout session with idempotency.
- `queue_user_audit` reserves credits, `fail_audit` handles failed runs, and `complete_audit` atomically publishes findings, tickets, cost ledger and completion.
- `full_audit` uses a $29 one-off Stripe price; audit `pro` is a distinct $19.99/month product with recheck/monitoring entitlement. These are **not** the legacy idea-validator subscriptions.
- Retesting a historical verified fix requires actual new coverage. A missing retest cannot be scored as a new pass.
- The Python market-validation rubric is **not** an AuditFlow readiness score and must never be combined numerically by default.

## Environment inventory (names only)

`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_AUDIT`, `STRIPE_PRICE_PRO`, `ANTHROPIC_API_KEY`, `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF`, `STATE_SIGNING_SECRET`, `DAILY_AI_SPEND_CAP_USD`. Credential values are never checked into Git.

## Regression coverage

Existing unit/integration suites cover RLS/ownership paths in database fixtures, Stripe signature and fulfillment, retry/duplicate scan protection, fix history, score coverage and atomic completion. `tests/m1-merge-contract.test.ts` pins audit/checkout origin, authentication, body validation and return shapes.

These tests do not establish a successful deployed customer transaction. A live staged pass with actual GitHub App, Trigger.dev, Supabase and Stripe sandbox is still necessary.

## No behavior change for M1

Do not rewrite auth, merge databases, reprice plans, send cross-service JWTs, expose legacy Mongo IDs as UUIDs, or redirect production traffic before M2–M6.
