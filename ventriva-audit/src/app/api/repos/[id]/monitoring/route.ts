import { NextResponse } from "next/server";
import { z } from "zod";
import { canUse, getEntitlements } from "@/lib/audits/entitlements";
import { jsonError, sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({ enabled: z.boolean() });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return jsonError("Forbidden", 403);
  const user = await getUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!(await rateLimit("monitoring", user.id))) return jsonError("Too many requests. Try again in a few minutes.", 429);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request", 400);
  const { id } = await ctx.params;
  if (parsed.data.enabled && !canUse(await getEntitlements(user.id), "monitor")) return jsonError("Monitoring requires the Pro plan.", 402);
  const { data, error } = await supabaseAdmin().from("repositories").update({ monitoring_enabled: parsed.data.enabled }).eq("id", id).eq("user_id", user.id).select("id");
  if (error) return jsonError("Could not update repository.", 500);
  if (!data?.length) return jsonError("Repository not found.", 404);
  return NextResponse.json({ ok: true });
}
