import type { RepoIndex } from "../files";
import { allDependencies, excerpt, lineOf, readPackageJsons, type PackageJson } from "../files";
import { redact } from "../redact";
import type { Category, RawFinding, ReadinessArea, Severity } from "../types";

/**
 * Business Launch Readiness checks.
 * Every check reports pass / fail / not_applicable so the scorecard shows what was
 * verified, not just what failed. Absence checks are labelled "suspected" because a
 * custom implementation may exist that the patterns do not recognize.
 */

export type CheckStatus = "pass" | "fail" | "not_applicable";

export interface CheckResult {
  id: string;
  category: Category;
  area?: ReadinessArea;
  label: string;
  status: CheckStatus;
  detail: string;
  finding?: RawFinding;
}

interface Ctx {
  repo: RepoIndex;
  deps: Set<string>;
  pkgs: { path: string; pkg: PackageJson }[];
  serverFiles: string[];
  allCode: string[];
}

const CODE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/;
const TEST_FILE_RE = /(\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$)|((^|\/)__tests__\/)|((^|\/)tests?\/.*\.(ts|tsx|js|jsx|py)$)|((^|\/)test_[^/]+\.py$)|(_test\.py$)|((^|\/)e2e\/)/;

function hasDep(ctx: Ctx, ...names: (string | RegExp)[]): string | null {
  for (const d of ctx.deps) for (const n of names) if (typeof n === "string" ? d === n : n.test(d)) return d;
  return null;
}

async function grep(ctx: Ctx, files: string[], re: RegExp): Promise<{ path: string; line: number; text: string } | null> {
  for (const p of files) {
    const text = await ctx.repo.read(p);
    const m = re.exec(text);
    if (m) return { path: p, line: lineOf(text, m.index), text };
  }
  return null;
}

async function grepAll(ctx: Ctx, files: string[], re: RegExp, limit = 20): Promise<{ path: string; line: number; text: string }[]> {
  const out: { path: string; line: number; text: string }[] = [];
  for (const p of files) {
    const text = await ctx.repo.read(p);
    const m = re.exec(text);
    if (m) out.push({ path: p, line: lineOf(text, m.index), text });
    if (out.length >= limit) break;
  }
  return out;
}

function absence(
  ctx: Ctx,
  base: { id: string; category: Category; area?: ReadinessArea; label: string },
  severity: Severity,
  title: string,
  description: string,
  remediation: string,
  searchedFor: string[],
): CheckResult {
  return {
    ...base,
    status: "fail",
    detail: title,
    finding: {
      ruleId: `readiness.${base.id}`,
      source: "readiness",
      category: base.category,
      readinessArea: base.area,
      severity,
      tier: "suspected",
      confidence: "medium",
      title,
      description,
      remediation,
      evidence: { method: "Searched dependencies, file paths and source for known implementations; none were found.", searchedFor, filesInspected: ctx.repo.files.length },
      fingerprintKey: base.id,
    },
  };
}

function pass(base: { id: string; category: Category; area?: ReadinessArea; label: string }, detail: string): CheckResult {
  return { ...base, status: "pass", detail };
}

function na(base: { id: string; category: Category; area?: ReadinessArea; label: string }, detail: string): CheckResult {
  return { ...base, status: "not_applicable", detail };
}

// ───────────────────────── Supabase RLS parser ─────────────────────────

export function tablesMissingRls(sqlFiles: { path: string; text: string }[]): { table: string; path: string; line: number }[] {
  const created = new Map<string, { path: string; line: number }>();
  const enabled = new Set<string>();
  const norm = (n: string) => n.replace(/"/g, "").replace(/^public\./i, "").toLowerCase();
  for (const f of sqlFiles) {
    const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi;
    let m: RegExpExecArray | null;
    while ((m = createRe.exec(f.text)) !== null) {
      const raw = m[1] ?? "";
      if (/\./.test(raw) && !/^"?public"?\./i.test(raw)) continue; // non-public schemas aren't exposed via the API
      const t = norm(raw);
      if (!created.has(t)) created.set(t, { path: f.path, line: lineOf(f.text, m.index) });
    }
    const rlsRe = /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)\s+enable\s+row\s+level\s+security/gi;
    while ((m = rlsRe.exec(f.text)) !== null) enabled.add(norm(m[1] ?? ""));
    const dropRe = /drop\s+table\s+(?:if\s+exists\s+)?((?:"?[\w]+"?\.)?"?[\w]+"?)/gi;
    while ((m = dropRe.exec(f.text)) !== null) created.delete(norm(m[1] ?? ""));
  }
  return [...created.entries()].filter(([t]) => !enabled.has(t)).map(([table, loc]) => ({ table, ...loc }));
}

// ───────────────────────── Checks ─────────────────────────

