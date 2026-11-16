import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { getUser } from "@/lib/supabase/server";
import { startWorkspaceAnalysis, WorkspaceIdea } from "@/lib/validation/workspace";

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await rateLimit("validationStart", user.id))) return new NextResponse("Try again shortly.", { status: 429 });
  const parsed = WorkspaceIdea.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse("Check the idea fields and try again.", { status: 400 });
  const result = await startWorkspaceAnalysis(user.id, parsed.data);
  if (!result.ok) {
    const message = result.status === 402 ? "No validation credits remain for this report type."
      : result.status === 404 ? "Link your validation account first."
      : result.status === 409 ? "This request could not be started. Check your recent validations."
      : "The validation service did not confirm the request. Retry this form or check your recent validations.";
    return new NextResponse(message, { status: result.status, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(result.data, { headers: { "Cache-Control": "no-store" } });
}
