import Link from "next/link";
import { VALIDATION_APP_URL } from "@/lib/product/modules";
import { buttonStyles } from "@/components/ui/button";

export const metadata = { title: "Validate an idea" };

export default function ValidatePage() {
  return (
    <div className="mx-auto max-w-4xl px-5 py-12 md:py-20">
      <p className="text-sm font-semibold uppercase tracking-widest text-ink-soft">Ventriva / Validate</p>
      <h1 className="mt-3 text-4xl font-extrabold md:text-5xl">Find out what your business idea still needs to prove.</h1>
      <p className="mt-5 max-w-2xl text-lg text-ink-soft">
        Ventriva&apos;s idea validator examines the market, competitors, demand evidence and financial assumptions.
        Claims are separated from what the research actually supports.
      </p>
      <section className="mt-10 rounded-[var(--radius-md)] border border-rule bg-sheet p-6 md:p-8" aria-labelledby="separate-account-heading">
        <h2 id="separate-account-heading" className="text-xl font-bold">Idea validation currently opens in a separate application.</h2>
        <p className="mt-3 text-ink-soft">
          The validation app has its own account, sign-in, saved reports, subscriptions and billing.
          Your AuditFlow credentials and purchases do not automatically carry over.
          We will not claim these accounts are connected until that integration is verified.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a href={VALIDATION_APP_URL} className={buttonStyles({ size: "lg" })}>
            Open Ventriva idea validator <span aria-hidden="true">↗</span>
          </a>
          <Link href="/dashboard" className={buttonStyles({ variant: "outline", size: "lg" })}>Go to technical audits</Link>
        </div>
        <p className="mt-4 text-sm text-ink-soft">You are leaving this workspace. Sign in separately on the idea validator to access its reports.</p>
      </section>
    </div>
  );
}
