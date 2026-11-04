import Link from "next/link";
import { InspectionTag } from "@/components/inspection-tag";
import { buttonStyles } from "@/components/ui/button";
import { PRICING } from "@/lib/config/plans";

const AREAS = [
  { name: "Authentication", checks: ["Row Level Security on every Supabase table", "Server code verifies sessions", "Write endpoints check who is calling"] },
  { name: "Billing", checks: ["Stripe webhooks verify signatures", "Prices are set on the server", "Duplicate events can't grant access twice"] },
  { name: "Onboarding", checks: ["Sign-up and account recovery exist", "Terms and Privacy Policy are published", "Transactional email is configured"] },
  { name: "Deployment config", checks: ["Lockfile, build script and pinned runtime", "Environment variables documented and validated", "No hardcoded localhost or ignored build errors"] },
  { name: "Operations", checks: ["Error tracking and health checks", "Rate limits on public endpoints", "Security headers and analytics"] },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto grid max-w-6xl gap-12 px-5 pb-16 pt-16 md:grid-cols-[1fr_auto] md:pt-24">
        <div className="max-w-2xl">
          <h1 className="text-5xl font-extrabold [font-stretch:92%] md:text-6xl">Know if your app can take paying customers before they find out it can&rsquo;t.</h1>
          <p className="mt-6 max-w-xl text-lg text-ink-soft">
            You built it with Cursor, Lovable or Claude Code. We read the repository the way a senior engineer would before launch day, and tell you what will break, with the file and line to prove it.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/login?next=/dashboard" className={buttonStyles({ size: "lg" })}>Run a free scan</Link>
            <Link href="/pricing" className={buttonStyles({ variant: "ghost", size: "lg" })}>See pricing</Link>
          </div>
          <p className="mt-4 text-sm text-ink-soft">Read-only GitHub access. Your code is never executed.</p>
        </div>
        <div className="flex flex-col items-center gap-5 md:pt-4">
          <InspectionTag verdict="not_launch_ready" score={41} counts={{ P0: 2, P1: 5 }} meta={["acme/invoice-app", "a3f91c2"]} swing />
          <ul className="w-full max-w-[19rem] space-y-2 text-sm">
            <li className="rounded-[var(--radius-sm)] border border-rule bg-sheet p-3">
              <span className="font-semibold text-blocked">Blocker.</span> Stripe events are processed without signature verification.
              <span className="code-excerpt mt-1 block text-ink-soft">app/api/webhook/route.ts:4</span>
            </li>
            <li className="rounded-[var(--radius-sm)] border border-rule bg-sheet p-3">
              <span className="font-semibold text-blocked">Blocker.</span> Table <code className="code-excerpt">projects</code> has Row Level Security disabled.
              <span className="code-excerpt mt-1 block text-ink-soft">supabase/migrations/0001.sql:1</span>
            </li>
          </ul>
        </div>
      </section>

      <section className="border-y border-rule bg-sheet">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-3xl font-bold">What the launch inspection covers</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">Every check reports pass, fail, or not applicable, so you see what was verified and not only what broke.</p>
          <div className="mt-10 grid gap-x-10 gap-y-8 md:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((a) => (
              <div key={a.name}>
                <h3 className="border-b-2 border-ink pb-2 text-lg font-bold">{a.name}</h3>
                <ul className="mt-3 space-y-2 text-sm">
                  {a.checks.map((c) => (
                    <li key={c} className="flex gap-2"><span aria-hidden className="mt-1.5 inline-block size-2 shrink-0 rounded-full border-2 border-ink" />{c}</li>
                  ))}
                </ul>
              </div>
            ))}
            <div>
              <h3 className="border-b-2 border-ink pb-2 text-lg font-bold">Security and dependencies</h3>
              <ul className="mt-3 space-y-2 text-sm">
                {["Leaked keys and committed .env files", "Known vulnerabilities in your exact dependency versions", "Injection, eval and unsafe patterns in your code"].map((c) => (
                  <li key={c} className="flex gap-2"><span aria-hidden className="mt-1.5 inline-block size-2 shrink-0 rounded-full border-2 border-ink" />{c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-3xl font-bold">How it works</h2>
        <ol className="mt-8 grid gap-8 md:grid-cols-3">
          {[
            ["Connect a repository", "Install our GitHub App on just the repositories you choose. It can read code and nothing else."],
            ["Get the inspection report", "Deterministic scanners find the issues. AI only interprets the evidence they produce; it never invents findings or sets the score."],
            ["Fix, recheck, launch", "Paste each ticket into Cursor or Claude Code. Recheck to confirm the fix landed and nothing new broke."],
          ].map(([title, body], i) => (
            <li key={title} className="border-l-4 border-caution pl-4">
              <p className="font-[family-name:var(--font-display)] text-sm font-bold text-ink-soft">Step {i + 1}</p>
              <h3 className="mt-1 text-xl font-bold">{title}</h3>
              <p className="mt-2 text-ink-soft">{body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto max-w-6xl px-5">
        <div className="grid gap-8 rounded-[var(--radius-md)] bg-ink p-8 text-white md:grid-cols-[1fr_auto] md:items-center md:p-10">
          <div>
            <h2 className="text-3xl font-bold">Free scan, then ${PRICING.fullAuditUsd} for the full inspection.</h2>
            <p className="mt-2 max-w-xl text-white/75">The free scan finds your blockers. The full audit adds AI-reviewed evidence, the complete scorecard and copy-paste fix tickets.</p>
          </div>
          <Link href="/login?next=/dashboard" className={buttonStyles({ variant: "caution", size: "lg" })}>Scan my repository</Link>
        </div>
        <p className="mt-6 max-w-3xl text-sm text-ink-soft">
          What this is not: a penetration test, a runtime load test, or a guarantee. We read your code without running it, report what the evidence supports, and say plainly which parts we could not assess.
        </p>
      </section>
    </>
  );
}
