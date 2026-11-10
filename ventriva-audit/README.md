# Ventriva Audit — MVP

Launch-readiness inspection for solo founders and AI-assisted builders. Connect a GitHub repo, get an evidence-backed verdict, a versioned 0–100 score, a Business Launch Readiness scorecard, and P0–P3 tickets ready for Cursor / Claude Code / Codex / GitHub Issues.

**Tiers:** free scan (1 per account, deterministic only) → $29 full audit (AI-triaged, tickets) → $19.99/mo Pro (2 targeted rechecks/month, push monitoring, regression alerts).

## Architecture

```
Next.js 16 (Vercel)          Supabase                 Trigger.dev worker (isolated)
├─ Dashboard + report UI     ├─ Auth                  └─ run-audit task
├─ API routes ───────────────┤─ Postgres + RLS            ├─ repo-scoped read-only GitHub token
│   audits / billing / repos │  (select-own policies;     ├─ streamed tarball → safe extract (limits, no symlinks)
├─ Stripe webhook            │   writes = service role)   ├─ scanners: secrets · OSV · Semgrep · ESLint · readiness
└─ GitHub webhook            └─ entitlement functions     ├─ Claude triage (budgeted, redacted excerpts only)
                                (row-locked)              ├─ deterministic scoring (rubric 2026.11-v1)
                                                          └─ tickets → DB, workspace deleted
```

Three engineering rules, enforced in code:
1. **Deterministic first.** Scanners produce findings and the rubric produces scores. Claude only labels existing findings (`likely_true_positive` / `likely_false_positive` / `needs_human_review`) and writes the summary. It cannot add findings or change scores (`src/lib/analysis/llm/triage.ts`).
2. **Customer code is never executed.** Nothing is installed or built. ESLint runs through the in-memory `Linter` API with our config only; repo config files are never loaded (`src/lib/analysis/scanners/eslint.ts`).
3. **Hard cost ceilings.** Per-tier limits on archive size, files, AI findings, input tokens and USD per audit, plus a platform-wide daily AI cap that fails closed (`src/lib/config/plans.ts`, `src/lib/analysis/llm/provider.ts`).

Honesty rules: untested categories show "Not assessed" (never a passing score); absence checks are labelled *suspected*; a recheck marks a finding *fixed* only when the same file, dependency, or check was inspected again and the finding is gone, and otherwise marks it *not retested*; a finding is *regressed* only when it returns after a verified fix; a skipped, failed, or partial required scanner, a truncated extract, or any eligible source file that Semgrep and ESLint did not inspect, blocks a "launch ready" verdict. Languages outside that set are named and are not counted as inspected. OSV may be skipped only when the repository has no supported lockfile.

## Key files

| Area | Path |
|---|---|
| Tiers, limits, model pricing | `src/lib/config/plans.ts` |
| Pipeline orchestration | `src/lib/analysis/pipeline.ts` |
| Launch readiness checks (auth, billing, onboarding, deployment, ops, testing) | `src/lib/analysis/readiness/detectors.ts` |
| Scoring rubric | `src/lib/analysis/scoring.ts` |
| Ticket generation | `src/lib/analysis/tickets.ts` |
| Semgrep rules | `semgrep-rules/launch-security.yml` |
| Worker | `src/trigger/run-audit.ts`, `src/lib/audits/run.ts` |
| Entitlements / abuse limits | `src/lib/audits/service.ts`, `supabase/migrations/0001_init.sql` |
| Stripe | `src/lib/stripe/*`, `src/app/api/stripe/webhook/route.ts` |
| GitHub App | `src/lib/github/*`, `src/app/api/github/*` |

## Setup

Requires Node 22, a Supabase project, a Stripe account, a Trigger.dev project, an Anthropic API key, and a GitHub account.

### 1. Install
```bash
npm ci
cp .env.example .env.local
openssl rand -base64 48   # → STATE_SIGNING_SECRET
```

