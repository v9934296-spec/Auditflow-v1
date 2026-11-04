# Post-MVP tasks (atomic, for Cursor)

Work top to bottom. One task per Cursor session. Each task is self-contained.

---

## Task 1 — Staging smoke test (ship-blocker)

**Goal:** Prove the full loop works against real services before any user touches it.

**Files:** none (manual), then fix whatever breaks.

**Steps:**
1. Deploy web to a Vercel preview, run `npm run trigger:deploy` to a staging Trigger.dev env, use Stripe test mode and a staging Supabase project.
2. Sign up, confirm email, connect GitHub on a throwaway repo containing a committed `.env`, an unverified Stripe webhook and a table without RLS.
3. Run the free scan, then buy a full audit with card `4242 4242 4242 4242` and run it. Push a fix, subscribe to Pro, run a recheck.

**Acceptance criteria:**
- [ ] Free scan shows P0s; free-scan findings beyond the top 5 show the locked remediation text (check via Supabase table editor that `snippet` is null for them).
- [ ] Full audit credit is granted exactly once even when you resend the webhook from the Stripe dashboard.
- [ ] Recheck marks the fixed finding as **Fixed** and shows the AI cost.
- [ ] Uninstalling the GitHub App removes the repo from the dashboard.

**Scope:** Fix only defects found. No new features.

---

## Task 2 — Email delivery for regression alerts

**Goal:** Pro users get an email when monitoring finds a new P0/P1.

**Files:** `src/lib/audits/run.ts` (alert insert), new `src/lib/email/send.ts`, `.env.example`.

**Steps:** Add Resend, send one email per audit (not per finding) listing up to 5 regressions with a link to the report.

**Acceptance criteria:**
- [ ] One email per monitoring audit with regressions; none when there are no regressions.
- [ ] Email failure never fails the audit (log to Sentry instead).

**Required tests:** unit test that the sender is called once with ≤5 items.

**Scope:** Do not change alert storage or the dashboard.

---

## Task 3 — Refund handling

**Goal:** `charge.refunded` for an audit purchase removes one unused audit credit.

**Files:** `src/lib/stripe/webhook.ts`, `supabase/migrations/0003_refunds.sql`.

**Acceptance criteria:**
- [ ] Credit is decremented only if `audit_credits > 0` (no negative balances).
- [ ] Event is idempotent through the existing `stripe_events` table.

**Required tests:** unit test for both the "has credit" and "already used" cases.

**Scope:** Do not touch subscription logic.

---

## Task 4 — Ignore string literals in readiness pattern checks

**Goal:** Cut false positives like `auth.getSession()` matching inside strings or comments.

**Files:** `src/lib/analysis/readiness/detectors.ts` (`grep`, `grepAll`).

**Steps:** Before regex matching on `.ts/.tsx/.js/.jsx`, blank out the contents of comments and string literals (keep offsets identical so line numbers stay correct).

**Acceptance criteria:**
- [ ] A file whose only mention is `"auth.getSession()"` in a string no longer fails `supabase-getsession-server`.
- [ ] Real calls still fail it.
- [ ] Line numbers in findings are unchanged for real matches.

**Required tests:** add both cases to `tests/engine.test.ts`.

**Scope:** Do not change Semgrep or ESLint scanners.

---

## Task 5 — Validate demand before building v1.5 (done-for-you fixes)

**Goal:** Measure free scan → $29 conversion and audit → Pro conversion from real users.

**Files:** add PostHog (`posthog-js`), events: `free_scan_started`, `free_scan_completed`, `checkout_started{kind}`, `audit_completed`, `recheck_started`.

**Acceptance criteria:**
- [ ] Funnel visible in PostHog for the first 50 sign-ups.
- [ ] No source code, file paths or finding text is sent to analytics.

**Scope:** Events only; no UI changes.
