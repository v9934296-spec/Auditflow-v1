export const metadata = { title: "Privacy Policy" };

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@ventriva.app";

export default function Privacy() {
  return (
    <article className="mx-auto max-w-[70ch] space-y-4 px-5 py-16">
      <h1 className="text-4xl font-extrabold">Privacy Policy</h1>
      <p className="text-sm text-ink-soft">
        Effective date: 16 November 2026. This policy describes how Ventriva Audit (“we”, “us”) handles personal data
        and source code you submit. Have it reviewed before launch.
      </p>

      <h2 className="pt-4 text-xl font-bold">1. What we collect</h2>
      <p>We collect the following categories of data:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>
          <strong>Account data</strong> — email address and authentication records managed by Supabase Auth
          (we never store plaintext passwords).
        </li>
        <li>
          <strong>Billing data</strong> — Stripe customer identifiers, subscription status, and payment events.
          We never see or store full card numbers.
        </li>
        <li>
          <strong>GitHub metadata</strong> — installation ID, repository names, default branch, and commit SHAs
          obtained through the GitHub App you authorize.
        </li>
        <li>
          <strong>Audit results</strong> — findings, severity, short redacted code excerpts around findings,
          scores, tickets, and AI cost/token usage.
        </li>
        <li>
          <strong>Operational data</strong> — error logs (via Sentry) and basic usage metrics needed to run the service.
        </li>
      </ul>

      <h2 className="pt-4 text-xl font-bold">2. Source code handling</h2>
      <p>
        When you start an audit we download a tarball of the repository using a short-lived, repo-scoped read-only token.
        The archive is extracted into temporary storage on an isolated worker. Nothing in the repository is executed,
        installed, or built. ESLint runs only through an in-memory API with our own configuration.
      </p>
      <p>
        The workspace is deleted as soon as the audit finishes (successfully or otherwise). For paid audits that include
        AI triage, only short, redacted excerpts around already-detected findings are sent to Anthropic’s API.
        Anthropic does not train on API data by default. The model cannot introduce new findings or alter scores.
      </p>

      <h2 className="pt-4 text-xl font-bold">3. How we use data</h2>
      <p>We use the data described above solely to:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Run the audits you request and deliver reports and tickets.</li>
        <li>Bill you and manage subscriptions or one-time credits.</li>
        <li>Enforce rate limits, cost ceilings, and abuse protections.</li>
        <li>Diagnose and fix errors in the Service.</li>
        <li>Send transactional emails (account confirmation, regression alerts when enabled).</li>
      </ul>
      <p>We do not sell personal data. We do not use your source code or findings to train machine-learning models.</p>

      <h2 className="pt-4 text-xl font-bold">4. Subprocessors</h2>
      <p>We rely on the following processors, each under their own data-processing terms:</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Supabase — authentication and database</li>
        <li>Vercel — application hosting</li>
        <li>Trigger.dev — isolated audit workers</li>
        <li>Anthropic — optional finding triage (paid audits only)</li>
        <li>Stripe — payments</li>
        <li>Sentry — error monitoring</li>
        <li>GitHub — repository access</li>
        <li>Resend — transactional email (when configured)</li>
      </ul>

      <h2 className="pt-4 text-xl font-bold">5. Retention and deletion</h2>
      <p>
        Audit results and associated findings are retained while your account remains active. Uninstalling the GitHub App
        deletes that installation’s repositories and audits from our systems. Temporary source-code workspaces are
        deleted immediately after each audit.
      </p>
      <p>
        To delete your account and all associated data, email {SUPPORT_EMAIL}. We will erase your personal data and
        audit history within 30 days, except where we are required to retain limited records for legal or accounting
        purposes (for example, Stripe transaction records).
      </p>

      <h2 className="pt-4 text-xl font-bold">6. Security</h2>
      <p>
        We use industry-standard measures including encryption in transit, row-level security on the database,
        short-lived repository tokens, and isolation of audit workers. No system is perfectly secure; we cannot
        guarantee absolute security of data in transit or at rest.
      </p>

      <h2 className="pt-4 text-xl font-bold">7. International transfers</h2>
      <p>
        Our processors may store or process data in the United States or other countries. By using the Service you
        consent to such transfers.
      </p>

      <h2 className="pt-4 text-xl font-bold">8. Your rights</h2>
      <p>
        Depending on your location you may have rights to access, correct, delete, or export your personal data, or to
        object to certain processing. Contact {SUPPORT_EMAIL} to exercise these rights. We will respond within 30 days.
      </p>

      <h2 className="pt-4 text-xl font-bold">9. Changes to this policy</h2>
      <p>
        We may update this policy. Material changes will be notified by email or through the Service. Continued use
        after the effective date constitutes acceptance.
      </p>

      <h2 className="pt-4 text-xl font-bold">10. Contact</h2>
      <p>
        Privacy questions may be sent to {SUPPORT_EMAIL}.
      </p>
    </article>
  );
}
