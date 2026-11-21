export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const KIND_LABEL = { free_scan: "Free scan", full_audit: "Full audit", recheck: "Recheck", monitor: "Monitoring scan" } as const;

/** Presentation only: stored rubric scores remain on the original 100-point scale. */
export function inspectionRating(score: number | null, verdict?: string | null): string | null {
  if (verdict === "insufficient_coverage" || score === null || !Number.isFinite(score) || score < 0 || score > 100) return null;
  return (score / 10).toFixed(1);
}