const AUTH_DEPS: (string | RegExp)[] = [/^@clerk\//, "next-auth", /^@auth\//, "lucia", "better-auth", /^@kinde-oss\//, /^@workos-inc\//, "passport", /^@auth0\//, "@supabase/ssr", "@supabase/auth-helpers-nextjs", "@supabase/auth-ui-react", "firebase", "@react-native-firebase/auth", "django", "flask-login", "devise"];
const HOSTED_AUTH: (string | RegExp)[] = [/^@clerk\//, /^@auth0\//, /^@kinde-oss\//, /^@workos-inc\//];
const PAYMENT_DEPS: (string | RegExp)[] = ["stripe", "@stripe/stripe-js", /^@lemonsqueezy\//, /^@paddle\//, "react-native-purchases", /^@revenuecat\//, /^@polar-sh\//, "@stripe/stripe-react-native"];
const ERROR_TRACKING: (string | RegExp)[] = [/^@sentry\//, /^@bugsnag\//, /^@highlight-run\//, "logrocket", /^@datadog\//, "rollbar", /^@axiomhq\//, "@logtail/node", "honeybadger", "@honeybadger-io/js", "sentry-sdk"];
const RATE_LIMIT: (string | RegExp)[] = ["@upstash/ratelimit", "express-rate-limit", "rate-limiter-flexible", /^@arcjet\//, "limiter", "@nestjs/throttler", "hono-rate-limiter", "slowapi"];
const ANALYTICS: (string | RegExp)[] = ["posthog-js", "posthog-node", "posthog-react-native", "@vercel/analytics", "plausible-tracker", "mixpanel-browser", /^@amplitude\//, /^@segment\//, "@umami/node", "react-ga4", "@next/third-parties"];
const EMAIL: (string | RegExp)[] = ["resend", "@sendgrid/mail", "postmark", "nodemailer", /^@react-email\//, "mailgun.js", "loops", "@aws-sdk/client-ses", "@react-email/components"];
const ENV_VALIDATION: (string | RegExp)[] = [/^@t3-oss\/env/, "envalid", "env-var", "znv", "@julr/vite-plugin-validate-env"];

async function authChecks(ctx: Ctx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const base = { id: "auth-provider", category: "launch_readiness" as const, area: "auth" as const, label: "Authentication provider in place" };
  const provider = hasDep(ctx, ...AUTH_DEPS) ?? ((await grep(ctx, ctx.allCode, /\bsupabase\.auth\.(signIn|signUp|getUser)/)) ? "@supabase/supabase-js (auth)" : null);
  out.push(
    provider
      ? pass(base, `Detected ${provider}.`)
      : absence(ctx, base, "high", "No authentication provider detected", "Paying customers need accounts. No known auth library or Supabase/Firebase auth usage was found, so either auth is missing or it is custom-built (which carries much higher risk).", "Adopt a maintained auth provider (Supabase Auth, Clerk, Auth.js, Better Auth). If auth is custom, have it reviewed specifically: password hashing (argon2/bcrypt), session expiry, CSRF and rate-limited login.", AUTH_DEPS.map(String)),
  );

  // Supabase RLS
  const sqlFiles = ctx.repo.match(/(^|\/)supabase\/migrations\/.*\.sql$/);
  const rlsBase = { id: "supabase-rls", category: "security" as const, area: "auth" as const, label: "Row Level Security on every public table" };
  if (sqlFiles.length === 0) {
    out.push(na(rlsBase, hasDep(ctx, "@supabase/supabase-js") ? "Supabase is used but no supabase/migrations/*.sql were found, so RLS could not be checked from the repository." : "Supabase migrations not present."));
  } else {
    const texts = await Promise.all(sqlFiles.map(async (f) => ({ path: f.path, text: await ctx.repo.read(f.path) })));
    const missing = tablesMissingRls(texts);
    if (missing.length === 0) {
      out.push(pass(rlsBase, `All tables created in ${sqlFiles.length} migration file(s) enable RLS.`));
    } else {
      const first = missing[0]!;
      const firstText = texts.find((t) => t.path === first.path)?.text ?? "";
      out.push({
        ...rlsBase,
        status: "fail",
        detail: `${missing.length} table(s) without RLS.`,
        finding: {
          ruleId: "readiness.supabase-rls-missing",
          source: "readiness",
          category: "security",
          readinessArea: "auth",
          severity: "critical",
          tier: "verified",
          confidence: "high",
          title: `${missing.length} Supabase table(s) have Row Level Security disabled`,
          description: `Tables in the public schema are reachable through Supabase's auto-generated API with the anon key that ships in your frontend. Without RLS, anyone can read or modify them: ${missing.map((m) => m.table).join(", ")}.`,
          remediation: "Add `alter table public.<table> enable row level security;` for each table in a new migration, then add explicit policies (e.g. `using (user_id = auth.uid())`). Test with the anon key that unauthorized reads return zero rows.",
          filePath: first.path,
          startLine: first.line,
          endLine: first.line,
          snippet: redact(excerpt(firstText, first.line, first.line, 2)),
          evidence: { method: "Parsed every supabase/migrations/*.sql file: tables created in the public schema with no matching `enable row level security` statement.", facts: { tables: missing.map((m) => m.table), migrationFiles: sqlFiles.length } },
          fingerprintKey: missing.map((m) => m.table).sort().join(","),
        },
      });
    }

    const permissive = await grepAll(ctx, sqlFiles.map((f) => f.path), /create\s+policy[\s\S]{0,300}?for\s+(all|update|delete|insert)[\s\S]{0,200}?(using|with\s+check)\s*\(\s*true\s*\)/i, 5);
    const polBase = { id: "supabase-permissive-policy", category: "security" as const, area: "auth" as const, label: "No write policies that allow everyone" };
    if (permissive.length === 0) out.push(pass(polBase, "No `using (true)` write policies found."));
    else {
      const p = permissive[0]!;
      out.push({
        ...polBase,
        status: "fail",
        detail: `${permissive.length} permissive write policy file(s).`,
        finding: {
          ruleId: "readiness.supabase-permissive-write-policy",
          source: "readiness",
          category: "security",
          readinessArea: "auth",
          severity: "high",
          tier: "suspected",
          confidence: "medium",
          title: "RLS write policy allows every user (`using (true)`)",
          description: "A policy for insert/update/delete/all uses `true` as its condition, which effectively disables RLS for writes.",
          remediation: "Scope the policy to the row owner, e.g. `using (user_id = auth.uid()) with check (user_id = auth.uid())`, or restrict it to the service role.",
          filePath: p.path,
          startLine: p.line,
          endLine: p.line + 3,
          snippet: redact(excerpt(p.text, p.line, p.line + 3, 0)),
          evidence: { method: "Regex match on CREATE POLICY ... FOR (ALL|UPDATE|DELETE|INSERT) ... (true) in migrations." },
          fingerprintKey: permissive.map((x) => x.path).join(","),
        },
      });
    }
  }

  // Supabase getSession on the server
  if (hasDep(ctx, "@supabase/ssr", "@supabase/supabase-js")) {
    const gs = await grep(ctx, ctx.serverFiles, /auth\.getSession\(\)/);
    const gsBase = { id: "supabase-getsession-server", category: "security" as const, area: "auth" as const, label: "Server code verifies users with getUser()" };
    if (!gs) out.push(pass(gsBase, "No server-side getSession() calls found."));
    else
      out.push({
        ...gsBase,
        status: "fail",
        detail: "Server code trusts getSession().",
        finding: {
          ruleId: "readiness.supabase-getsession-server",
          source: "readiness",
          category: "security",
          readinessArea: "auth",
          severity: "medium",
          tier: "suspected",
          confidence: "medium",
          title: "Server code relies on supabase.auth.getSession()",
          description: "On the server, getSession() reads the session from cookies without revalidating it with Supabase Auth, so a tampered cookie can be trusted. Supabase recommends getUser() (or getClaims()) for authorization decisions.",
          remediation: "Replace `auth.getSession()` with `auth.getUser()` in server components, route handlers, server actions and middleware where the result is used for access control.",
          filePath: gs.path,
          startLine: gs.line,
          endLine: gs.line,
          snippet: redact(excerpt(gs.text, gs.line, gs.line, 2)),
          evidence: { method: "Found auth.getSession() in a file without a \"use client\" directive." },
        },
      });
  }

  // Mutating API routes with no visible auth check
  const routes = ctx.repo
    .match(/(^|\/)(app\/.*\/route\.(ts|js)|pages\/api\/.*\.(ts|js)|api\/.*\.(ts|js))$/)
    .map((f) => f.path)
    .filter((p) => !/(webhook|callback|cron|health|og|sitemap|robots|auth\/)/i.test(p));
  const routeBase = { id: "api-route-auth", category: "security" as const, area: "auth" as const, label: "Mutating API routes check the caller" };
  if (routes.length === 0) out.push(na(routeBase, "No API route files found."));
  else {
    const AUTH_MARKERS = /(getUser|getClaims|getServerSession|auth\(\)|currentUser|getAuth\(|clerkClient|requireUser|requireAuth|withAuth|verifyIdToken|jwtVerify|jwt\.verify|session\b|authorization|Authorization|x-api-key|constructEvent|verifySignature|timingSafeEqual)/;
    const unprotected: string[] = [];
    for (const p of routes) {
      const t = await ctx.repo.read(p);
      const mutating = /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b|export\s+const\s+(POST|PUT|PATCH|DELETE)\b|req\.method\s*===?\s*["'](POST|PUT|PATCH|DELETE)/.test(t);
      if (mutating && !AUTH_MARKERS.test(t)) unprotected.push(p);
    }
    if (unprotected.length === 0) out.push(pass(routeBase, `${routes.length} route file(s) inspected; every mutating handler references an auth check.`));
    else
      out.push({
        ...routeBase,
        status: "fail",
        detail: `${unprotected.length} mutating route(s) with no visible auth check.`,
        finding: {
          ruleId: "readiness.api-route-no-auth",
          source: "readiness",
          category: "security",
          readinessArea: "auth",
          severity: "high",
          tier: "suspected",
          confidence: "low",
          title: `${unprotected.length} API route(s) accept writes without a visible authentication check`,
          description: `These handlers export POST/PUT/PATCH/DELETE but the file contains no recognizable auth or signature check: ${unprotected.slice(0, 10).join(", ")}${unprotected.length > 10 ? "…" : ""}. Auth may live in middleware — verify it covers these paths.`,
          remediation: "At the top of every mutating handler, resolve the user on the server (e.g. `const { data: { user } } = await supabase.auth.getUser()`), return 401 if absent, and check that the user owns the resource being changed.",
          filePath: unprotected[0],
          evidence: { method: "Inspected every API route file for mutating handlers and for common server-side auth calls.", facts: { routes: unprotected.slice(0, 25) }, filesInspected: routes.length },
          fingerprintKey: unprotected.slice().sort().join(","),
        },
      });
  }
  return out;
}

async function billingChecks(ctx: Ctx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const base = { id: "payment-provider", category: "launch_readiness" as const, area: "billing" as const, label: "Can accept payments" };
  const provider = hasDep(ctx, ...PAYMENT_DEPS);
  if (!provider) {
    out.push(absence(ctx, base, "high", "No payment provider integrated", "The app cannot accept paying customers yet: no Stripe, Lemon Squeezy, Paddle, Polar or RevenueCat SDK was found.", "Integrate a payment provider with hosted checkout (Stripe Checkout or Lemon Squeezy) so card data never touches your servers, and grant access from verified webhooks.", PAYMENT_DEPS.map(String)));
    return out;
  }
  out.push(pass(base, `Detected ${provider}.`));

  if (!hasDep(ctx, "stripe")) return out; // deeper checks are Stripe-server specific

  const handlesEvents = await grep(ctx, ctx.serverFiles, /(checkout\.session\.completed|customer\.subscription\.(created|updated|deleted)|invoice\.(paid|payment_succeeded|payment_failed))/);
  const verifies = await grep(ctx, ctx.serverFiles, /webhooks\.constructEvent(Async)?\s*\(/);

  const syncBase = { id: "stripe-webhooks", category: "launch_readiness" as const, area: "billing" as const, label: "Payment state synced from Stripe webhooks" };
  if (!handlesEvents && !verifies)
    out.push(absence(ctx, syncBase, "high", "Stripe is used but no webhook handling was found", "Without webhooks your database never learns about completed checkouts, failed renewals or cancellations, so customers can keep access without paying or lose access after paying.", "Add a webhook route that verifies the signature with `stripe.webhooks.constructEvent(rawBody, signature, secret)` and updates entitlements for checkout.session.completed, customer.subscription.updated/deleted and invoice.payment_failed.", ["checkout.session.completed", "customer.subscription.*", "webhooks.constructEvent"]));
  else out.push(pass(syncBase, "Webhook event handling found."));

  const sigBase = { id: "stripe-webhook-signature", category: "security" as const, area: "billing" as const, label: "Stripe webhook signatures verified" };
  if (handlesEvents && !verifies) {
    out.push({
      ...sigBase,
      status: "fail",
      detail: "Events handled without signature verification.",
      finding: {
        ruleId: "readiness.stripe-webhook-unverified",
        source: "readiness",
        category: "security",
        readinessArea: "billing",
        severity: "critical",
        tier: "verified",
        confidence: "high",
        title: "Stripe webhook events are processed without signature verification",
        description: "The code handles Stripe events but never calls `stripe.webhooks.constructEvent`. Anyone who finds the endpoint can POST a fake `checkout.session.completed` and grant themselves paid access.",
        remediation: "Read the raw request body (`await req.text()`), verify it with `stripe.webhooks.constructEvent(body, req.headers.get('stripe-signature'), STRIPE_WEBHOOK_SECRET)`, and return 400 on failure before touching the database.",
        filePath: handlesEvents.path,
        startLine: handlesEvents.line,
        endLine: handlesEvents.line,
        snippet: redact(excerpt(handlesEvents.text, handlesEvents.line, handlesEvents.line, 3)),
        evidence: { method: "Stripe event types are handled in server code, and no call to webhooks.constructEvent/constructEventAsync exists anywhere in the repository.", filesInspected: ctx.serverFiles.length },
        fingerprintKey: "stripe-webhook-unverified",
      },
    });
  } else if (verifies) {
    const parsedFirst = /await\s+(req|request)\.json\(\)/.test(verifies.text);
    if (parsedFirst)
      out.push({
        ...sigBase,
        status: "fail",
        detail: "Body parsed as JSON before verification.",
        finding: {
          ruleId: "readiness.stripe-webhook-parsed-body",
          source: "readiness",
          category: "reliability",
          readinessArea: "billing",
          severity: "high",
          tier: "suspected",
          confidence: "medium",
          title: "Webhook body is parsed as JSON in the same file that verifies the signature",
          description: "Stripe signatures are computed over the raw bytes. Verifying a re-serialized JSON body fails, which often leads developers to disable verification to 'fix' it.",
          remediation: "Use `const body = await req.text()` and pass that exact string to constructEvent. Do not call req.json() in the webhook route.",
          filePath: verifies.path,
          startLine: verifies.line,
          endLine: verifies.line,
          snippet: redact(excerpt(verifies.text, verifies.line, verifies.line, 3)),
          evidence: { method: "Found both constructEvent and `await req.json()` in the webhook file." },
        },
      });
    else out.push(pass(sigBase, `constructEvent found in ${verifies.path}.`));

    const idemBase = { id: "stripe-webhook-idempotency", category: "reliability" as const, area: "billing" as const, label: "Webhook handling is idempotent" };
    if (/event\.id/.test(verifies.text)) out.push(pass(idemBase, "Event id is referenced in the webhook handler."));
    else
      out.push(
        absence(ctx, idemBase, "low", "Webhook handler does not appear to de-duplicate events", "Stripe retries deliveries and may send the same event more than once. Without de-duplication a single purchase can grant credits twice.", "Store processed `event.id` values in a table with a unique constraint and skip events you have already handled.", ["event.id"]),
      );
  } else {
    out.push(na(sigBase, "No webhook handler to verify."));
  }

  const trust = await grep(ctx, ctx.serverFiles, /unit_amount\s*:\s*(req|request|body|input|data|params)\b[.\[]/);
  const priceBase = { id: "server-side-pricing", category: "security" as const, area: "billing" as const, label: "Prices set on the server" };
  if (!trust) out.push(pass(priceBase, "No client-supplied amounts passed to Stripe."));
  else
    out.push({
      ...priceBase,
      status: "fail",
      detail: "Checkout amount comes from the request.",
      finding: {
        ruleId: "readiness.client-controlled-price",
        source: "readiness",
        category: "security",
        readinessArea: "billing",
        severity: "high",
        tier: "suspected",
        confidence: "medium",
        title: "Checkout amount is taken from the request body",
        description: "The amount charged is read from client input, so a user can edit the request and pay $0.01.",
        remediation: "Use Stripe Price IDs defined in your dashboard (or a server-side price table) and only accept a product/plan identifier from the client.",
        filePath: trust.path,
        startLine: trust.line,
        endLine: trust.line,
        snippet: redact(excerpt(trust.text, trust.line, trust.line, 2)),
        evidence: { method: "Regex match: `unit_amount:` assigned from req/body/input." },
      },
    });
  return out;
}

async function onboardingChecks(ctx: Ctx, billing: boolean): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const hosted = hasDep(ctx, ...HOSTED_AUTH);

  const signupBase = { id: "signup-flow", category: "launch_readiness" as const, area: "onboarding" as const, label: "Sign-up flow exists" };
  const signupPath = ctx.repo.match(/(sign-?up|register|join|onboarding|get-started)/i)[0];
  const signupCode = signupPath ? null : await grep(ctx, ctx.allCode, /(auth\.signUp\(|<SignUp\b|createUserWithEmailAndPassword|signIn\(["'](email|google|github))/);
  if (signupPath || signupCode || hosted) out.push(pass(signupBase, signupPath ? `Found ${signupPath.path}.` : signupCode ? `Sign-up call in ${signupCode.path}.` : `Hosted auth (${hosted}) provides sign-up.`));
  else out.push(absence(ctx, signupBase, "medium", "No sign-up or onboarding flow found", "No sign-up page, onboarding route or sign-up API call was detected, so new customers may have no way to create an account.", "Add a sign-up page wired to your auth provider and a first-run onboarding step that gets users to the core value quickly.", ["sign-up/register/onboarding paths", "auth.signUp", "<SignUp>"]));

  const resetBase = { id: "password-reset", category: "launch_readiness" as const, area: "onboarding" as const, label: "Account recovery exists" };
  const reset = ctx.repo.match(/(forgot|reset)[-_]?(password)?/i)[0] ?? (await grep(ctx, ctx.allCode, /(resetPasswordForEmail|sendPasswordResetEmail|forgotPassword|magicLink|signInWithOtp)/));
  if (hosted) out.push(na(resetBase, `Account recovery handled by ${hosted}.`));
  else if (reset) out.push(pass(resetBase, "Password reset / magic link flow found."));
  else out.push(absence(ctx, resetBase, "medium", "No password reset or account recovery flow found", "Customers who forget their password are locked out and will churn or open support tickets.", "Add a forgot-password flow (e.g. `supabase.auth.resetPasswordForEmail`) or switch to magic-link/OAuth sign-in.", ["forgot/reset paths", "resetPasswordForEmail", "signInWithOtp"]));

  const legalBase = { id: "legal-pages", category: "launch_readiness" as const, area: "onboarding" as const, label: "Terms of Service and Privacy Policy" };
  const terms = ctx.repo.match(/(terms|tos)([-_.]|\/|of-service)/i)[0] ?? ctx.repo.match(/(^|\/)terms(\/|\.|$)/i)[0];
  const privacy = ctx.repo.match(/privacy/i)[0];
  if (terms && privacy) out.push(pass(legalBase, `Found ${terms.path} and ${privacy.path}.`));
  else
    out.push(
      absence(
        ctx,
        legalBase,
        billing ? "high" : "medium",
        `Missing ${[!terms ? "Terms of Service" : null, !privacy ? "Privacy Policy" : null].filter(Boolean).join(" and ")}`,
        "Payment providers, app stores and OAuth providers require a public privacy policy (and usually terms) before you charge customers or collect personal data.",
        "Publish /terms and /privacy pages, link them in the footer and on the sign-up form, and describe which third parties (hosting, payments, analytics, AI providers) process user data.",
        ["terms", "privacy"],
      ),
    );

  const emailBase = { id: "transactional-email", category: "launch_readiness" as const, area: "onboarding" as const, label: "Transactional email provider" };
  const email = hasDep(ctx, ...EMAIL);
  if (email) out.push(pass(emailBase, `Detected ${email}.`));
  else out.push(absence(ctx, emailBase, "low", "No transactional email provider found", "You will need email for receipts, onboarding and account notices. Auth providers send auth emails only, often from shared low-reputation senders with tight rate limits.", "Add a transactional email provider (Resend, Postmark, SendGrid) with your own verified domain (SPF/DKIM).", EMAIL.map(String)));
  return out;
}

async function deploymentChecks(ctx: Ctx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const nodeProject = ctx.pkgs.length > 0;
  const rootPkg = ctx.pkgs.find((p) => p.path === "package.json") ?? ctx.pkgs[0];

  const buildBase = { id: "build-script", category: "launch_readiness" as const, area: "deployment_config" as const, label: "Production build script" };
  if (!nodeProject) out.push(na(buildBase, "Not a Node.js project."));
  else if (ctx.pkgs.some((p) => p.pkg.scripts?.build)) out.push(pass(buildBase, "`build` script defined."));
  else out.push(absence(ctx, buildBase, "high", "No `build` script in package.json", "Hosting providers run a build command. Without one, deployments are manual and unreproducible.", 'Add a `"build"` script (e.g. `"next build"`) and make sure it passes locally from a clean checkout.', ["scripts.build"]));

  const lockBase = { id: "lockfile", category: "reliability" as const, area: "deployment_config" as const, label: "Dependency lockfile committed" };
  if (!nodeProject) out.push(na(lockBase, "Not a Node.js project."));
  else if (ctx.repo.match(/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|bun\.lock)$/).length > 0) out.push(pass(lockBase, "Lockfile present."));
  else out.push(absence(ctx, lockBase, "high", "No dependency lockfile committed", "Every deploy may install different dependency versions, so a build that worked yesterday can break (or pull a compromised release) today. Dependency vulnerabilities could also not be checked.", "Commit your package manager's lockfile and use `npm ci` / `pnpm install --frozen-lockfile` in CI and deploys.", ["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lock"]));

  const usesEnv = await grep(ctx, ctx.allCode, /process\.env\.|import\.meta\.env\.|os\.environ/);
  const envExBase = { id: "env-example", category: "launch_readiness" as const, area: "deployment_config" as const, label: "Environment variables documented" };
  if (!usesEnv) out.push(na(envExBase, "No environment variable usage found."));
  else if (ctx.repo.match(/(^|\/)\.env\.(example|sample|template)$/i).length > 0) out.push(pass(envExBase, ".env example file present."));
  else out.push(absence(ctx, envExBase, "medium", "No .env.example documenting required environment variables", "Deploying to a new environment (or recovering from an incident) requires guessing which variables are needed. Missing variables usually surface as runtime crashes in production.", "Commit a `.env.example` listing every variable with placeholder values and a one-line comment each.", [".env.example", ".env.sample"]));

  const valBase = { id: "env-validation", category: "reliability" as const, area: "deployment_config" as const, label: "Environment validated at startup" };
  const validated = hasDep(ctx, ...ENV_VALIDATION) ?? (await grep(ctx, ctx.allCode, /z\.object\([\s\S]{0,400}process\.env|\.parse\(process\.env\)|safeParse\(process\.env\)/))?.path;
  if (!usesEnv) out.push(na(valBase, "No environment variable usage found."));
  else if (validated) out.push(pass(valBase, `Environment validation found (${validated}).`));
  else out.push(absence(ctx, valBase, "low", "Environment variables are not validated at startup", "A missing or malformed variable fails at the moment a customer hits that code path instead of at deploy time.", "Validate env once at startup with a schema (zod / @t3-oss/env) and fail the deploy if anything is missing.", ENV_VALIDATION.map(String)));

  const engBase = { id: "runtime-pinned", category: "reliability" as const, area: "deployment_config" as const, label: "Runtime version pinned" };
  if (!nodeProject) out.push(na(engBase, "Not a Node.js project."));
  else if (rootPkg?.pkg.engines?.node || ctx.repo.match(/(^|\/)(\.nvmrc|\.node-version|\.tool-versions)$/).length > 0) out.push(pass(engBase, "Node version pinned."));
  else out.push(absence(ctx, engBase, "low", "Node.js version is not pinned", "Your host may upgrade Node underneath you, causing builds or runtime behavior to change unexpectedly.", 'Add `"engines": { "node": ">=20 <23" }` to package.json and a `.nvmrc`.', ["engines.node", ".nvmrc", ".node-version"]));

  const nextCfg = ctx.repo.match(/(^|\/)next\.config\.(js|mjs|ts|cjs)$/)[0];
  const ignoreBase = { id: "build-errors-not-ignored", category: "reliability" as const, area: "deployment_config" as const, label: "Type and lint errors block deploys" };
  if (!nextCfg) out.push(na(ignoreBase, "No Next.js config."));
  else {
    const t = await ctx.repo.read(nextCfg.path);
    const m = /(ignoreBuildErrors|ignoreDuringBuilds)\s*:\s*true/.exec(t);
    if (!m) out.push(pass(ignoreBase, "Build does not ignore type/lint errors."));
    else {
      const line = lineOf(t, m.index);
      out.push({
        ...ignoreBase,
        status: "fail",
        detail: "Build errors are ignored.",
        finding: {
          ruleId: "readiness.next-ignores-build-errors",
          source: "readiness",
          category: "reliability",
          readinessArea: "deployment_config",
          severity: "medium",
          tier: "verified",
          confidence: "high",
          title: "Next.js is configured to deploy even when type checking or linting fails",
          description: "`ignoreBuildErrors`/`ignoreDuringBuilds` lets broken code reach production silently.",
          remediation: "Remove the flag, fix the reported errors, and keep type checking as a deploy gate.",
          filePath: nextCfg.path,
          startLine: line,
          endLine: line,
          snippet: redact(excerpt(t, line, line, 2)),
          evidence: { method: "Exact match in next.config." },
        },
      });
    }
  }

  const ciBase = { id: "ci", category: "reliability" as const, area: "deployment_config" as const, label: "Continuous integration" };
  const ci = ctx.repo.match(/(^\.github\/workflows\/.*\.ya?ml$)|(^\.gitlab-ci\.yml$)|(^\.circleci\/)|(^bitbucket-pipelines\.yml$)/);
  if (ci.length > 0) out.push(pass(ciBase, `${ci.length} CI config file(s).`));
  else out.push(absence(ctx, ciBase, "medium", "No CI pipeline", "Nothing automatically checks that main builds and tests pass before it deploys.", "Add a GitHub Actions workflow that installs with the lockfile, type-checks, runs tests and builds on every pull request.", [".github/workflows/*.yml"]));

  const localhost = await grepAll(
    ctx,
    ctx.serverFiles.concat(ctx.allCode).filter((p, i, a) => a.indexOf(p) === i && !TEST_FILE_RE.test(p) && !/config|\.env|README/i.test(p)),
    /["'`]https?:\/\/(localhost|127\.0\.0\.1):\d+/,
    5,
  );
  const lhBase = { id: "no-hardcoded-localhost", category: "reliability" as const, area: "deployment_config" as const, label: "No hardcoded localhost URLs" };
  if (localhost.length === 0) out.push(pass(lhBase, "No hardcoded localhost URLs in application code."));
  else {
    const l = localhost[0]!;
    out.push({
      ...lhBase,
      status: "fail",
      detail: `${localhost.length} file(s) reference localhost.`,
      finding: {
        ruleId: "readiness.hardcoded-localhost",
        source: "readiness",
        category: "reliability",
        readinessArea: "deployment_config",
        severity: "medium",
        tier: "suspected",
        confidence: "medium",
        title: "Hardcoded localhost URL in application code",
        description: `A localhost URL is hardcoded in ${localhost.map((x) => x.path).join(", ")}. In production these requests fail or redirect users to their own machine.`,
        remediation: "Read the base URL from an environment variable (e.g. NEXT_PUBLIC_APP_URL) and fall back to localhost only in development.",
        filePath: l.path,
        startLine: l.line,
        endLine: l.line,
        snippet: redact(excerpt(l.text, l.line, l.line, 1)),
        evidence: { method: "Regex match for http(s)://localhost:PORT in non-test, non-config source." },
        fingerprintKey: localhost.map((x) => x.path).sort().join(","),
      },
    });
  }

  const migBase = { id: "db-migrations", category: "reliability" as const, area: "deployment_config" as const, label: "Database schema under version control" };
  const prismaSchema = ctx.repo.has("prisma/schema.prisma") || ctx.repo.match(/(^|\/)schema\.prisma$/).length > 0;
  const prismaMigs = ctx.repo.match(/(^|\/)prisma\/migrations\//).length > 0;
  const drizzle = hasDep(ctx, "drizzle-orm");
  const drizzleMigs = ctx.repo.match(/(^|\/)(drizzle|migrations)\/.*\.sql$/).length > 0;
  const supabase = hasDep(ctx, "@supabase/supabase-js");
  const supaMigs = ctx.repo.match(/(^|\/)supabase\/migrations\/.*\.sql$/).length > 0;
  const usesDb = prismaSchema || drizzle || supabase;
  if (!usesDb) out.push(na(migBase, "No supported database toolkit detected."));
  else if ((prismaSchema && !prismaMigs) || (drizzle && !drizzleMigs) || (supabase && !supaMigs && !prismaSchema && !drizzle))
    out.push(absence(ctx, migBase, "medium", "Database schema changes are not tracked as migrations", "The production schema can't be reproduced or reviewed, and changes made in a dashboard (including RLS policies) can be lost or drift between environments. RLS could not be verified.", "Generate migrations (`supabase db diff`, `prisma migrate dev`, `drizzle-kit generate`), commit them, and apply them in CI/CD instead of editing production by hand.", ["supabase/migrations", "prisma/migrations", "drizzle/*.sql"]));
  else out.push(pass(migBase, "Migrations are committed."));
  return out;
}

async function operationsChecks(ctx: Ctx, hasApi: boolean): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const errBase = { id: "error-tracking", category: "launch_readiness" as const, area: "operations" as const, label: "Error tracking" };
  const err = hasDep(ctx, ...ERROR_TRACKING);
  if (err) out.push(pass(errBase, `Detected ${err}.`));
  else out.push(absence(ctx, errBase, "high", "No error tracking", "When a paying customer hits a crash you will not find out unless they email you — most just leave.", "Add an error tracker (Sentry, Highlight, Bugsnag) to both the frontend and server, with release tracking and alerts to your phone/email.", ERROR_TRACKING.map(String)));

  const rlBase = { id: "rate-limiting", category: "security" as const, area: "operations" as const, label: "Rate limiting on public endpoints" };
  const rl = hasDep(ctx, ...RATE_LIMIT) ?? (await grep(ctx, ctx.serverFiles, /(rateLimit|ratelimit|RateLimiter|throttle)\s*\(/))?.path;
  if (!hasApi) out.push(na(rlBase, "No server API routes detected."));
  else if (rl) out.push(pass(rlBase, `Rate limiting found (${rl}).`));
  else out.push(absence(ctx, rlBase, "medium", "No rate limiting on API endpoints", "Login, sign-up and AI/LLM endpoints without rate limits invite credential stuffing, spam sign-ups and runaway API bills.", "Add rate limiting (e.g. @upstash/ratelimit) to auth, sign-up and any endpoint that costs you money per call.", RATE_LIMIT.map(String)));

  const healthBase = { id: "health-endpoint", category: "reliability" as const, area: "operations" as const, label: "Health check endpoint" };
  const health = ctx.repo.match(/(^|\/)(api\/)?(health|healthz|status|ping)(\/route\.(ts|js)|\.(ts|js|py))$/)[0];
  if (!hasApi) out.push(na(healthBase, "No server API detected."));
  else if (health) out.push(pass(healthBase, `Found ${health.path}.`));
  else out.push(absence(ctx, healthBase, "low", "No health check endpoint", "Uptime monitors need an endpoint to poll; without one, outages are noticed by customers first.", "Add a lightweight /api/health route (checks DB connectivity) and point an uptime monitor at it.", ["/api/health", "/healthz", "/status"]));

  const anBase = { id: "analytics", category: "launch_readiness" as const, area: "operations" as const, label: "Product analytics" };
  const an = hasDep(ctx, ...ANALYTICS) ?? (await grep(ctx, ctx.allCode, /(plausible\.io|googletagmanager|gtag\(|umami)/))?.path;
  if (an) out.push(pass(anBase, `Detected ${an}.`));
  else out.push(absence(ctx, anBase, "low", "No product analytics", "You won't be able to see where users drop off between sign-up and payment.", "Add privacy-friendly analytics (PostHog, Plausible, Vercel Analytics) and track sign-up → activation → checkout.", ANALYTICS.map(String)));

  const hdrBase = { id: "security-headers", category: "security" as const, area: "operations" as const, label: "Security headers" };
  const nextCfg = ctx.repo.match(/(^|\/)next\.config\.(js|mjs|ts|cjs)$/)[0];
  const headers =
    hasDep(ctx, "helmet", "@fastify/helmet") ??
    (await grep(ctx, ctx.allCode.concat(nextCfg ? [nextCfg.path] : []), /(Content-Security-Policy|X-Frame-Options|Strict-Transport-Security)/))?.path;
  if (!hasApi && !nextCfg) out.push(na(hdrBase, "No web server detected."));
  else if (headers) out.push(pass(hdrBase, `Security headers configured (${headers}).`));
  else out.push(absence(ctx, hdrBase, "low", "No security headers configured", "Missing headers like X-Frame-Options and HSTS leave the app open to clickjacking and downgrade attacks.", "Set X-Frame-Options, X-Content-Type-Options, Referrer-Policy and Strict-Transport-Security (next.config `headers()` or helmet).", ["Content-Security-Policy", "X-Frame-Options", "helmet"]));
  return out;
}

async function testingChecks(ctx: Ctx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const tests = ctx.repo.files.filter((f) => TEST_FILE_RE.test(f.path) && f.language);
  const source = ctx.repo.sourceFiles.filter((f) => !TEST_FILE_RE.test(f.path) && f.language !== "SQL");

  const exBase = { id: "tests-exist", category: "testing" as const, label: "Automated tests exist" };
  if (tests.length === 0) {
    out.push(absence(ctx, exBase, "high", "No automated tests", "Every change is shipped without a safety net; regressions in sign-up, checkout or data access will reach customers.", "Start with a handful of high-value tests: auth (can't access other users' data), checkout webhook (grants access exactly once), and the core happy path. Add them to CI.", ["*.test.*", "*.spec.*", "__tests__/", "tests/"]));
    return out;
  }
  out.push(pass(exBase, `${tests.length} test file(s) for ${source.length} source file(s).`));

  const ratioBase = { id: "test-ratio", category: "testing" as const, label: "Test coverage breadth" };
  const ratio = source.length === 0 ? 1 : tests.length / source.length;
  if (ratio >= 0.1) out.push(pass(ratioBase, `${(ratio * 100).toFixed(0)}% test files per source file.`));
  else
    out.push({
      ...ratioBase,
      status: "fail",
      detail: `${(ratio * 100).toFixed(1)}% test files per source file.`,
      finding: {
        ruleId: "readiness.low-test-ratio",
        source: "readiness",
        category: "testing",
        severity: "low",
        tier: "verified",
        confidence: "high",
        title: `Only ${tests.length} test file(s) for ${source.length} source files`,
        description: "Test files are a small fraction of the codebase (file count, not line coverage — line coverage was not measured).",
        remediation: "Prioritize tests for code that handles money, permissions and user data before broad coverage.",
        evidence: { method: "Counted test files vs. non-test source files.", facts: { testFiles: tests.length, sourceFiles: source.length } },
        fingerprintKey: "low-test-ratio",
      },
    });

  const scriptBase = { id: "test-script", category: "testing" as const, label: "Tests runnable with one command" };
  if (ctx.pkgs.length === 0) out.push(na(scriptBase, "Not a Node.js project."));
  else if (ctx.pkgs.some((p) => p.pkg.scripts?.test && !/no test specified/.test(p.pkg.scripts.test))) out.push(pass(scriptBase, "`test` script defined."));
  else out.push(absence(ctx, scriptBase, "medium", "Tests exist but there is no `test` script", "Without a standard command, tests are rarely run and can't be wired into CI.", 'Add `"test": "vitest run"` (or your runner) to package.json.', ["scripts.test"]));

  const ciBase = { id: "tests-in-ci", category: "testing" as const, label: "Tests run in CI" };
  const workflows = ctx.repo.match(/^\.github\/workflows\/.*\.ya?ml$/);
  if (workflows.length === 0) out.push(na(ciBase, "No CI configured (reported separately)."));
  else {
    const runs = await grep(ctx, workflows.map((w) => w.path), /(npm|pnpm|yarn|bun)\s+(run\s+)?test|vitest|jest|pytest|playwright\s+test/);
    if (runs) out.push(pass(ciBase, `Tests run in ${runs.path}.`));
    else out.push(absence(ctx, ciBase, "medium", "CI does not run the test suite", "Tests exist but nothing enforces them before merge/deploy.", "Add a `test` step to your CI workflow and require it to pass before merging.", ["npm test", "vitest", "jest", "pytest"]));
  }
  return out;
}

async function maintainabilityChecks(ctx: Ctx): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const tsBase = { id: "ts-strict", category: "maintainability" as const, label: "TypeScript strict mode" };
  const tsconfig = ctx.repo.match(/(^|\/)tsconfig\.json$/)[0];
  if (!tsconfig) out.push(na(tsBase, "No tsconfig.json."));
  else {
    const t = await ctx.repo.read(tsconfig.path);
    if (/"strict"\s*:\s*true/.test(t)) out.push(pass(tsBase, "strict: true."));
    else out.push(absence(ctx, tsBase, "low", "TypeScript strict mode is off", "Without strict mode, null/undefined bugs and implicit `any` slip through the compiler into production.", 'Enable `"strict": true` in tsconfig.json and fix errors incrementally (start with strictNullChecks).', ['"strict": true']));
  }

  const bigBase = { id: "large-files", category: "maintainability" as const, label: "No oversized source files" };
  const big: { path: string; lines: number }[] = [];
  for (const f of ctx.repo.sourceFiles) {
    if (f.language === "SQL" || TEST_FILE_RE.test(f.path)) continue;
    const lines = (await ctx.repo.read(f.path)).split("\n").length;
    if (lines > 800) big.push({ path: f.path, lines });
  }
  if (big.length === 0) out.push(pass(bigBase, "No source file exceeds 800 lines."));
  else
    out.push({
      ...bigBase,
      status: "fail",
      detail: `${big.length} file(s) over 800 lines.`,
      finding: {
        ruleId: "readiness.large-files",
        source: "readiness",
        category: "maintainability",
        severity: "low",
        tier: "verified",
        confidence: "high",
        title: `${big.length} source file(s) exceed 800 lines`,
        description: `Large files are hard to review and are where AI-assisted edits most often introduce regressions: ${big.slice(0, 8).map((b) => `${b.path} (${b.lines})`).join(", ")}.`,
        remediation: "Split by responsibility (UI, data access, business rules). Do it incrementally, one extraction per PR, with tests around the extracted logic.",
        filePath: big[0]?.path,
        evidence: { method: "Counted lines per source file.", facts: { files: big.map((b) => `${b.path}:${b.lines}`) } },
        fingerprintKey: big.map((b) => b.path).sort().join(","),
      },
    });
  return out;
}

export interface ReadinessResult {
  checks: CheckResult[];
  findings: RawFinding[];
}

export async function runReadinessChecks(repo: RepoIndex): Promise<ReadinessResult> {
  const pkgs = await readPackageJsons(repo);
  const deps = allDependencies(pkgs);
  for (const req of repo.match(/(^|\/)(requirements(-[a-z]+)?\.txt|pyproject\.toml|Gemfile)$/)) {
    const text = await repo.read(req.path);
    for (const m of text.matchAll(/^\s*["']?([A-Za-z0-9_.\-]+)/gm)) if (m[1]) deps.add(m[1].toLowerCase());
  }
  const allCode = repo.files.filter((f) => CODE_RE.test(f.path) && !TEST_FILE_RE.test(f.path)).map((f) => f.path);
  const serverFiles: string[] = [];
  for (const p of allCode) {
    const head = (await repo.read(p)).slice(0, 200);
    if (!/^\s*["']use client["']/.test(head)) serverFiles.push(p);
  }
  const ctx: Ctx = { repo, deps, pkgs, serverFiles, allCode };
  const hasApi = repo.match(/(^|\/)(app\/.*\/route\.(ts|js)|pages\/api\/|api\/|server\/|routes\/)/).length > 0 || hasDep(ctx, "express", "fastify", "hono", "koa", "@nestjs/core", "django", "flask", "fastapi") !== null;

  const auth = await authChecks(ctx);
  const billing = await billingChecks(ctx);
  const hasBilling = billing.some((c) => c.id === "payment-provider" && c.status === "pass");
  const checks = [
    ...auth,
    ...billing,
    ...(await onboardingChecks(ctx, hasBilling)),
    ...(await deploymentChecks(ctx)),
    ...(await operationsChecks(ctx, hasApi)),
    ...(await testingChecks(ctx)),
    ...(await maintainabilityChecks(ctx)),
  ];
  return { checks, findings: checks.flatMap((c) => (c.finding ? [c.finding] : [])) };
}
