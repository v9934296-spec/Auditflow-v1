import { VERDICT_LABELS, type Verdict } from "@/lib/analysis/scoring";
import { cn } from "@/lib/cn";
import { inspectionRating } from "@/lib/format";

const TONE: Record<Verdict, { stamp: string }> = {
  not_launch_ready: { stamp: "Do not launch" },
  launch_with_fixes: { stamp: "Fix before launch" },
  launch_ready_in_scope: { stamp: "Cleared to launch" },
  insufficient_coverage: { stamp: "Not enough evidence" },
};

export function InspectionTag({
  verdict,
  score,
  counts,
  meta,
  className,
  coverageNote,
}: {
  verdict: Verdict;
  score: number | null;
  counts: { P0: number; P1: number };
  meta?: string[];
  className?: string;
  swing?: boolean;
  coverageNote?: string;
}) {
  const t = TONE[verdict];
  const rating = inspectionRating(score, verdict);
  if (rating === null) {
    return (
      <section className={cn("report-incomplete", className)} aria-label="Incomplete inspection, Not graded">
        <p className="report-eyebrow">Inspection incomplete</p>
        <h2>Not graded</h2>
        <p>{coverageNote || "The overall score is withheld until there is enough inspection evidence. Review the scope and scanner notes below."}</p>
        <p>Recorded verdict: {VERDICT_LABELS[verdict]}.</p>
        {meta?.length ? <p className="report-tag-meta">{meta.join(" / ")}</p> : null}
      </section>
    );
  }
  return (
    <div className={cn("tag", className)} data-verdict={verdict} role="group" aria-label={`${VERDICT_LABELS[verdict]}, inspection score ${rating} out of 10`}>
      <p className="tag-stamp">{t.stamp}</p>
      <p className="report-tag-verdict">{VERDICT_LABELS[verdict]}</p>
      <p className="report-tag-eyebrow">Inspection score</p>
      <div className="report-tag-body">
      <div className="report-rating">
        <svg viewBox="0 0 180 180" aria-hidden="true" focusable="false">
          <circle cx="90" cy="90" r="79" className="report-rating-track" />
          <circle cx="90" cy="90" r="79" className="report-rating-fill" pathLength="100" strokeDasharray={`${score} 100`} transform="rotate(-90 90 90)" />
        </svg>
        <div className="report-rating-label">
          <p className="report-rating-value">{rating}</p>
          <p className="text-xs">out of 10</p>
        </div>
      </div>
      <dl className="report-tag-counts">
        <div><dt>Blockers</dt><dd>{counts.P0}</dd></div>
        <div><dt>High risk</dt><dd>{counts.P1}</dd></div>
      </dl>
      </div>
      <p className="report-tag-note">Existing rubric score ÷ 10. Higher is better within the assessed scope.</p>
      {meta?.length ? <p className="report-tag-meta">{meta.join(" / ")}</p> : null}
    </div>
  );
}
