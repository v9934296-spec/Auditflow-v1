import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/http/guard";
import { supabaseServer } from "@/lib/supabase/server";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", req.url), { status: 303 });
}
