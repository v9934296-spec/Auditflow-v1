import { NextResponse } from "next/server";
import { ticketsToMarkdown } from "@/lib/analysis/tickets";
import { LIMITS } from "@/lib/config/plans";
import type { AuditRow, TicketRow } from "@/lib/db/types";
import { jsonError } from "@/lib/http/guard";
import { getUser, supabaseServer } from "@/lib/supabase/server";

/** Exports tickets as Markdown (Cursor / Claude Code / Codex) or JSON (GitHub Issues import). RLS scopes access. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getUser();
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await ctx.params;
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "md";
  const supabase = await supabaseServer();
  const { data: audit } = await supabase.from("audits").select("*, repositories(full_name)").eq("id", id).maybeSingle();
  if (!audit) return jsonError("Not found", 404);
  const a = audit as AuditRow & { repositories: { full_name: string } | null };
  if (!LIMITS[a.kind].ticketsEnabled) return jsonError("Ticket export is included in the full audit.", 402);
  const { data: tickets } = await supabase.from("tickets").select("*").eq("audit_id", id).order("priority").order("title");
  const rows = (tickets ?? []) as TicketRow[];
  const repo = a.repositories?.full_name ?? "repository";
  const filename = `${repo.replace(/[^a-z0-9-_]+/gi, "-")}-${(a.commit_sha ?? "").slice(0, 7)}-tickets`;

  if (format === "json") {
    const body = rows.map((t) => ({ title: t.title, body: t.body_markdown, labels: [t.priority, "engineering-audit"] }));
    return new NextResponse(JSON.stringify(body, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${filename}.json"` } });
  }
  const md = ticketsToMarkdown(repo, a.commit_sha ?? "", rows.map((t) => ({ priority: t.priority, title: t.title, bodyMarkdown: t.body_markdown, findingFingerprints: [] })));
  return new NextResponse(md, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${filename}.md"` } });
}
