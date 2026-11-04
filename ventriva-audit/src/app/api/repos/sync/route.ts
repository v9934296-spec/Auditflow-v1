import { NextResponse } from "next/server";
import { syncInstallationRepos } from "@/lib/github/sync";
import { jsonError, sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("Forbidden", 403);
  const user = await getUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!(await rateLimit("repoSync", user.id))) return jsonError("Too many requests. Try again in a few minutes.", 429);
  const { data } = await supabaseAdmin().from("github_installations").select("id").eq("user_id", user.id).is("suspended_at", null);
  let total = 0;
  for (const i of data ?? []) total += await syncInstallationRepos(user.id, i.id as number);
  return NextResponse.json({ repositories: total });
}
