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
  return (
    <div className={cn("tag w-full max-w-[19rem] shadow-[0_18px_40px_-24px_rgb(20_33_61/0.6)]", t.bg, t.fg, swing && "tag-swing", className)} role="img" aria-label={`${VERDICT_LABELS[verdict]}, score ${score ?? "not available"}`}>
      <p className="tag-stamp text-2xl leading-none">{t.stamp}</p>
      <p className="mt-1 text-sm opacity-85">{VERDICT_LABELS[verdict]}</p>
      <div className="mt-6 flex items-end justify-between border-t border-current/30 pt-4">
        <div>
          <p className="font-[family-name:var(--font-display)] text-6xl font-black leading-none [font-stretch:80%]">{score ?? "—"}</p>
          <p className="mt-1 text-xs opacity-80">out of 100</p>
        </div>
        <dl className="text-right text-sm">
          <div><dt className="inline opacity-80">Blockers </dt><dd className="inline font-bold">{counts.P0}</dd></div>
          <div><dt className="inline opacity-80">High risk </dt><dd className="inline font-bold">{counts.P1}</dd></div>
        </dl>
      </div>
      {meta?.length ? <p className="mt-4 text-xs opacity-75">{meta.join(" / ")}</p> : null}
    </div>
  );
}
