import { NextResponse } from "next/server";
import { getUser } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/http/rate-limit";
import { listLinkedAnalyses } from "@/lib/validation/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: PRIVATE_HEADERS });
  if (!(await rateLimit("validationRead", user.id))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429, headers: PRIVATE_HEADERS });
  }
  const result = await listLinkedAnalyses(user.id);
  if (result.status === "not_linked") {
    return NextResponse.json({ error: "Account linking not yet complete" }, { status: 409, headers: PRIVATE_HEADERS });
  }
  if (result.status !== "ok") {
    return NextResponse.json({ error: "Validation service unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
  }
  return NextResponse.json({ analyses: result.analyses }, { headers: PRIVATE_HEADERS });
}
