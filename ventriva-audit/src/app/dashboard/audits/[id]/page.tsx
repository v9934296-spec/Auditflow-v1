import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { InspectionTag } from "@/components/inspection-tag";
import { ReportCategoryScores, ReportNextAction, ReportSignals } from "@/components/report-signals";
import { PostButton } from "@/components/post-button";
import { Badge } from "@/components/ui/badge";
import { buttonStyles } from "@/components/ui/button";
import type { AreaStatus, Verdict } from "@/lib/analysis/scoring";
import { READINESS_AREA_LABELS, type FindingChange, type Priority } from "@/lib/analysis/types";
import { LIMITS } from "@/lib/config/plans";
import type { AuditRow, FindingRow } from "@/lib/db/types";
import { KIND_LABEL, timeAgo } from "@/lib/format";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireUser, supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Inspection report" };

const AREA_TONE: Record<AreaStatus, string> = {
  blocked: "text-blocked",
  issues: "text-ink",
  ready: "text-verified",
  not_applicable: "text-ink-soft",
};
const AREA_WORD: Record<AreaStatus, string> = { blocked: "Blocked", issues: "Needs work", ready: "Passed", not_applicable: "Not applicable" };
const CHECK_MARK = { pass: { sym: "✓", cls: "text-verified", label: "Passed" }, fail: { sym: "✕", cls: "text-blocked", label: "Failed" }, not_applicable: { sym: "–", cls: "text-ink-soft", label: "Not applicable" } } as const;
const CHANGE_LABEL: Record<FindingChange, string> = { new: "New", unresolved: "Still open", fixed: "Fixed", regressed: "Regressed", not_retested: "Not retested" };
const PRIORITY_HEADING: Record<Priority, string> = { P0: "P0 · Launch blockers", P1: "P1 · High risk", P2: "P2 · Important", P3: "P3 · Optional" };

