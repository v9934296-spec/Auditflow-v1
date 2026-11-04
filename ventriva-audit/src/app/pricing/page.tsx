import Link from "next/link";
import { PostButton } from "@/components/post-button";
import { buttonStyles } from "@/components/ui/button";
import { LIMITS, PRICING, PRO } from "@/lib/config/plans";
import { getUser } from "@/lib/supabase/server";

export const metadata = { title: "Pricing" };

const MB = 1024 * 1024;

export default async function Pricing() {
  const user = await getUser();
  const tiers = [
    {
      name: "Free scan",
      price: "$0",
      cadence: "one per account",
      body: "Find out if you have launch blockers.",
      items: ["Secrets, dependency and launch-readiness checks", "Score and verdict", `Full detail on your top ${LIMITS.free_scan.detailedFindingsLimit} findings`, `Repositories up to ${LIMITS.free_scan.maxFiles.toLocaleString()} files`],
      cta: user ? <Link href="/dashboard" className={buttonStyles({ variant: "outline" })}>Go to dashboard</Link> : <Link href="/login?next=/dashboard" className={buttonStyles({ variant: "outline" })}>Start free</Link>,
    },
    {
      name: "Full audit",
      price: `$${PRICING.fullAuditUsd}`,
      cadence: "per audit",
      body: "The complete inspection with a fix plan.",
      items: ["Everything in the free scan", "Code-level security and quality rules", "AI review of each suspected finding against its evidence", "P0–P3 tickets for Cursor, Claude Code, Codex or GitHub Issues", `Repositories up to ${LIMITS.full_audit.maxFiles.toLocaleString()} files / ${Math.round(LIMITS.full_audit.maxTarballBytes / MB)} MB`],
      cta: user ? <PostButton endpoint="/api/billing/checkout" body={{ kind: "audit" }} variant="primary">Buy a full audit</PostButton> : <Link href="/login?next=/pricing" className={buttonStyles()}>Sign in to buy</Link>,
      featured: true,
    },
    {
      name: "Pro",
      price: `$${PRICING.proMonthlyUsd}`,
      cadence: "per month",
      body: "Proof your fixes worked, and an alarm when something new breaks.",
      items: [`${PRO.rechecksPerPeriod} targeted rechecks per month`, "Fixed / unresolved / regressed tracking", "Monitoring scan on push to your main branch (at most daily)", "Alerts for new critical and high issues", "Audit history and score trend"],
      cta: user ? <PostButton endpoint="/api/billing/checkout" body={{ kind: "pro" }} variant="outline">Subscribe to Pro</PostButton> : <Link href="/login?next=/pricing" className={buttonStyles({ variant: "outline" })}>Sign in to subscribe</Link>,
    },
  ];
  return (
    <div className="mx-auto max-w-6xl px-5 py-16">
      <h1 className="text-4xl font-extrabold">Pricing</h1>
      <p className="mt-2 max-w-xl text-ink-soft">Pay for the inspection once. Subscribe only if you want ongoing verification.</p>
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {tiers.map((t) => (
          <section key={t.name} className={`flex flex-col rounded-[var(--radius-md)] border bg-sheet p-6 ${t.featured ? "border-ink border-2" : "border-rule"}`}>
            <h2 className="text-xl font-bold">{t.name}</h2>
            <p className="mt-4"><span className="font-[family-name:var(--font-display)] text-4xl font-black">{t.price}</span> <span className="text-sm text-ink-soft">{t.cadence}</span></p>
            <p className="mt-2 text-ink-soft">{t.body}</p>
            <ul className="mt-6 flex-1 space-y-2 text-sm">
              {t.items.map((i) => <li key={i} className="flex gap-2"><span aria-hidden className="text-verified">✓</span>{i}</li>)}
            </ul>
            <div className="mt-6">{t.cta}</div>
          </section>
        ))}
      </div>
      <p className="mt-8 text-sm text-ink-soft">If an audit fails for a system reason, the credit is refunded automatically. Rechecks verify specific fixes and are never presented as a complete security assessment.</p>
    </div>
  );
}
