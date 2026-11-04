import { NextResponse } from "next/server";
import { maybeStartMonitorScan } from "@/lib/audits/service";
import type { RepositoryRow } from "@/lib/db/types";
import { githubApp } from "@/lib/github/app";
import { syncInstallationRepos } from "@/lib/github/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface Payload {
  action?: string;
  installation?: { id: number };
  repository?: { id: number };
  ref?: string;
}

export async function POST(req: Request) {
  const body = await req.text();
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const event = req.headers.get("x-github-event") ?? "";
  if (!signature || !(await githubApp().webhooks.verify(body, signature))) return NextResponse.json({ error: "invalid signature" }, { status: 401 });

  const payload = JSON.parse(body) as Payload;
  const db = supabaseAdmin();
  const installationId = payload.installation?.id;

  if (event === "installation" && installationId) {
    if (payload.action === "deleted") await db.from("github_installations").delete().eq("id", installationId);
    if (payload.action === "suspend") await db.from("github_installations").update({ suspended_at: new Date().toISOString() }).eq("id", installationId);
    if (payload.action === "unsuspend") await db.from("github_installations").update({ suspended_at: null }).eq("id", installationId);
  }

  if (event === "installation_repositories" && installationId) {
    const { data } = await db.from("github_installations").select("user_id").eq("id", installationId).maybeSingle();
    if (data) await syncInstallationRepos(data.user_id as string, installationId);
  }

  if (event === "push" && payload.repository && payload.ref?.startsWith("refs/heads/")) {
    const branch = payload.ref.slice("refs/heads/".length);
    const { data: repos } = await db.from("repositories").select("*").eq("github_repo_id", payload.repository.id).eq("monitoring_enabled", true);
    for (const repo of (repos ?? []) as RepositoryRow[]) await maybeStartMonitorScan(repo, branch);
  }

  return NextResponse.json({ ok: true });
}
