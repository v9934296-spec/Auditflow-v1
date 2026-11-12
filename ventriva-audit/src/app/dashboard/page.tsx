import Link from "next/link";
import { ProductModuleCards } from "@/components/product-module-cards";
import { MonitoringToggle } from "@/components/monitoring-toggle";
import { PostButton } from "@/components/post-button";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import { canUse } from "@/lib/audits/entitlements";
import { VERDICT_LABELS, type Verdict } from "@/lib/analysis/scoring";
import { PRO } from "@/lib/config/plans";
import type { AuditRow, EntitlementsRow, RepositoryRow } from "@/lib/db/types";
import { KIND_LABEL, timeAgo } from "@/lib/format";
import { requireUser, supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Dashboard" };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ github_error?: string; checkout?: string; github?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const db = await supabaseServer();
  const [{ data: ent }, { data: installs }, { data: repos }, { data: audits }, { data: alerts }] = await Promise.all([
    db.from("entitlements").select("*").eq("user_id", user.id).single(),
    db.from("github_installations").select("id, account_login, suspended_at"),
    db.from("repositories").select("*").order("full_name"),
    db.from("audits").select("*").order("created_at", { ascending: false }).limit(50),
    db.from("alerts").select("*").is("read_at", null).order("created_at", { ascending: false }).limit(5),
  ]);
  const e = ent as EntitlementsRow | null;
  const repoList = (repos ?? []) as RepositoryRow[];
  const auditList = (audits ?? []) as AuditRow[];
  const lastByRepo = new Map<string, AuditRow>();
  const baselineByRepo = new Set<string>();
  for (const a of auditList) {
    if (!lastByRepo.has(a.repository_id)) lastByRepo.set(a.repository_id, a);
    if (a.status === "completed" && a.kind !== "free_scan") baselineByRepo.add(a.repository_id);
  }
  const running = auditList.find((a) => a.status === "queued" || a.status === "running");
  const pro = e ? canUse(e, "monitor") : false;

  return (
    <div className="mx-auto max-w-6xl px-5 py-10">
      {sp.github_error ? <p role="alert" className="mb-6 rounded-[var(--radius-sm)] border border-blocked/40 bg-blocked/5 p-3 text-sm text-blocked">{sp.github_error}</p> : null}
      {sp.checkout === "success" ? <p className="mb-6 rounded-[var(--radius-sm)] border border-verified/40 bg-verified/5 p-3 text-sm text-verified">Payment received. Your credit appears below within a few seconds.</p> : null}

      <section className="mb-10" aria-labelledby="workspace-heading">
        <p className="text-sm font-bold uppercase tracking-widest text-ink-soft">Ventriva / Workspace</p>
        <h1 id="workspace-heading" className="mt-2 text-3xl font-extrabold">Your founder workspace</h1>
        <p className="mb-6 mt-2 text-ink-soft">Business validation and technical auditing use separate accounts for now. Your existing audit reports and payments remain here.</p>
        <ProductModuleCards compact />
      </section>
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-extrabold">Your repositories</h1>
          <p className="mt-1 text-ink-soft">{user.email}</p>
        </div>
        {e ? (
          <dl className="flex gap-8 text-sm">
            <div><dt className="text-ink-soft">Free scan</dt><dd className="font-semibold">{e.free_scans_used ? "Used" : "Available"}</dd></div>
            <div><dt className="text-ink-soft">Audit credits</dt><dd className="font-semibold">{e.audit_credits}</dd></div>
            <div><dt className="text-ink-soft">Plan</dt><dd className="font-semibold">{pro ? `Pro, ${PRO.rechecksPerPeriod - e.rechecks_used} rechecks left` : "Free"}</dd></div>
            {pro || e.audit_credits ? <div className="self-end"><PostButton endpoint="/api/billing/portal" variant="ghost" size="sm">Billing</PostButton></div> : null}
          </dl>
        ) : null}
      </div>

      {(alerts ?? []).length ? (
        <section className="mt-8 rounded-[var(--radius-sm)] border-l-4 border-blocked bg-sheet p-4">
          <h2 className="text-base font-bold">New issues since your last check</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {(alerts ?? []).map((a) => (
              <li key={a.id as string}>{a.audit_id ? <Link className="underline-offset-4 hover:underline" href={`/dashboard/audits/${a.audit_id as string}`}>{a.message as string}</Link> : (a.message as string)}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {running ? (
        <p className="mt-8 text-sm">
          <Link href={`/dashboard/audits/${running.id}`} className="font-semibold underline-offset-4 hover:underline">{KIND_LABEL[running.kind]} in progress</Link> — you can leave this page.
        </p>
      ) : null}

      {(installs ?? []).length === 0 ? (
        <section className="mt-10 rounded-[var(--radius-md)] border-2 border-dashed border-rule bg-sheet p-10 text-center">
          <h2 className="text-2xl font-bold">Connect GitHub to start</h2>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">Install the app on the repositories you want inspected. It gets read-only access to code and metadata, and nothing else.</p>
          <a href="/api/github/install" className={`${buttonStyles({ size: "lg" })} mt-6`}>Connect GitHub</a>
        </section>
      ) : (
        <section className="mt-10">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm text-ink-soft">Connected: {(installs ?? []).map((i) => i.account_login as string).join(", ")}</p>
            <div className="flex gap-2">
              <PostButton endpoint="/api/repos/sync" variant="ghost" size="sm" pendingLabel="Refreshing…">Refresh list</PostButton>
              <a href="/api/github/install" className={buttonStyles({ variant: "outline", size: "sm" })}>Add repositories</a>
            </div>
          </div>
          {repoList.length === 0 ? (
            <p className="rounded-[var(--radius-sm)] border border-rule bg-sheet p-6 text-ink-soft">No repositories shared yet. Choose Add repositories and select at least one.</p>
          ) : (
            <ul className="divide-y divide-rule rounded-[var(--radius-md)] border border-rule bg-sheet">
              {repoList.map((r) => {
                const last = lastByRepo.get(r.id);
                const busy = !!running;
                return (
                  <li key={r.id} className="grid gap-4 p-4 md:grid-cols-[1fr_auto] md:items-center">
                    <div className="min-w-0">
                      <Link href={`/dashboard/repos/${r.id}`} className="font-semibold underline-offset-4 hover:underline">{r.full_name}</Link>
                      <span className="ml-2 text-xs text-ink-soft">{r.is_private ? "private" : "public"}, {r.default_branch}</span>
                      <p className="mt-1 text-sm text-ink-soft">
                        {last ? (
                          <>
                            <Link href={`/dashboard/audits/${last.id}`} className="underline-offset-4 hover:underline">{KIND_LABEL[last.kind]} {timeAgo(last.created_at)}</Link>
                            {last.status === "completed" && last.verdict ? <>: {VERDICT_LABELS[last.verdict as Verdict]}{last.overall_score !== null ? `, ${last.overall_score}/100` : ""}</> : ` (${last.status})`}
                          </>
                        ) : "Not inspected yet"}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      {e && canUse(e, "free_scan") ? <PostButton endpoint="/api/audits" body={{ repositoryId: r.id, kind: "free_scan" }} redirectTo="/dashboard/audits" variant="outline" size="sm" disabled={busy}>Free scan</PostButton> : null}
                      {e && canUse(e, "full_audit") ? (
                        <PostButton endpoint="/api/audits" body={{ repositoryId: r.id, kind: "full_audit" }} redirectTo="/dashboard/audits" size="sm" disabled={busy}>Run full audit</PostButton>
                      ) : (
                        <PostButton endpoint="/api/billing/checkout" body={{ kind: "audit" }} size="sm">Buy full audit</PostButton>
                      )}
                      {baselineByRepo.has(r.id) ? (
                        e && canUse(e, "recheck") ? (
                          <PostButton endpoint="/api/audits" body={{ repositoryId: r.id, kind: "recheck" }} redirectTo="/dashboard/audits" variant="outline" size="sm" disabled={busy}>Recheck fixes</PostButton>
                        ) : !pro ? (
                          <PostButton endpoint="/api/billing/checkout" body={{ kind: "pro" }} variant="ghost" size="sm">Get Pro to recheck</PostButton>
                        ) : (
                          <Badge>Rechecks used this month</Badge>
                        )
                      ) : null}
                      {baselineByRepo.has(r.id) ? <MonitoringToggle repoId={r.id} enabled={r.monitoring_enabled} allowed={pro} /> : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
