import { NextResponse } from "next/server";
import { z } from "zod";
import { getUser } from "@/lib/supabase/server";
import { sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { LinkCode, updateLegacyLink } from "@/lib/validation/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const Body = z.object({ code: LinkCode }).strict();

async function authorize(req: Request, requireConfirmed = false) {
  if (!sameOrigin(req)) return { error: NextResponse.json({ error: "Forbidden" }, { status: 403, headers: HEADERS }) };
  const user = await getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: HEADERS }) };
  if (requireConfirmed && !user.email_confirmed_at) {
    return { error: NextResponse.json({ error: "Confirm your email before linking accounts" }, { status: 403, headers: HEADERS }) };
  }
  if (!(await rateLimit("validationLink", user.id))) {
    return { error: NextResponse.json({ error: "Too many account-link attempts" }, { status: 429, headers: HEADERS }) };
  }
  return { user };
}

export async function POST(req: Request) {
  const auth = await authorize(req, true);
  if (auth.error) return auth.error;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid linking code" }, { status: 400, headers: HEADERS });
  const result = await updateLegacyLink(auth.user.id, "redeem", parsed.data.code);
  if (result.status === "conflict") {
    return NextResponse.json({ error: "This code has expired, was used, or an account is already linked" }, { status: 409, headers: HEADERS });
  }
  if (result.status !== "linked") {
    return NextResponse.json({ error: "Account linking is temporarily unavailable" }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json({ linked: true }, { headers: HEADERS });
}

export async function DELETE(req: Request) {
  const auth = await authorize(req);
  if (auth.error) return auth.error;
  const result = await updateLegacyLink(auth.user!.id, "revoke");
  if (result.status !== "revoked") {
    return NextResponse.json({ error: "Account unlinking is temporarily unavailable" }, { status: 503, headers: HEADERS });
  }
  return NextResponse.json({ revoked: result.revoked }, { headers: HEADERS });
}
