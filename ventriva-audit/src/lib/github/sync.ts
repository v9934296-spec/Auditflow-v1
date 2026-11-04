import { supabaseAdmin } from "@/lib/supabase/admin";
import { listInstallationRepos } from "./app";

/** Mirrors the repositories an installation can access. Removed repos are deleted (with their audits). */
export async function syncInstallationRepos(userId: string, installationId: number): Promise<number> {
  const db = supabaseAdmin();
  const repos = await listInstallationRepos(installationId);
  if (repos.length) {
    const { error } = await db.from("repositories").upsert(
      repos.map((r) => ({ user_id: userId, installation_id: installationId, github_repo_id: r.id, full_name: r.full_name, default_branch: r.default_branch, is_private: r.private })),
      { onConflict: "user_id,github_repo_id" },
    );
    if (error) throw error;
  }
  const keep = repos.map((r) => r.id);
  let del = db.from("repositories").delete().eq("installation_id", installationId);
  if (keep.length) del = del.not("github_repo_id", "in", `(${keep.join(",")})`);
  const { error: delErr } = await del;
  if (delErr) throw delErr;
  return repos.length;
}
