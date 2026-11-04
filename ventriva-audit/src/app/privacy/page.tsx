export const metadata = { title: "Privacy Policy" };

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@ventriva.app";

export default function Privacy() {
  return (
    <article className="mx-auto max-w-[70ch] space-y-4 px-5 py-16">
      <h1 className="text-4xl font-extrabold">Privacy Policy</h1>
      <p className="text-sm text-ink-soft">Template. Set the effective date and have it reviewed before launch.</p>
      <h2 className="pt-4 text-xl font-bold">What we collect</h2>
      <p>Account data (email, hashed password via Supabase Auth), billing identifiers from Stripe (we never see card numbers), GitHub installation and repository metadata, and audit results: findings, short redacted code excerpts, scores and tickets.</p>
      <h2 className="pt-4 text-xl font-bold">Source code</h2>
      <p>Repository archives are processed in temporary storage on isolated workers and deleted when each audit ends. For paid audits, short redacted excerpts around suspected findings are sent to Anthropic&rsquo;s API for review. Anthropic does not train on API data by default.</p>
      <h2 className="pt-4 text-xl font-bold">How we use data</h2>
      <p>To run audits, bill you, prevent abuse, and fix errors in the service. We do not sell personal data or use your code to train models.</p>
      <h2 className="pt-4 text-xl font-bold">Subprocessors</h2>
      <p>Supabase, Vercel, Trigger.dev, Anthropic, Stripe, Sentry and GitHub, each under their own data processing terms.</p>
      <h2 className="pt-4 text-xl font-bold">Retention and deletion</h2>
      <p>Audit results are kept while your account is active. Uninstalling the GitHub App deletes that installation&rsquo;s repositories and audits. To delete your account, email {SUPPORT_EMAIL} and we will erase your data within 30 days.</p>
    </article>
  );
}