### 2. Supabase
1. Create a project, then copy URL, anon key and service-role key into `.env.local`.
2. Apply migrations: `npx supabase link --project-ref <ref>` then `npm run db:push` (or paste `supabase/migrations/*.sql` into the SQL editor, in order).
3. Auth → URL configuration: Site URL = your app URL; add `<APP_URL>/auth/callback` to redirect URLs. Keep "Confirm email" on (audits require a confirmed email).

### 3. GitHub App
Developer settings → GitHub Apps → New:
- **Callback URL** and **Setup URL**: `<APP_URL>/api/github/callback`
- Check **Request user authorization (OAuth) during installation** (required; it proves the installer owns the installation)
- **Webhook URL**: `<APP_URL>/api/github/webhook`, with a random secret → `GITHUB_WEBHOOK_SECRET`
- **Repository permissions:** Contents → Read-only, Metadata → Read-only. Nothing else.
- **Subscribe to events:** Installation, Installation repositories, Push
- Generate a private key → `GITHUB_APP_PRIVATE_KEY`; also copy App ID, slug, client ID and client secret.

### 4. Stripe
1. Create two prices: a one-time **$29** price → `STRIPE_PRICE_AUDIT`, and a recurring **$19.99/month** price → `STRIPE_PRICE_PRO`.
2. Add a webhook endpoint at `<APP_URL>/api/stripe/webhook` with events: `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret.
3. Enable the Customer Portal (Settings → Billing → Customer portal).
4. Local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

### 5. Trigger.dev
1. The project ref is `proj_wqqqzkzwsjhaepczqchl` in `trigger.config.ts`. Set `TRIGGER_SECRET_KEY` from the Trigger.dev development environment.
2. In the Trigger.dev dashboard, add the worker's env vars: Supabase URL + service role key, GitHub App vars, `ANTHROPIC_API_KEY`, `DAILY_AI_SPEND_CAP_USD`, `STATE_SIGNING_SECRET`, and the remaining server vars (the worker validates the full server env).
3. Local: `npm run trigger:dev`. Deploy: `npm run trigger:deploy` (the image installs Semgrep 1.183.0 and ships `semgrep-rules/`).

### 6. Run
```bash
npm run dev            # web app
npm run trigger:dev    # worker (separate terminal)
```
Deploy the web app to Vercel with the same env vars.

## Verify

```bash
npm run typecheck
npm test               # Vitest. The Semgrep integration test runs when the CLI is installed
npm run build
npm run audit:local -- ../some-repo            # run the engine on any local folder, no services needed
npm run audit:local -- ../some-repo --ai       # include Claude triage (uses ANTHROPIC_API_KEY, capped)
```

Set `SEMGREP_ENABLE_VERSION_CHECK=0` locally, or Semgrep can stall for over a minute on a network version check.

## Known limitations (MVP)

- **Not yet run end-to-end against live services.** Engine, scoring, tickets, ingest and triage are unit-tested; GitHub/Stripe/Supabase/Trigger wiring compiles and builds but needs a staging smoke test (see `docs/cursor-tasks.md`, task 1).
- Readiness detectors are strongest for JS/TS (Next.js, Supabase, Stripe). Python gets secrets, dependency and Semgrep coverage only.
- Pattern checks can match inside string literals (e.g. docs that mention `auth.getSession()`). AI may label those as likely false positives. That label does not change the official score, verdict, or ticket. The AI executive summary can still omit the finding from its narrative.
- Regression alerts appear on the dashboard only; there is no email delivery yet.
- Stripe refunds (`charge.refunded`) don't claw back unused audit credits. One-time audit credits are granted by `fulfill_audit_checkout` (see `docs/stripe-fulfillment.md`).
- Architecture and performance are reported as "Not assessed" in rubric `2026.11-v1`.
- `/terms` and `/privacy` are templates; have them reviewed before launch.
