import { VERDICT_LABELS, type Verdict } from "@/lib/analysis/scoring";
import { cn } from "@/lib/cn";

const TONE: Record<Verdict, { bg: string; fg: string; stamp: string }> = {
  not_launch_ready: { bg: "bg-blocked", fg: "text-white", stamp: "Do not launch" },
  launch_with_fixes: { bg: "bg-caution", fg: "text-ink", stamp: "Fix before launch" },
  launch_ready_in_scope: { bg: "bg-verified", fg: "text-white", stamp: "Cleared to launch" },
  insufficient_coverage: { bg: "bg-ink-soft", fg: "text-white", stamp: "Not enough evidence" },
};

export function InspectionTag({
  verdict,
  score,
  counts,
  meta,
  className,
  swing = false,
}: {
  verdict: Verdict;
  score: number | null;
  counts: { P0: number; P1: number };
  meta?: string[];
  className?: string;
  swing?: boolean;
}) {
  const t = TONE[verdict];
  const graded = verdict !== "insufficient_coverage" && score !== null && Number.isFinite(score) && score >= 0 && score <= 100;
  const rating = graded ? (score / 10).toFixed(1) : null;
  return (
    <div className={cn("tag w-full max-w-[19rem] shadow-[0_18px_40px_-24px_rgb(20_33_61/0.6)]", t.bg, t.fg, swing && "tag-swing", className)} role="group" aria-label={`${VERDICT_LABELS[verdict]}, ${rating === null ? "Not graded" : `inspection score ${rating} out of 10`}`}>
      <p className="tag-stamp text-2xl leading-none">{t.stamp}</p>
      <p className="mt-1 text-sm">{VERDICT_LABELS[verdict]}</p>
      <p className="mt-5 text-xs font-semibold uppercase tracking-widest">Inspection score</p>
      <div className="report-rating">
        <svg viewBox="0 0 180 180" aria-hidden="true" focusable="false">
          <circle cx="90" cy="90" r="79" className="report-rating-track" />
          {graded ? <circle cx="90" cy="90" r="79" className="report-rating-fill" pathLength="100" strokeDasharray={`${score} 100`} transform="rotate(-90 90 90)" /> : null}
        </svg>
        <div className="report-rating-label">
          <p className={rating === null ? "report-rating-ungraded" : "report-rating-value"}>{rating ?? "Not graded"}</p>
          {rating !== null ? <p className="text-xs">out of 10</p> : <p className="mt-1 text-xs">Evidence incomplete</p>}
        </div>
      </div>
      <dl className="report-tag-counts">
        <div><dt>Blockers</dt><dd>{counts.P0}</dd></div>
        <div><dt>High risk</dt><dd>{counts.P1}</dd></div>
      </dl>
      <p className="mt-4 text-xs">{graded ? "Existing rubric score ÷ 10. Higher is better within the assessed scope." : "A score is withheld until there is enough inspection evidence."}</p>
      {meta?.length ? <p className="mt-4 text-xs">{meta.join(" / ")}</p> : null}
    </div>
  );
}
