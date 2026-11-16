import { NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin } from "@/lib/http/guard";
import { rateLimit } from "@/lib/http/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";
import { pageUrl } from "@/lib/watch/page";

const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add"), url: z.string().max(2048) }),
  z.object({ action: z.literal("remove"), id: z.uuid() }),
]);

export async function POST(request: Request) {
  if (!sameOrigin(request)) return new NextResponse("Forbidden", { status: 403 });
  const user = await getUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });
  if (!(await rateLimit("monitoring", user.id))) {
    return new NextResponse("Try again in a few minutes.", { status: 429 });
  }

  const form = await request.formData().catch(() => null);
  const parsed = action.safeParse(form && Object.fromEntries(form));
  const destination = new URL("/watch", request.url);
  const db = supabaseAdmin();
  if (!parsed.success) {
    destination.searchParams.set("notice", "invalid");
  } else if (parsed.data.action === "remove") {
    const { error } = await db.from("page_watches").delete().eq("id", parsed.data.id).eq("user_id", user.id);
    if (error) destination.searchParams.set("notice", "failed");
  } else {
    let url: string;
    try {
      url = pageUrl(parsed.data.url).href;
    } catch {
      destination.searchParams.set("notice", "invalid");
      return NextResponse.redirect(destination, 303);
    }
    const { error } = await db.from("page_watches").upsert({ user_id: user.id, url }, {
      onConflict: "user_id,url", ignoreDuplicates: true,
    });
    if (error) destination.searchParams.set("notice", error.message === "page_watch_capacity" ? "capacity" : "failed");
  }
  return NextResponse.redirect(destination, 303);
}
