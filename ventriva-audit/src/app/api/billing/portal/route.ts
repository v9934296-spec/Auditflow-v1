import { NextResponse } from "next/server";
import { jsonError, sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { createPortalSession } from "@/lib/stripe/stripe";
import { getUser } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("Forbidden", 403);
  const user = await getUser();
  if (!user) return jsonError("Unauthorized", 401);
  if (!(await rateLimit("portal", user.id))) return jsonError("Too many requests. Try again in a few minutes.", 429);
  try {
    return NextResponse.json({ url: await createPortalSession(user.id) });
  } catch {
    return jsonError("No billing account yet.", 400);
  }
}
