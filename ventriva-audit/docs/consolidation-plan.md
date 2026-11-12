# Ventriva + AuditFlow consolidation: architecture and migration plan

Status: **proposed, not approved or implemented**. This document records a repository-based integration assessment. It is not proof of a successful deployed end-to-end test.

## Source-of-truth snapshots (2026-11-11)

- AuditFlow: `v9934296-spec/Auditflow-v1`, `main` at `e564d4689ee0de17744603f6e3942e13a90535a0`, app in `ventriva-audit/`.
- Ventriva idea validator: `v9934296-spec/ventriva`, currently deployed Render service `venturelens` tracking `codex/venturelens-paid-validation` at `e43da373cbd95766ff8f4b7b3b33b6f0d9fa8749`. The repository default `main` is **not** the deployed branch; never substitute its HEAD for deployed behavior.
- AuditFlow's staging Supabase project `vsxojedidraeczfcqevp` has all migrations through atomic audit completion installed; green GitHub CI does not replace live integration validation.
- The Ventriva service and databases are **not** to be modified by this planning change.

## Product decision

Single Ventriva brand and founder workspace with distinct **Validate**, **Audit**, and later **Monitor** modules. Preserve separate scores, evidence, claims, entitlements and run histories. Do not manufacture a combined numeric launch score. Existing capabilities and limitations remain accurately labelled.

## Verified engineering comparison

| Area | Ventriva idea validator | AuditFlow | Integration implication |
| --- | --- | --- | --- |
| UI | React 19, CRA/CRACO, React Router, Tailwind; `frontend/src/pages` | Next.js 16 App Router, React 19, Tailwind; `src/app` | Rebuild page shells/views in Next; don't copy CRA routing into App Router |
| API | Python FastAPI `backend/server.py` with `/api/ideas/clarify`, `/api/analyses`, `/api/billing/*`, `/api/auth/*` | Next.js API routes for repositories/audits, GitHub app, Stripe | Preserve Ventriva's Python evaluation as a separately versioned service initially |
| Identity | Mongo `users` and `user_sessions`, password/JWT issued by FastAPI | Supabase Auth, RLS policies and web cookies | Must select a canonical identity before exposing a unified protected workspace; no direct JWT interchange |
| Storage | MongoDB Atlas; `analyses`, accounts and billing data | Supabase Postgres with findings, tickets, scans, user-linked entitlements | Keep storage isolated at first; explicit mapping, not ad hoc dual writes |
| Billing | Stripe subscriptions Starter $15.99/2 full and Pro $25/5 full per cycle; Mongo reservations | Stripe $29 one-time audit and $19.99/month audit Pro, Postgres credits | Two incompatible entitlement/renewal models. Keep separate products/Stripe webhook handlers until unified ledger and migration are tested |
| Jobs | FastAPI background analysis worker and Mongo job lease/refunds | Trigger.dev scan worker, row-locked claims and atomic completion RPC | Do not move Python research into the scan worker |
| Assessment | Anthropic report validated with Pydantic; separate offline `venturelens_adapter` has strict rubric input requirements | Deterministic scanners and scoring; AI only triages provided findings; incomplete coverage disables score | Maintain independent scoring contracts and distinct evidence provenance |
| Deploy | Paid Render `venturelens` service on deployed branch | Intended Next.js web hosting, Supabase and Trigger.dev | Run isolated merge preview/staging; do not repoint Render live service |
| Risk | Authentication rate limiting uses `request.client.host` with no trusted reverse-proxy contract; CRA toolchain advisories mentioned in README | Full deployed GitHub/Stripe/worker flow unverified; legal pages templates | Resolve before consolidating auth or launching paid public traffic |

## Target architecture (decision proposal)

