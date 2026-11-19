import type { Coverage, Priority } from "@/lib/analysis/types";
import { CATEGORY_LABELS } from "@/lib/analysis/types";
import type { CategoryScore } from "@/lib/analysis/scoring";

const PRIORITIES: { priority: Priority; label: string }[] = [
  { priority: "P0", label: "Blockers" },
  { priority: "P1", label: "High risk" },
  { priority: "P2", label: "Important" },
  { priority: "P3", label: "Optional" },
];

export function ReportCategoryScores({ categories, coverageNote }: { categories: CategoryScore[]; coverageNote: string }) {
  return (
    <section>
      <h2 className="text-xl font-semibold">Engineering scores</h2>
      <p className="mt-1 text-sm text-ink-soft">Existing rubric scores on a 10-point scale. Unassessed areas stay ungraded.</p>
      <table className="mt-4 w-full text-sm">
        <tbody className="divide-y divide-rule">
          {categories.map((c) => (
            <tr key={c.category}>
              <th scope="row" className="w-2/5 py-2.5 pr-4 text-left font-semibold">{CATEGORY_LABELS[c.category]}</th>
              <td className="py-2.5">
                {c.score === null ? <div><span className="text-ink-soft">Not assessed</span>{c.reason ? <p className="mt-1 text-xs text-ink-soft">{c.reason}</p> : null}</div> : (
                  <div className="flex items-center gap-3">
                    <div className="h-2 flex-1 rounded-full bg-rule" aria-hidden="true"><div className={`h-full rounded-full ${c.score < 50 ? "bg-blocked" : c.score < 80 ? "bg-caution" : "bg-verified"}`} style={{ width: `${c.score}%` }} /></div>
                    <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{(c.score / 10).toFixed(1)}<span className="text-xs font-normal text-ink-soft"> / 10</span></span>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 max-w-[70ch] text-sm text-ink-soft">{coverageNote}</p>
    </section>
  );
}

export function ReportSignals({ counts, coverage }: {
  counts: Record<Priority, number>;
  coverage: Coverage | null;
}) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const ratio = coverage?.sourceCoverage;
  const knownCoverage = typeof ratio === "number" && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1;
  const percent = knownCoverage ? Math.floor(ratio * 100) : null;
  const inspected = coverage?.filesInspected;
  return (
    <section className="report-signals" aria-label="Findings and inspection coverage">
      <div className="report-signal-header">
        <div><p className="report-eyebrow">Finding distribution</p><h2>What needs attention</h2></div>
        <p className="report-total"><strong>{total}</strong> open findings</p>
      </div>
      <div className="report-distribution" aria-hidden="true">
        {PRIORITIES.map(({ priority }) => counts[priority] > 0 ? <span key={priority} data-priority={priority} style={{ width: `${(counts[priority] / total) * 100}%` }} /> : null)}
      </div>
      <dl className="report-priority-legend">
        {PRIORITIES.map(({ priority, label }) => (
          <div key={priority}><dt><span className="report-dot" data-priority={priority} aria-hidden="true" />{priority} · {label}</dt><dd>{counts[priority]}</dd></div>
        ))}
      </dl>
      {total === 0 ? <p className="report-signal-note">No open findings in the assessed scope. This does not establish that uninspected areas are safe.</p> : <p className="report-signal-note">Counts show priority, not confirmed correctness. Each finding retains its evidence and confidence labels below.</p>}
      <div className="report-coverage">
        <div className="report-signal-header"><div><p className="report-eyebrow">Evidence coverage</p><h3>Eligible source inspected</h3></div><strong className="report-coverage-value">{percent === null ? "Not recorded" : `${percent}%`}</strong></div>
        <div className="report-coverage-track" aria-hidden="true">{knownCoverage ? <span style={{ width: `${ratio * 100}%` }} /> : null}</div>
        <p className="report-signal-note">{typeof inspected === "number" ? `${inspected.toLocaleString()} source files inspected by Semgrep or ESLint.` : "The inspected file count was not recorded."} {coverage?.sourceInventory ? `${coverage.sourceInventory.notInspected.length.toLocaleString()} eligible files not inspected; ${coverage.sourceInventory.unsupported.length.toLocaleString()} source files outside supported languages.` : "The full source inventory was not recorded."}</p>
        <p className="report-signal-note">Coverage measures inspection scope, not code quality. Live app behavior was not tested.{coverage?.truncated ? " Repository extraction was truncated." : ""}</p>
      </div>
    </section>
  );
}
