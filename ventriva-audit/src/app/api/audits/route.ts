import { NextResponse } from "next/server";
import { z } from "zod";
import { EntitlementError } from "@/lib/audits/entitlements";
import { AuditRequestError, startAudit } from "@/lib/audits/service";
import { jsonError, sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({ repositoryId: z.uuid(), kind: z.enum(["free_scan", "full_audit", "recheck"]) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("Forbidden", 403);
  const user = await getUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!(await rateLimit("audits", user.id))) return jsonError("Too many requests. Try again in a few minutes.", 429);
  if (!user.email_confirmed_at) return jsonError("Confirm your email address before running an audit.", 403);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request", 400);
  try {
    const audit = await startAudit(user.id, parsed.data.repositoryId, parsed.data.kind);
    return NextResponse.json({ id: audit.id }, { status: 201 });
  } catch (e) {
    if (e instanceof EntitlementError) return jsonError(e.message, 402);
    if (e instanceof AuditRequestError) return jsonError(e.message, e.status);
    console.error("startAudit failed", e);
    return jsonError("Could not start the audit.", 500);
  }
}