- **Canonical web shell**: the AuditFlow Next.js App Router in `ventriva-audit/`; brand as Ventriva, navigation to Validate / Audit / Monitor. Preserve AuditFlow's current dashboard routes and worker interfaces until tests demonstrate parity.
- **Canonical customer identity**: Supabase Auth **for new merged accounts**. A legacy-to-Supabase identity migration requires a verified account-linking workflow, unique email proof and explicit user/session handling. Do not map accounts solely by matching email, import password hashes or bypass Mongo ownership checks.
- **Validation engine**: versioned FastAPI service backed by existing MongoDB, not a translated TypeScript copy. Its internal endpoints must require a server-only service credential or independently validated signed identity assertions, with an explicit Supabase-user-ID to legacy-user-ID mapping and tenant-bound checks. Never proxy arbitrary user-controlled URLs; never expose the service credential to browsers.
- **Audit engine**: retain existing Supabase/Trigger worker architecture and deterministic-first scoring.
- **Billing**: keep Stripe price catalogs and checkout endpoints distinct in the first integration phase. Define namespaced entitlements by product and stable Stripe event/session idempotency keys, then migrate only after reconciliation tests and customer subscription mapping; no accidental double grants.
- **Data**: maintain Mongo and Postgres initially, communicate over versioned API contracts; never share tables or maintain duplicate source-of-truth records through fragile synchronous writes.
- **AI cost**: enforce independent per-module token and dollar budgets, daily cap and user-visible evidence coverage.

## Implementation sequence / proposed tickets

### Ticket M1: Contract characterization, no behavior changes
- Pin the deployed Ventriva branch and record route request/response schemas, ownership rules, billing states and Mongo collection ownership.
- Add snapshot/contract tests to both repositories for representative preview, full validation, audit, failure, recheck, billing replay and authorization outcomes.
- Record env-variable inventories without values and document deployment/staging separation.
- Exit: contracts checked into Git; both original test suites green; no live configuration changes.

### Ticket M2: Ventriva branded shell in AuditFlow Next.js
- Add Validate/Audit/Monitor navigation and neutral landing/workspace cards.
- Preserve all existing AuditFlow URLs and login behavior.
- Validation card must link clearly to the **existing independent app**, labelled as a separate sign-in while identity is not shared. Do not present fake unified login.
- Exit: CI/build green, responsive and accessible navigation, no external service or billing changes.

### Ticket M3: Secure validation service boundary
- Introduce server-to-server proxy/adapter for a small read-only validation interface, strict schema validation, bounded timeouts, request limits, service authentication, trace IDs and tenant ownership.
- Design explicit identity mapping flow before allowing create/mutate/download routes.
- Exit: authorization tests prove cross-tenant requests fail, direct calls lacking service auth fail, error handling does not disclose secrets, old flows remain functional.

### Ticket M4: Account linking and migrated customer journey
- Build explicit user-authorized linkage from legacy Ventriva account to Supabase identity, with duplicate-email handling, expired sessions, and rollback.
- Avoid automatic entitlement transfer; reconcile and verify subscription ownership before any billing migration.
- Exit: tested with two users sharing confusing identifiers, canceled/active subscriptions, duplicate sessions; no unsafe mapping.

### Ticket M5: Unified catalog and payment migration
- Product-scoped entitlements, Stripe customer/subscription association rules, webhook migration and idempotency/replay handling.
- Test failed checkout, concurrent webhook delivery, refunds, cancellations, renewal, exhausted quota and tenant isolation.
- Exit: audit + validation purchase and usage work without duplicate credits; old paid subscriptions continue or get deliberately migrated with customer consent.

### Ticket M6: Staging acceptance / release
- Complete both modules against live sandbox services: signup, idea preview/full report, GitHub installation/free scan/paid audit/recheck, Stripe sandbox payments, provider errors, rollback and customer isolation.
- Review legal pages and support policy; stage DNS/domain routing and preserve a rollback path.
- Exit: successful observed smoke tests, no high-severity auth/billing issues, cost ceilings verified, named go/no-go owner.

## Stop conditions

- No live Render `venturelens` branch, Mongo schema, Stripe live prices/webhooks, Supabase production project or existing customer accounts may be repointed or mutated as part of M1/M2.
- No shared login is advertised before verified identity linkage.
- No combined grade is represented as a factual score.
- No paid public release until end-to-end verification against deployed services.
