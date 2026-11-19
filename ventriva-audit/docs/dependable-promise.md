# Dependable inspection and founder pilot

## Release gates

1. CI must pass on the exact release commit: typecheck, unit tests with Semgrep installed, isolated PostgreSQL/PostgREST integration tests, and production build.
2. Run the deployed staging journey with two test accounts: confirmed signup, GitHub installation and repository ownership, free scan, test-mode audit purchase, signed webhook delivery and replay, worker execution, report/export, recheck and history, Pro activation/cancellation/monitoring, and failure recovery. Record app and worker revisions, audit/run/event IDs, timestamps and expected/observed outcomes. A health endpoint or database function test alone does not pass this gate.
3. Each report must distinguish ingestion from inspection, list scanner status/reasons and inspected paths, name uncovered and unsupported source, expose extraction exclusions/truncation, and state that runtime/customer journeys were not tested. Legacy reports without an inventory must say so. Do not backfill coverage from language support or a scanner exit code.
4. Do not expand the product category until independent founder pilots meet agreed usefulness and correctness targets. Repository scans and developer reviews do not establish founder adoption.

## Evidence on 2026-11-18 (Pacific time)

- Main `da14966de0f60f9f75739f146436b2cee40690d9`: [CI run 43999847998](https://github.com/v9934296-spec/Auditflow-v1/actions/runs/43999847998) passed typecheck, unit tests, database integration tests and build. That run predates this branch.
- New regression tests reproduced an ESLint defect: the generic flat-config glob did not select TypeScript/JSX, yet the scanner counted those files as inspected. Explicit extension globs now make rules and parse-failure accounting run. New pipeline tests verify the inspected/uninspected/unsupported partition and the empty-source case.
- Local Next.js 16.4.3 build compiled but exited with a vulnerability warning. npm audit identified GHSA-mfr8-8qww-v76h and GHSA-vc7v-qv4w-wrv8 affecting versions through 16.4.4. This branch updates the lockfile to 16.4.6; its production build passed. This is not a claim that every dependency is free of advisories.
- Connected Supabase project `auditflow-staging`, ref `vsxojedidraeczfcqevp`, was healthy. Migration history alone concealed drift: the current subscription webhook's `apply_audit_subscription_event` and `subscriptions.last_event_created` were absent. Applied the repository's existing `0007_m5_scoped_subscription.sql` as `m5_scoped_subscription`. Verified both objects and server-only execution permissions afterward.
- Transactional database smoke passed: one-time credit grant, session replay, credit count, purchase-scoped refund and refund replay, Pro activation, event replay and stale-event rejection. Synthetic user and event data were rolled back. No Stripe API or website journey was exercised by this SQL test.
- Supabase security advisor still reports leaked-password protection disabled. Four server-managed tables have RLS and no client policies; this is expected to deny client access and is not grounds to add broad policies.
- BLOCKED: deployed Auditflow website URL, test login, deployed worker revision and test-mode payment/AI configuration are not established. The supplied Supabase URL is a database API, not the Auditflow website. Signup, GitHub installation, real worker dispatch, Stripe delivery, AI processing, hosted report delivery, monitoring and recovery remain unverified end to end.

## Founder pilot: measure behavior, not report production

Use founder-approved projects and record project commit, Auditflow revision, supported stack, tier, scanners and any service limitations. Begin with OnFlow `3c18cedd7f4ee62ed91f2e8556b294b74a4be834`; it combines Expo/React Native and a Python API, so web-specific assumptions need special scrutiny.

Keep these measurements separate:

| Measurement | Definition |
|---|---|
| Time to generated report | Repository submission to report visible; include queue and service delays for hosted runs. Local engine timing is a separate diagnostic. |
| Time to useful report | Submission to founder confirmation of at least one correct, actionable finding they understand. No confirmation means pending, not the engine's completion time. |
| Finding correctness | Independent review against the pinned commit; label correct, incorrect, not applicable or unresolved. Review all P0/P1 findings and a documented sample of lower priorities. AI triage is not ground truth. Report sample size and selection. |
| Blocker follow-through | Within an agreed follow-up window, record founder acceptance, fix commit/PR, recheck ID and whether the same check was actually retested. Count verified fixes only for previously correct, actionable blockers. Distinguish rejected, deferred, not retested and no response. |

Record median/p90 time to useful report, reviewed-finding precision by priority, incorrect P0/P1 count, and verified blocker fixes / accepted actionable blockers. Report numerator/denominator; an empty denominator is unknown. Keep projects as the unit of replication rather than treating many findings in one project as many customers. Recruit and contact founders only with authorization. Do not send source, paths, snippets or credentials to analytics.

Proposed pilot gate, to agree before recruiting: 5–10 independent founders in one supported stack; review every P0/P1; no unresolved false P0; at least 90% reviewed P0/P1 precision; useful report within 10 minutes for at least 80% of projects; at least half of accepted actionable blockers verified fixed within 7 days. These are proposed decision thresholds, not established results.

## First OnFlow trial: result does not pass the value gate

The initial local engine run completed in 28.8555 seconds. It used live OSV lookups and real ESLint/readiness/secrets scans, with Semgrep unavailable on Windows and AI disabled. This is generation time, not founder-confirmed usefulness or hosted latency. The numeric overall score was withheld for incomplete inspection.

A convenience sample exposed three incorrect conclusions and two items requiring context:

| Finding | Review | Evidence at the pinned OnFlow commit |
|---|---|---|
| P0 embedded database password | Incorrect: a documented placeholder, not evidence of a leaked credential | `services/api/.env.example:120`, commented Redis example with literal password `password` |
| No environment validation | Incorrect | `services/api/app/core/config.py:169`, `:176`, `:187` use Pydantic model validators, including production secret requirements |
| Hardcoded localhost breaks production requests | Incorrect conclusion from this evidence | `services/api/app/main.py:251-270` configures a CORS allowlist fallback; these are not outgoing application requests |
| No build script | Not applicable as a web deployment blocker | `package.json:26-29` provides EAS build commands and `eas.json` defines production builds |
| No auth provider detected | Unresolved/misleading without custom-auth review | `services/api/app/routers/oauth_signin.py:40` verifies Google identity; `services/api/app/core/auth.py` issues and verifies JWTs. Presence does not establish security. |

This is not a random sample or a global accuracy estimate. Dependency advisory matches and other findings have not all been independently adjudicated. Founder-confirmed usefulness and actual fixes are not measured. Do not fix OnFlow to satisfy an incorrect detector; correct the detector and re-evaluate before presenting those items as blockers.
