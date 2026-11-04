import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { createCheckoutSession } from "@/lib/stripe/stripe";
import { getUser } from "@/lib/supabase/server";

const Body = z.object({ kind: z.enum(["audit", "pro"]) });

export async function POST(req: Request) {
  if (!sameOrigin(req)) return jsonError("Forbidden", 403);
  const user = await getUser();
  if (!user?.email) return jsonError("Unauthorized", 401);
  if (!(await rateLimit("checkout", user.id))) return jsonError("Too many requests. Try again in a few minutes.", 429);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid request", 400);
  try {
    return NextResponse.json({ url: await createCheckoutSession(user.id, user.email, parsed.data.kind) });
  } catch (e) {
    console.error("checkout failed", e);
    return jsonError("Could not start checkout.", 500);
  }
}
