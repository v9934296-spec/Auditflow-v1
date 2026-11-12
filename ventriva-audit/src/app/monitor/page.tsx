import Link from "next/link";
import { buttonStyles } from "@/components/ui/button";
import { PRO } from "@/lib/config/plans";

export const metadata = { title: "Monitor audited repositories" };

export default function MonitorPage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-12 md:py-20">
      <p className="text-sm font-semibold uppercase tracking-widest text-ink-soft">Ventriva / Monitor</p>
      <h1 className="mt-3 text-4xl font-extrabold md:text-5xl">Keep an eye on verified fixes.</h1>
      <p className="mt-5 max-w-2xl text-lg text-ink-soft">
        Monitoring lives inside the existing audit dashboard. Eligible Pro accounts can enable monitoring for
        repositories with a completed paid audit, review regression alerts and use up to {PRO.rechecksPerPeriod} rechecks per month.
      </p>
      <div className="mt-8 rounded-[var(--radius-md)] border border-rule bg-sheet p-6">
        <h2 className="text-xl font-bold">No separate monitoring account or score</h2>
        <p className="mt-3 text-ink-soft">
          Audit reports remain the source of truth. A fix is verified only when a later scan inspects the relevant
          code again; untested fixes are not counted as new passes.
        </p>
        <Link href="/login?next=/dashboard" className={`${buttonStyles({ size: "lg" })} mt-6`}>
          Open audit dashboard
        </Link>
      </div>
    </div>
  );
}
