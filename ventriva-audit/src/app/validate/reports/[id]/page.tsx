import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { rateLimit } from "@/lib/http/rate-limit";
import { requireUser } from "@/lib/supabase/server";
import { readWorkspaceAnalysis } from "@/lib/validation/workspace";

export const metadata = { title: "Validation report" };

function label(key: string) {
  const spaced = key.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function ReportValue({ value, depth = 0 }: { value: z.infer<ReturnType<typeof z.json>>; depth?: number }) {
  if (value === null || depth >= 12) return null;
  if (Array.isArray(value)) return <ul className="ml-5 list-disc space-y-2">
    {value.map((item, index) => <li key={index}><ReportValue value={item} depth={depth + 1} /></li>)}
  </ul>;
  if (typeof value === "object") return <dl className="space-y-2">
    {Object.entries(value).filter(([, item]) => item !== null).map(([key, item]) => (
      <div key={key}><dt className="font-semibold">{label(key)}</dt>
        <dd><ReportValue value={item} depth={depth + 1} /></dd></div>
    ))}
  </dl>;
  return <p className="whitespace-pre-wrap break-words">{String(value)}</p>;
}

function sourceUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export default async function ValidationReportPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const result = await rateLimit("validationRead", user.id)
    ? await readWorkspaceAnalysis(user.id, id) : { ok: false as const, status: 429 };
  if (!result.ok && result.status === 404) notFound();
  const report = result.ok ? result.data : null;
  return (
    <div className="mx-auto max-w-4xl space-y-6 px-5 py-10">
      <Link href="/validate" className="underline">Back to Validate</Link>
      <h1 className="text-3xl font-extrabold">{report?.name ?? "Validation report"}</h1>
      {!report ? <p role="alert">The report is temporarily unavailable. Try again shortly.</p> : (
        <>
          <p>{report.progress || label(report.status)}</p>
          {report.status !== "complete" && report.status !== "error" ? (
            <a href={`/validate/reports/${id}`} className="underline">Check progress</a>
          ) : null}
          {report.report ? Object.entries(report.report).map(([key, value]) => (
            <section key={key} className="rounded-md border border-rule bg-sheet p-5">
              <h2 className="mb-3 text-xl font-bold">{label(key)}</h2><ReportValue value={value} />
            </section>
          )) : null}
          {report.sources.length ? (
            <section><h2 className="text-xl font-bold">Research sources</h2>
              <ol start={0} className="ml-6 list-decimal">
                {report.sources.map((source, index) => {
                  const href = sourceUrl(source.url);
                  return <li key={index}>{href ? (
                    <a href={href} rel="noreferrer" target="_blank" className="underline">{source.title || href}</a>
                  ) : (source.title || "Source unavailable")}</li>;
                })}
              </ol>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
