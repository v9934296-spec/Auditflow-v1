import Link from "next/link";
import { notFound } from "next/navigation";
import { VERDICT_LABELS, type Verdict } from "@/lib/analysis/scoring";
import type { AuditRow, RepositoryRow } from "@/lib/db/types";
import { KIND_LABEL, timeAgo } from "@/lib/format";
import { requireUser, supabaseServer } from "@/lib/supabase/server";

export const metadata = { title: "Audit history" };

function Trend({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const w = 480;
  const h = 120;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(h - (p / 100) * h).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`-8 -8 ${w + 16} ${h + 16}`} className="w-full max-w-xl" role="img" aria-label={`Score trend from ${points[0]} to ${points[points.length - 1]}`}>
      <line x1="0" x2={w} y1={h - 0.8 * h} y2={h - 0.8 * h} stroke="var(--color-verified)" strokeDasharray="4 4" strokeWidth="1" />
      <line x1="0" x2={w} y1={h - 0.5 * h} y2={h - 0.5 * h} stroke="var(--color-blocked)" strokeDasharray="4 4" strokeWidth="1" />
      <path d={d} fill="none" stroke="var(--color-ink)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => <circle key={i} cx={i * step} cy={h - (p / 100) * h} r="4" fill="var(--color-ink)" />)}
    </svg>
  );
}

export default async function RepoHistory({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const db = await supabaseServer();
  const { data: repo } = await db.from("repositories").select("*").eq("id", id).maybeSingle();
  if (!repo) notFound();
  const r = repo as RepositoryRow;
  const { data } = await db.from("audits").select("*").eq("repository_id", id).order("created_at", { ascending: false }).limit(100);
  const audits = (data ?? []) as AuditRow[];
  const scored = audits.filter((a) => a.status === "completed" && a.overall_score !== null).reverse();

  return (
    <div className="mx-auto max-w-4xl px-5 py-10">
      <p className="text-sm text-ink-soft"><Link href="/dashboard" className="underline-offset-4 hover:underline">Dashboard</Link></p>
      <h1 className="mt-2 text-3xl font-extrabold">{r.full_name}</h1>
      {scored.length >= 2 ? (
        <section className="mt-8">
          <h2 className="text-lg font-bold">Score over time</h2>
          <p className="text-sm text-ink-soft">Dashed lines mark the 50 (blocked) and 80 (clean) thresholds. Scores from different rubric versions are not directly comparable.</p>
          <div className="mt-4"><Trend points={scored.map((a) => a.overall_score!)} /></div>
        </section>
      ) : null}
      <section className="mt-10">
        <h2 className="text-lg font-bold">All inspections</h2>
        {audits.length === 0 ? <p className="mt-2 text-ink-soft">No inspections yet. Start one from the dashboard.</p> : null}
        <table className="mt-3 w-full text-sm">
          <thead><tr className="border-b border-ink text-left"><th className="py-2">When</th><th>Type</th><th>Result</th><th className="text-right">Score</th></tr></thead>
          <tbody className="divide-y divide-rule">
            {audits.map((a) => (
              <tr key={a.id}>
                <td className="py-2"><Link href={`/dashboard/audits/${a.id}`} className="underline-offset-4 hover:underline">{timeAgo(a.created_at)}</Link></td>
                <td>{KIND_LABEL[a.kind]}</td>
                <td>{a.status === "completed" && a.verdict ? VERDICT_LABELS[a.verdict as Verdict] : a.status}</td>
                <td className="text-right tabular-nums">{a.overall_score ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
