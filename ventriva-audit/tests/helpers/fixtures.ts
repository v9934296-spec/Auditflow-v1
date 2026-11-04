function b64url(o: object): string {
  return Buffer.from(JSON.stringify(o)).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** A fabricated (invalid-signature) Supabase-style JWT with the given role. */
export function fakeJwt(role: string): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url({ iss: "supabase", role, iat: 1700000000 })}.c2lnbmF0dXJlX25vdF9yZWFsX2p1c3RfZm9yX3Rlc3Rz`;
}

/** Fake Stripe-format key assembled at runtime so no literal secret lives in the repo. */
export const FAKE_STRIPE_LIVE = ["sk", "live", "51H8abcdefghijklmnopqrstuvwxyzABCDEF"].join("_");

/** Typical vibe-coded SaaS with real launch blockers. */
export function vulnerableRepo(): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: "vibe-app",
      scripts: { dev: "next dev" },
      dependencies: { next: "15.0.0", react: "19.0.0", "@supabase/supabase-js": "2.45.0", stripe: "16.0.0" },
    }),
    ".env": `NEXT_PUBLIC_SUPABASE_URL=https://abc.supabase.co\nSUPABASE_SERVICE_ROLE_KEY=${fakeJwt("service_role")}\n`,
    "lib/stripe.ts": `import Stripe from "stripe";\nexport const stripe = new Stripe("${FAKE_STRIPE_LIVE}");\n`,
    "app/api/webhook/route.ts": [
      "import { stripe } from '@/lib/stripe';",
      "export async function POST(req: Request) {",
      "  const event = await req.json();",
      "  if (event.type === 'checkout.session.completed') {",
      "    await grantAccess(event.data.object.customer);",
      "  }",
      "  return new Response('ok');",
      "}",
    ].join("\n"),
    "app/api/projects/route.ts": [
      "import { db } from '@/lib/db';",
      "export async function DELETE(req: Request) {",
      "  const { id } = await req.json();",
      "  await db.query(`delete from projects where id = ${id}`);",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n"),
    "app/page.tsx": `export default function Page() { return <main>Hello</main>; }\n`,
    "supabase/migrations/0001.sql": "create table public.projects (id uuid primary key, user_id uuid);\ncreate table profiles (id uuid primary key);\nalter table public.profiles enable row level security;\n",
    "next.config.ts": "export default { typescript: { ignoreBuildErrors: true } };\n",
  };
}

/** A reasonably production-ready app. */
export function healthyRepo(): Record<string, string> {
  return {
    "package.json": JSON.stringify({
      name: "good-app",
      engines: { node: ">=20" },
      scripts: { build: "next build", test: "vitest run" },
      dependencies: { next: "15.0.0", "@supabase/ssr": "0.5.0", "@supabase/supabase-js": "2.45.0", stripe: "16.0.0", "@sentry/nextjs": "8.0.0", "@upstash/ratelimit": "2.0.0", resend: "4.0.0", "posthog-js": "1.0.0", "@t3-oss/env-nextjs": "0.11.0" },
    }),
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": { name: "good-app" }, "node_modules/next": { version: "15.0.0" } } }),
    ".env.example": `STRIPE_SECRET_KEY=${["sk", "test", "x".repeat(24)].join("_")}\n`,
    "tsconfig.json": '{ "compilerOptions": { "strict": true } }',
    ".github/workflows/ci.yml": "jobs:\n  test:\n    steps:\n      - run: npm ci\n      - run: npm test\n",
    "app/api/stripe/webhook/route.ts": [
      "export async function POST(req: Request) {",
      "  const body = await req.text();",
      "  const event = stripe.webhooks.constructEvent(body, req.headers.get('stripe-signature')!, secret);",
      "  if (await seen(event.id)) return new Response('dup');",
      "  if (event.type === 'checkout.session.completed') await grant(event);",
      "  return new Response('ok');",
      "}",
    ].join("\n"),
    "app/api/projects/route.ts": [
      "export async function POST(req: Request) {",
      "  const { data: { user } } = await supabase.auth.getUser();",
      "  if (!user) return new Response('unauthorized', { status: 401 });",
      "  return Response.json({ ok: true });",
      "}",
    ].join("\n"),
    "app/api/health/route.ts": "export function GET() { return Response.json({ ok: true }); }\n",
    "app/(auth)/sign-up/page.tsx": "export default function SignUp() { return null; }\n",
    "app/(auth)/forgot-password/page.tsx": "export default function Forgot() { return null; }\n",
    "app/terms/page.tsx": "export default function Terms() { return null; }\n",
    "app/privacy/page.tsx": "export default function Privacy() { return null; }\n",
    "next.config.ts": "export default { async headers() { return [{ source: '/(.*)', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] }]; } };\n",
    "supabase/migrations/0001.sql": "create table public.projects (id uuid primary key, user_id uuid);\nalter table public.projects enable row level security;\ncreate policy p on public.projects for all using (user_id = auth.uid());\n",
    "tests/projects.test.ts": "import { test } from 'vitest'; test('x', () => {});\n",
    "lib/env.ts": "import { createEnv } from '@t3-oss/env-nextjs'; export const env = createEnv({});\nconst u = process.env.APP_URL;\n",
  };
}