export default async function AuditReport({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const db = await supabaseServer();
  const { data: auditData } = await db.from("audits").select("*, repositories(id, full_name)").eq("id", id).maybeSingle();
  if (!auditData) notFound();
  const audit = auditData as AuditRow & { repositories: { id: string; full_name: string } | null };
  const repoName = audit.repositories?.full_name ?? "Repository";

  if (audit.status === "queued" || audit.status === "running") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <AutoRefresh />
        <h1 className="text-2xl font-semibold">Inspecting {repoName}</h1>
        <p className="mt-3 text-ink-soft">{audit.status === "queued" ? "Waiting for a worker." : "Downloading the repository and running the scanners."} Most audits finish in two to five minutes. You can leave this page; the report will be here.</p>
        <div className="mt-8 h-2 overflow-hidden rounded-full bg-rule" aria-hidden>
          <div className={`h-full bg-ink ${audit.status === "queued" ? "w-1/6" : "w-3/5"} transition-[width] duration-700`} />
        </div>
      </div>
    );
  }

  if (audit.status === "failed") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="text-2xl font-semibold">The inspection didn&rsquo;t finish</h1>
        <p className="mt-3">{audit.error ?? "The audit failed."}</p>
        <p className="mt-2 text-sm text-ink-soft">Any credit used for this run has been returned to your account.</p>
        <Link href="/dashboard" className={`${buttonStyles()} mt-6`}>Back to dashboard</Link>
      </div>
    );
  }

  await supabaseAdmin().from("alerts").update({ read_at: new Date().toISOString() }).eq("user_id", user.id).eq("audit_id", audit.id).is("read_at", null);

  const { data: findingData } = await db.from("findings").select("*").eq("audit_id", id);
  const findings = (findingData ?? []) as FindingRow[];
  const open = findings.filter((f) => f.change !== "fixed");
  const fixed = findings.filter((f) => f.change === "fixed");
  const card = audit.category_scores;
  const limits = LIMITS[audit.kind];
  const comparing = audit.kind === "recheck" || audit.kind === "monitor";
  const priorities: Priority[] = ["P0", "P1", "P2", "P3"];
  const counts = Object.fromEntries(priorities.map((p) => [p, open.filter((f) => f.priority === p).length])) as Record<Priority, number>;
  const incompleteScanner = audit.coverage?.scanners.find((s) => ["secrets", "semgrep", "readiness"].includes(s.name) && s.status !== "ran");
  const incompleteNote = incompleteScanner ? `${incompleteScanner.name === "semgrep" ? "Semgrep" : incompleteScanner.name} ${incompleteScanner.status}. Score withheld; review inspection scope.`
    : audit.coverage?.truncated ? "Repository extraction was truncated. Score withheld." : undefined;

  return (
    <div className="mx-auto max-w-6xl px-5 py-6">
      <p className="text-sm text-ink-soft">
        <Link href={`/dashboard/repos/${audit.repositories?.id ?? ""}`} className="underline-offset-4 hover:underline">{repoName}</Link> / {KIND_LABEL[audit.kind]}, {timeAgo(audit.completed_at)}
      </p>

      <div className="mt-5 grid gap-6 lg:grid-cols-[17rem_1fr]">
        <aside className="report-sidebar lg:sticky lg:top-6 lg:self-start">
          <InspectionTag verdict={(audit.verdict ?? "insufficient_coverage") as Verdict} score={audit.overall_score} counts={counts} coverageNote={incompleteNote} meta={[(audit.commit_sha ?? "").slice(0, 7), `rubric ${audit.rubric_version ?? "?"}`]} />
          <div className="mt-6 space-y-2">
            {limits.ticketsEnabled ? (
              <>
                <a href={`/api/audits/${audit.id}/export?format=md`} className={`${buttonStyles()} w-full`}>Download tickets for Cursor</a>
                <a href={`/api/audits/${audit.id}/export?format=json`} className={`${buttonStyles({ variant: "outline" })} w-full`}>Download as GitHub Issues JSON</a>
              </>
            ) : (
              <div className="rounded-[var(--radius-sm)] border border-ink bg-sheet p-4 text-sm">
                <p className="font-semibold">This was a free scan.</p>
                <p className="mt-1 text-ink-soft">The full audit adds code-level rules, AI review of each finding, fix details for every issue and exportable tickets.</p>
                <div className="mt-3"><PostButton endpoint="/api/billing/checkout" body={{ kind: "audit" }} size="sm">Buy the full audit</PostButton></div>
              </div>
            )}
          </div>
          {comparing ? (
            <p className="mt-6 text-sm text-ink-soft">This {KIND_LABEL[audit.kind].toLowerCase()} compares against your previous audit. It verifies fixes and catches regressions; it is not a complete security or launch assessment.</p>
          ) : null}
        </aside>

        <div className="min-w-0 space-y-6">
          <section>
            <h1 className="text-2xl font-semibold">Inspection report</h1>
            {audit.summary ? <p className="mt-3 max-w-[70ch] text-base leading-relaxed">{audit.summary}</p> : null}
          </section>

          <ReportNextAction counts={counts} />
          <ReportSignals counts={counts} coverage={audit.coverage} />

          {comparing ? (
            <section className="flex flex-wrap gap-8 rounded-[var(--radius-md)] border border-rule bg-sheet p-5">
              <div><p className="text-3xl font-semibold text-verified">{fixed.length}</p><p className="text-sm text-ink-soft">Fixed</p></div>
              <div><p className="text-3xl font-semibold">{open.filter((f) => f.change === "unresolved").length}</p><p className="text-sm text-ink-soft">Still open</p></div>
              <div><p className="text-3xl font-semibold">{open.filter((f) => f.change === "new").length}</p><p className="text-sm text-ink-soft">New</p></div>
              <div><p className="text-3xl font-semibold text-blocked">{open.filter((f) => f.change === "regressed").length}</p><p className="text-sm text-ink-soft">Regressed</p></div>
              <div><p className="text-3xl font-semibold">{open.filter((f) => f.change === "not_retested").length}</p><p className="text-sm text-ink-soft">Not retested</p></div>
            </section>
          ) : null}

          {card ? (
            <section>
              <h2 className="text-xl font-semibold">Business launch readiness</h2>
              <p className="mt-1 text-sm text-ink-soft">Can this app accept and keep paying customers?</p>
              <div className="mt-5 grid gap-x-8 gap-y-6 md:grid-cols-2">
                {card.readiness.map((area) => (
                  <div key={area.area}>
                    <div className="flex items-baseline justify-between border-b-2 border-ink pb-1.5">
                      <h3 className="font-semibold">{READINESS_AREA_LABELS[area.area]}</h3>
                      <span className={`text-sm font-semibold ${AREA_TONE[area.status]}`}>{AREA_WORD[area.status]}</span>
                    </div>
                    <ul className="mt-2 space-y-1.5 text-sm">
                      {area.checks.map((c) => {
                        const m = CHECK_MARK[c.status];
                        return (
                          <li key={c.id} className="flex gap-2">
                            <span className={`w-4 shrink-0 font-semibold ${m.cls}`} aria-label={m.label}>{m.sym}</span>
                            <span className={c.status === "not_applicable" ? "text-ink-soft" : ""}>
                              {c.label}
                              {c.status !== "pass" ? <span className="block text-xs text-ink-soft">{c.detail}</span> : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {card ? <ReportCategoryScores categories={card.categories} coverageNote={card.coverageNote} /> : null}

          <section>
            <h2 className="text-xl font-semibold">Findings</h2>
            {open.length === 0 ? <p className="mt-3 text-ink-soft">No open findings within the assessed scope.</p> : null}
            {priorities.map((p) => {
              const group = open.filter((f) => f.priority === p);
              if (!group.length) return null;
              return (
                <div key={p} className="mt-8">
                  <h3 id={`findings-${p}`} className="scroll-mt-6 text-lg font-semibold">{PRIORITY_HEADING[p]} <span className="font-normal text-ink-soft">({group.length})</span></h3>
                  <ul className="mt-3 space-y-3">
                    {group.map((f) => (
                      <li key={f.id}>
                        <details className="group rounded-[var(--radius-sm)] border border-rule bg-sheet open:border-ink/40">
                          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 p-4">
                            <Badge tone={f.priority}>{f.priority}</Badge>
                            <span className="min-w-0 flex-1 font-semibold">{f.title}</span>
                            {f.change ? <Badge tone={f.change === "regressed" ? "P0" : "neutral"}>{CHANGE_LABEL[f.change]}</Badge> : null}
                            <Badge tone={f.evidence_tier}>{f.evidence_tier === "verified" ? "Verified" : f.evidence_tier === "suspected" ? "Suspected" : "Not tested"}</Badge>
                            {f.ai_assessment?.verdict === "likely_false_positive" ? <Badge>AI: likely false positive</Badge> : null}
                          </summary>
                          <div className="space-y-4 border-t border-rule p-4 text-sm">
                            <p className="max-w-[75ch]">{f.description}</p>
                            {f.file_path ? <p className="code-excerpt text-ink-soft">{f.file_path}{f.start_line ? `:${f.start_line}` : ""}</p> : null}
                            {f.snippet ? <pre className="code-excerpt overflow-x-auto rounded-[var(--radius-sm)] bg-paper p-3 text-ink">{f.snippet}</pre> : null}
                            <div>
                              <p className="font-semibold">Evidence</p>
                              {f.change === "not_retested" && f.evidence.facts?.verifiedFix === true ? <p className="text-ink-soft">Previously verified fixed. This scan did not re-test the relevant evidence, so the fix is not newly confirmed.</p> : null}
                              <p className="text-ink-soft">{f.evidence.method} Confidence: {f.confidence}.</p>
                              {f.ai_assessment ? <p className="mt-1 text-ink-soft">AI review: {f.ai_assessment.explanation}</p> : null}
                            </div>
                            <div>
                              <p className="font-semibold">How to fix</p>
                              <p className="max-w-[75ch]">{f.ai_assessment?.verdict === "likely_true_positive" ? f.ai_assessment.remediation : f.remediation}</p>
                            </div>
                          </div>
                        </details>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>

          {fixed.length ? (
            <section>
              <h2 className="text-xl font-semibold">Fixed since the last audit</h2>
              <ul className="mt-3 space-y-1 text-sm">
                {fixed.map((f) => <li key={f.id} className="flex gap-2"><span className="font-semibold text-verified">✓</span><span className="line-through decoration-ink/30">{f.title}</span></li>)}
              </ul>
            </section>
          ) : null}

          {audit.coverage ? (
            <section id="inspection-scope" className="scroll-mt-6">
              <h2 className="text-xl font-semibold">What was inspected</h2>
              <p className="mt-2 text-sm text-ink-soft">This is a static inspection of repository files at the recorded commit. The app was not run. Live authentication, payments, deployed settings, runtime behavior and performance were not tested.</p>
              <p className="mt-2 text-sm text-ink-soft">{(audit.coverage.filesIngested ?? audit.coverage.filesAnalyzed).toLocaleString()} files ingested, {"filesInspected" in audit.coverage && audit.coverage.filesInspected != null ? `${audit.coverage.filesInspected.toLocaleString()} eligible source files positively inspected by Semgrep or ESLint` : "inspection count not recorded for this audit"}, {audit.coverage.filesSkipped.toLocaleString()} not extracted (dependencies, build output, binaries). Languages present: {Object.entries(audit.coverage.languages).map(([l, n]) => `${l} (${n})`).join(", ") || "none detected"}.</p>
              <table className="mt-4 w-full max-w-2xl text-sm">
                <thead><tr className="border-b border-ink text-left"><th className="py-1.5">Scanner</th><th>Status</th><th>Notes</th></tr></thead>
                <tbody className="divide-y divide-rule">
                  {audit.coverage.scanners.map((s) => (
                    <tr key={s.name}><td className="py-1.5 font-semibold">{s.name}</td><td className={s.status === "ran" ? "text-verified" : s.status === "failed" || s.status === "partial" ? "text-blocked" : "text-ink-soft"}>{s.status}</td><td className="text-ink-soft">{s.reason ?? (s.filesScanned !== undefined ? `${s.filesScanned} files inspected` : "")}</td></tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-4 space-y-3 text-sm">
                {audit.coverage.scanners.map((s) => (
                  <details key={s.name}>
                    <summary className="cursor-pointer">{s.name}: files reported as inspected {s.inspectedFiles ? `(${s.inspectedFiles.length})` : "(not recorded)"}</summary>
                    {s.inspectedFiles ? <ul className="mt-2 max-h-64 overflow-auto pl-4 font-mono text-xs">{s.inspectedFiles.map((p) => <li key={p} className="break-all">{p}</li>)}{!s.inspectedFiles.length ? <li>No files reported as inspected.</li> : null}</ul> : <p className="mt-2 text-ink-soft">This scanner did not record a file list. Its status alone does not establish file coverage.</p>}
                  </details>
                ))}
                {audit.coverage.sourceInventory ? Object.entries({
                  "Source inspected by Semgrep or ESLint": audit.coverage.sourceInventory.inspected,
                  "Eligible source not inspected by either code scanner": audit.coverage.sourceInventory.notInspected,
                  "Source outside supported code-scanner languages": audit.coverage.sourceInventory.unsupported,
                }).map(([label, paths]) => (
                  <details key={label}>
                    <summary className="cursor-pointer">{label} ({paths.length})</summary>
                    <ul className="mt-2 max-h-64 overflow-auto pl-4 font-mono text-xs">{paths.map((p) => <li key={p} className="break-all">{p}</li>)}{!paths.length ? <li>None in the ingested source inventory.</li> : null}</ul>
                  </details>
                )) : <p className="text-ink-soft">This older report did not record the source inventory. Files missing from scanner lists cannot be identified from this report; run a new inspection for that detail.</p>}
                <p className="text-ink-soft">These lists cover extracted files only. Individual paths excluded during extraction were not recorded. Extraction exclusions: {Object.entries(audit.coverage.skippedReasons).map(([reason, count]) => `${reason}: ${count}`).join(", ") || "none recorded"}.{audit.coverage.truncated ? " Extraction was truncated; the repository was not fully inspected." : ""}</p>
              </div>
              {audit.coverage.notes.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink-soft">{audit.coverage.notes.map((n) => <li key={n}>{n}</li>)}</ul> : null}
              <p className="mt-3 text-xs text-ink-soft">AI processing cost for this audit: ${Number(audit.ai_cost_usd).toFixed(2)}.</p>
            </section>
          ) : <section id="inspection-scope" className="scroll-mt-6"><h2 className="text-xl font-semibold">What was inspected</h2><p className="mt-2 text-ink-soft">Coverage details were not recorded for this audit. Run a fresh inspection to establish its scope.</p></section>}
        </div>
      </div>
    </div>
  );
}
