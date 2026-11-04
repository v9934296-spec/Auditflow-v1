export const metadata = { title: "Security" };

const FLOW = [
  ["You install the GitHub App", "on the repositories you pick. It requests Contents: read and Metadata: read. It cannot push, open pull requests, change settings or read secrets."],
  ["Each audit gets a fresh token", "scoped to that single repository with read-only permission, expiring within an hour."],
  ["An isolated worker downloads the archive", "on a separate machine from the website. Dependencies, build output, binaries and symlinks are discarded. Size and file-count limits are enforced while streaming."],
  ["Scanners parse the code without running it", "Nothing is installed, built or executed. ESLint runs with our configuration only, never your repository's config files, because loading those would execute your code."],
  ["Secrets are redacted before anything is stored or sent to AI", "Only short excerpts around suspected findings (never whole files) are sent to Anthropic's Claude API, after redaction. Free scans send nothing to any AI provider."],
  ["The working copy is deleted", "as soon as the audit finishes or fails. We keep findings, short redacted excerpts, scores and tickets so you can track progress."],
];

export default function Security() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-4xl font-extrabold">How your code is handled</h1>
      <p className="mt-3 text-lg text-ink-soft">You are trusting us with private source code. Here is exactly what happens to it.</p>
      <ol className="mt-10 space-y-6">
        {FLOW.map(([title, body], i) => (
          <li key={title} className="grid grid-cols-[2.5rem_1fr] gap-3">
            <span className="flex size-9 items-center justify-center rounded-full border-2 border-ink font-bold" aria-hidden>{i + 1}</span>
            <div><h2 className="text-lg font-bold">{title}</h2><p className="mt-1 text-ink-soft">{body}</p></div>
          </li>
        ))}
      </ol>
      <section className="mt-12 space-y-3 text-ink-soft">
        <h2 className="text-2xl font-bold text-ink">Other commitments</h2>
        <p>Data is encrypted in transit (TLS) and at rest (Supabase Postgres). Each account can only read its own rows, enforced with Postgres Row Level Security. Billing and usage limits are enforced on the server.</p>
        <p>Subprocessors: Supabase (database and auth), Vercel (web hosting), Trigger.dev (analysis workers), Anthropic (AI review for paid audits), Stripe (payments), Sentry (error monitoring), GitHub (repository access).</p>
        <p>Uninstalling the GitHub App revokes our access immediately and deletes the repository&rsquo;s stored audits. To delete your account and all data, email the address on the privacy page.</p>
        <p>Secret redaction is pattern-based and cannot be perfect. If your repository contains live credentials, rotate them; the report will tell you where they are.</p>
      </section>
    </div>
  );
}
