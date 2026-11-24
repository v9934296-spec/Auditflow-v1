# Auditflow v1: Phase 1 audit-integrity implementation

## Bound source
- GitHub: `v9934296-spec/Auditflow-v1`, `main` commit `6e5794bc1f73dbd596990c474707c4ec996f31b3` (read and verified via connected GitHub integration).
- Original supplied project: `ventriva-audit-mvp.zip`. All 11 pre-existing touched files match the exact GitHub `main` blob IDs; `tests/coverage.test.ts` is new.
- Local implementation commit: `b5b0c9a` (isolated copy, not pushed).
- No changes to `main`, no PR or deployment carried out.

## Scope / changes
1. AI label no longer changes deterministic category score, live finding counts, or launch verdict (`scoring.ts`, rubric `2026.11-p1`).
2. Required scanner evidence now fails closed: missing, skipped, failed or partial required scanner; truncated extraction; low actual source coverage; unscanned supported-language source all prevent a numeric approval score and a clean verdict. A discovered P0 still reports `not_launch_ready` without a numeric score.
3. Positive source coverage is deduplicated union of source file paths actually reported scanned by Semgrep/ESLint. No longer inferred from `SCANNED_LANGUAGES` after any scanner executes. Unsupported SQL is no longer included in scannable languages because bundled code rules do not cover it.
4. ESLint tracks successfully parsed source files and failed files separately and reports `partial` on parse errors. Semgrep uses its JSON scanned/skipped paths and errors, and reports `partial` when evidence is missing.
5. OSV severity uses advisory labels or supported CVSS v2/v3 base vectors; unknown severity (including unsupported CVSS v4) is marked suspected/high and results in `partial` coverage instead of falsely categorizing as medium. Invalid querybatch shape, failed detail lookups, malformed lockfiles, and the 150-advisory expansion cap also produce partial status.
6. The report now labels the file count as positively code-scanned rather than treating every extracted file as analyzed.
7. Replaced obsolete tests expecting AI-dismissed findings to disappear or disabled scanners to yield numeric scores; added `tests/coverage.test.ts` and OSV regression cases.

## Verification evidence (fresh)
- **Red:** `node ../phase1-offline-verify.cjs` against unmodified source: 0/6, exit 1, six behavior failures (AI influence, incomplete scanner gate, CVSS downgrade, ignored OSV detail failure, invalid querybatch, inflated source coverage).
- **Green:** Same command against patched source: 12/12, exit 0. Tests execute actual TS modules via globally installed TypeScript transpilation, stubbing only scanner subprocesses and external responses as needed. This is NOT Vitest or a full build.
- `git diff --cached --check`: exit 0 (no whitespace errors).
- TypeScript parser: 12 modified/new TS/TSX files parsed with 0 syntax errors, using the available global TypeScript 5.8.3. This is NOT a semantic typecheck; project specifies 5.9.x.
- Patch: `git apply --check` against fresh original ZIP: exit 0; applying it produced byte-for-byte identical content across all 12 changed files.
- Baseline: remote Git tree SHA matched source blob SHA for all 11 pre-existing touched paths.
- `npm ci --offline --ignore-scripts ...`: exit 1 (`ENOTCACHED`: `zod-validation-error-5.0.0.tgz` not in cache). Attempted ordinary `npm ci` timed out without successful installation. Vitest, full typecheck and Next.js production build therefore **not run**.

## Not covered in Phase 1
- Recheck fingerprints and stale AI annotations (Phase 2).
- Stripe events, refunds, subscriptions and cost caps (Phase 3).
- Auth redirect and broader security posture (Phase 4).
- Real GitHub, Supabase, Trigger.dev, Stripe staging; end-to-end test and deployment (Phase 5).

## Apply in GitHub repository
From the **repository root** (not the `ventriva-audit` subfolder):

```bash
git switch main && git pull --ff-only
git switch -c fix/phase1-audit-integrity
git apply --check /path/to/Auditflow-Phase1-audit-integrity.patch
git apply /path/to/Auditflow-Phase1-audit-integrity.patch
cd ventriva-audit
npm ci
npm run typecheck
npm test
npm run build
cd ..
git add ventriva-audit
git commit -m "fix(audit): deterministic scoring and scanner evidence gate"
git push -u origin fix/phase1-audit-integrity
```

Request review before merge. Do not deploy or call this release-ready until the full suite/build and staging gates are green. The existing CI workflow is nested under `ventriva-audit/.github/workflows/` and would need to live at the GitHub repository root to trigger automatically.
