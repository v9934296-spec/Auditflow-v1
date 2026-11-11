# Phase 4 — Staging End-to-End Acceptance (AUDITFLOW-004)

**Ticket status:** incomplete  
**Launch decision:** **NO-GO**  
**Report date (UTC):** 2026-11-11T02:59:24Z  
**Base commit inspected:** `545f3cc92623a4b902ac9f430f1c28f0d90c60d1` (merge of PR #8 / Tickets 1–3)  
**Working branch:** `test/phase4-staging-acceptance`  
**Scope:** exercise staging customer journey; fix reproducible integration defects only; produce release evidence. No product-functionality expansion.

Existing main CI evidence (run [42937958590](https://github.com/v9934296-spec/Auditflow-v1/actions/runs/42937958590)) is recorded below for regression context. It does **not** establish staging acceptance.

---

## A. Environment verification

### Preflight

| Check | Result |
|---|---|
| Local branch at start | `main` at stale `9fe122e` (pre-PR #8); working tree clean; no untracked files; single worktree |
| Local uncommitted work | None (previous Windows checkout README change not present here) |
| `git fetch origin main` | Advanced local `origin/main` to `545f3cc` |
| Tickets 1–3 on tip | Present: `6379805` (exactly-once checkout), `241269a` (verified-fix history), `4ba6485` (baseline selection / isolated DB tests), merge `545f3cc` |
| Branch `test/phase4-staging-acceptance` | Created from `origin/main` at `545f3cc` (did not exist remotely) |

### Environment variable inventory (presence only; values never printed)

| Name | Present in agent env |
|---|---|
| `NEXT_PUBLIC_APP_URL` | ABSENT |
| `NEXT_PUBLIC_SUPABASE_URL` | ABSENT |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ABSENT |
| `SUPABASE_SERVICE_ROLE_KEY` | ABSENT |
| `GITHUB_APP_ID` | ABSENT |
| `GITHUB_APP_SLUG` | ABSENT |
| `GITHUB_APP_CLIENT_ID` | ABSENT |
| `GITHUB_APP_CLIENT_SECRET` | ABSENT |
| `GITHUB_APP_PRIVATE_KEY` | ABSENT |
| `GITHUB_WEBHOOK_SECRET` | ABSENT |
| `STRIPE_SECRET_KEY` | ABSENT |
| `STRIPE_WEBHOOK_SECRET` | ABSENT |
| `STRIPE_PRICE_AUDIT` | ABSENT |
| `STRIPE_PRICE_PRO` | ABSENT |
| `ANTHROPIC_API_KEY` | ABSENT |
| `TRIGGER_SECRET_KEY` | ABSENT |
| `TRIGGER_PROJECT_REF` | ABSENT |
| `STATE_SIGNING_SECRET` | ABSENT |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | ABSENT |
| Cursor app secrets for `ventriva-audit` | none held |
| GitHub Actions repo secrets/vars listing | 403 (integration cannot read) |
| GitHub Environments | none configured (`total_count: 0`) |
| GitHub Deployments | empty |

Local disposable DB test helpers only: `AUDITFLOW_TEST_ADMIN_URL` / `POSTGREST_BIN` were set for agent-side integration runs and are unrelated to staging.

### Staging targets

| Service | Candidate identifier | Separation from production | Deployed revision | Status |
|---|---|---|---|---|
| Vercel application | **Unknown** — no staging URL in repo, homepage, deployments, or public search for this project | Unverified | Unverified | **BLOCKER** |
| Supabase DB / Auth | Host `https://vsxojedidraeczfcqevp.supabase.co` responds (HTTP 401 without `apikey`); ticket names project `auditflow-staging` | Claimed staging in prior evidence; **not re-authenticated** in this run | Schema / Auth revision unverified without credentials | **BLOCKER** (reachable host only) |
| Trigger.dev | `proj_wqqqzkzwsjhaepczqchl` in `trigger.config.ts`; public API returns 401 without auth | Staging vs prod environment **not verified** | Worker revision unknown | **BLOCKER** |
| GitHub App | Unknown slug/ID for staging | Unverified | N/A | **BLOCKER** |
| Stripe | Test-mode account, `$29` audit / `$19.99` Pro price IDs, webhook endpoint | Unverified; no `STRIPE_*` present | N/A | **BLOCKER** |
| Anthropic | Key + spend limit for staging | Unverified; no key present | N/A | **BLOCKER** |

No production credentials were substituted. No staging writes or paid requests were attempted.

### Migration readiness (repo + local disposable Postgres only)

Repo contains migrations `0001_init.sql` … `0005_audit_checkout_fulfillment.sql`.

Reviewed `0005` expectations vs local disposable DB (integration suite):

| Expectation | Local disposable evidence | Staging evidence |
|---|---|---|
| `audit_credit_fulfillments` exists with `checkout_session_id` PK uniqueness | PASS (tests create via migrations) | **BLOCKED** — no service role / SQL access |
| `fulfill_audit_checkout` matches reviewed implementation | PASS (migration applied verbatim in tests) | **BLOCKED** |
| Fulfillment + credit increment + `stripe_events` commit atomically | PASS (`rolls back a forced failure…`) | **BLOCKED** |
| `anon` / `authenticated` cannot execute fulfillment | PASS (`lets only the service role…`) | **BLOCKED** |
| Historical unreconciled events flagged (`unreconciled`) | PASS | **BLOCKED** |

Prior review evidence stated staging migration history listed `init`, `rate_limits`, `finding_not_retested`, `scan_recovery` only (no checkout-fulfillment). That claim was **not re-verified** here. Migration `0005` was **not** applied to staging in this run: target identity and credentials were blockers; no drop/recreate/replay was performed.

Configured processing limits (from `src/lib/config/plans.ts`, code review only — not live-enforced against provider usage):

| Kind | AI | Max AI cost | Max input tokens | Detailed findings |
|---|---|---|---|---|
| `free_scan` | disabled | $0 | 0 | 5 |
| `full_audit` | enabled | $2.50 | 400,000 | all |
| `recheck` | enabled | $0.75 | 120,000 | all |
| `monitor` | disabled | $0 | 0 | all |

Monitoring cadence: `PRO.monitorMinIntervalMs = 24h`. Model price table present for `claude-haiku-5-5` / `claude-sonnet-5-5`. Live Anthropic pricing / usage was **not** verified.

---

## B. Scenario matrix

Legend: PASS / FAIL / BLOCKED / NOT RUN.

### Service connections

| Scenario | Result | Evidence |
|---|---|---|
| Vercel staging app loads; API routes respond; revision recorded | BLOCKED | No staging URL or deploy token |
| Supabase registration / email confirm / sign-in / ownership isolation | BLOCKED | No Supabase keys; host only returns 401 without apikey |
| GitHub App install / repo list / read-only access / revocation | BLOCKED | No App credentials |
| Trigger.dev dispatch / worker execution / completion persistence | BLOCKED | No `TRIGGER_SECRET_KEY`; staging env unverified |
| Stripe test checkout + signed webhook + DB fulfillment | BLOCKED | No Stripe test credentials / webhook endpoint |
| Anthropic bounded request + usage/cost recorded | BLOCKED | No `ANTHROPIC_API_KEY` |

### Free customer journey

| Scenario | Result | Evidence |
|---|---|---|
| Register → confirm → sign in | BLOCKED | No Auth credentials / staging app |
| Install GitHub App → connect disposable seeded repo | BLOCKED | No App / no staging app |
| Free scan → worker → completed report → refresh | BLOCKED | No Trigger / staging app |
| Exactly one free scan per account | BLOCKED | — |
| No AI calls / AI cost on free scan | BLOCKED | Config says `aiEnabled: false`; not live-proven |
| Ownership + cross-account denial | BLOCKED | — |
| Seeded findings with valid source refs; uncertain labelled | BLOCKED | — |
| Only five free findings expose detailed remediation | BLOCKED | Config `detailedFindingsLimit: 5`; not live-proven |
| Results persist after refresh | BLOCKED | — |
| Missing/failed scanner coverage cannot launch-clear | BLOCKED | — |

### Stripe financial correctness (staging)

| Scenario | Result | Evidence |
|---|---|---|
| Successful checkout + signed `checkout.session.completed` | BLOCKED | No Stripe / staging webhook |
| Replay same event | BLOCKED | DB-level unit behavior covered locally (see §D); not E2E |
| Different event IDs, same session | BLOCKED | Same |
| Concurrent duplicate fulfillment | BLOCKED | Same |
| Failed / unpaid checkout | BLOCKED | Same |
| Invalid webhook signature | BLOCKED | Unit coverage exists in `stripe-webhook.test.ts`; not against staging |
| Processing failure then retry | BLOCKED | Local DB atomicity PASS; not E2E |
| Historical unreconciled-event handling | BLOCKED | Local DB PASS; staging schema presence unknown |

### Purchased full audit

| Scenario | Result | Evidence |
|---|---|---|
| Read-only GitHub permissions; source never executed | BLOCKED | — |
| Archive size / extraction / path / symlink protections | BLOCKED | Unit ingest coverage exists; not staging |
| Secrets / dependency / Semgrep / ESLint / readiness scanners | BLOCKED | — |
| Deterministic official scoring | BLOCKED | Unit scoring tests PASS locally; not staging |
| AI triage of existing findings only; score unchanged | BLOCKED | — |
| Excerpts redacted before AI | BLOCKED | Unit redact tests PASS; not staging |
| Token/cost limits + usage persistence | BLOCKED | — |
| P0–P3 tickets + export; owner-only access | BLOCKED | — |
| Failure does not silently consume entitlement | BLOCKED | — |

### Rechecks and finding history

| Scenario | Result | Evidence |
|---|---|---|
| Detected → Fixed → Not Retested → Fixed → Regressed | BLOCKED | Ticket 2 unit/history docs present; not staging-exercised |
| Fixed only after successful relevant retesting | BLOCKED | — |
| Incomplete scans preserve verified-fix history | BLOCKED | — |
| Successful retesting clears obsolete not-retested wording | BLOCKED | — |
| Reintroduced → regressed; unchanged → unresolved | BLOCKED | — |
| Latest eligible completed baseline selected in DB | BLOCKED | Local PostgREST baseline integration PASS; not staging |
| Fixed findings no longer penalize score | BLOCKED | — |

### Pro monitoring

| Scenario | Result | Evidence |
|---|---|---|
| Pro enables monitoring; non-Pro denied | BLOCKED | — |
| Default-branch push queues scan | BLOCKED | — |
| New/regressed P0/P1 dashboard alert | BLOCKED | — |
| Duplicate/rapid pushes do not over-concurrency | BLOCKED | — |
| 24h frequency limit enforced | BLOCKED | Config only |
| Disable monitoring / uninstall App / failure preserves history | BLOCKED | — |

### Controlled failure and recovery

| Scenario | Result | Evidence |
|---|---|---|
| Worker timeout | BLOCKED | — |
| Dispatch failure | BLOCKED | — |
| Required scanner failure | BLOCKED | — |
| GitHub access revoked | BLOCKED | — |
| AI provider failure | BLOCKED | — |
| Duplicate webhook delivery | BLOCKED | Local DB / unit only |
| Incomplete extraction | BLOCKED | — |
| Repeated failure notification | BLOCKED | — |

Email notifications: out of scope (per ticket).

---

## C. Defects

No reproducible staging integration defects were corrected in this run because staging journeys could not be executed.

| ID | Severity | Reproduction | Root cause | Files changed | Fix | Regression | Staging retest |
|---|---|---|---|---|---|---|---|
| — | — | — | — | none (report only) | — | — | — |

Product functionality was not expanded.

---

## D. Financial correctness

### End-to-end (staging Stripe + staging DB)

**Not run.** No checkout session IDs, Stripe event IDs, staging credit before/after counts, fulfillment rows, entitlement consumption/restoration, or AI cost rows were produced.

### Database-level evidence (isolated local Postgres only)

Commands:

```bash
# local disposable Postgres on 127.0.0.1:5432 (agent VM only; not staging)
export AUDITFLOW_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres
export POSTGREST_BIN=/tmp/postgrest
cd ventriva-audit && npm run test:integration
```

Result: **2 files, 7 passed** (`fulfill-audit-checkout.db.test.ts`, `baseline-postgrest.db.test.ts`).

Covered at DB function level (not a substitute for signed Stripe webhook delivery):

- Exactly one credit per eligible session; event/session replay → `duplicate`
- Concurrent duplicate fulfillment → one `granted`, one `duplicate`
- Unpaid / wrong kind / subscription / missing entitlements → `ineligible`, zero fulfillment rows
- Forced mid-transaction failure → zero fulfillment, zero event, unchanged credits; retry grants once
- Historical `stripe_events` without fulfillment → `unreconciled`, no credit
- Privilege: `anon`/`authenticated` denied; `service_role` allowed

These results prove migration SQL behavior in disposable Postgres. They do **not** prove staging schema presence, Stripe signature verification on the deployed route, or live checkout fulfillment.

---

## E. Test evidence

### Local commands on this agent (against `545f3cc` tree + report commit)

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run test:unit` | **17 files; 107 passed, 1 skipped (108)** |
| `npm run test:integration` | **2 files; 7 passed** (local Postgres + PostgREST) |
| `npm run build` | PASS (Next.js production build) |

### Prior main CI (not staging acceptance)

- Run: https://github.com/v9934296-spec/Auditflow-v1/actions/runs/42937958590  
- SHA: `545f3cc92623a4b902ac9f430f1c28f0d90c60d1`  
- Jobs: typecheck, unit, PostgREST install, integration, build — all success  

### Staging IDs

| Artifact | Value |
|---|---|
| Staging audit IDs | none |
| Trigger run IDs | none |
| Test account references | none |
| Disposable vulnerability repo / commit | none |
| Checkout / session / event refs | none |

### Final commit / CI for this branch

| Item | Value |
|---|---|
| Report commit (initial) | `b87b35b` — may be amended if CI URL is appended below after the Actions run completes |
| Branch | `test/phase4-staging-acceptance` |
| CI URL | pending first Actions run on this branch (updated once green) |

---

## F. Launch decision

### **NO-GO**

Critical staging checks are unverified or blocked. Core free journey, Stripe E2E fulfillment, purchased audit, rechecks, monitoring, and controlled failure recovery were **not run**.

This ticket remains **incomplete**. This report is evidence collection + blocker listing only — **not** implementation-complete and **not** a release gate pass.

### Exact blocker list

1. **No staging credentials** in the cloud agent environment, Cursor app secrets store, or process env for Supabase, GitHub App, Stripe test mode, Trigger.dev, Anthropic, or `STATE_SIGNING_SECRET`.
2. **Vercel staging URL / deployed revision unknown** — cannot load the app or hit API routes.
3. **Staging target separation unverified** for Trigger.dev environment, GitHub App, Stripe account/prices/webhook, and Anthropic spend limits (cannot confirm non-production before writes/paid calls).
4. **Supabase staging schema for `0005` unverified** — cannot inspect `audit_credit_fulfillments` / `fulfill_audit_checkout` / RLS/privileges; cannot safely apply `0005` without confirmed target + credentials.
5. **No ability to complete Auth, GitHub install, worker dispatch, checkout, or AI** against staging without the above.

### Safe work completed despite blockers

- Isolated branch from verified main tip containing Tickets 1–3.
- Public reachability probe of candidate Supabase host and Trigger project API (auth required).
- Repo migration / config review; local typecheck, unit, disposable Postgres integration, and build.
- Secrets request filed for staging-only values; no production substitution.
- This acceptance report committed.

### Resume conditions

Provide staging-only credentials and confirmed target identifiers (Vercel URL + SHA, Supabase project confirmation + whether `0005` is applied, Trigger staging env + worker revision, GitHub App, Stripe test prices/webhook, Anthropic staging key/limits). Re-run sections 2–9 against those targets; update this document; require green GitHub CI on the final commit before any GO / CONDITIONAL GO.
