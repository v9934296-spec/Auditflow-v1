import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { error } = await supabaseAdmin().from("profiles").select("id", { head: true, count: "exact" }).limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, db: "up" });
  } catch (error) {
    const configError = error instanceof Error && /^Invalid server environment: [A-Za-z0-9_, ]+$/.test(error.message);
    console.error(configError ? error.message : "AuditFlow database health probe failed");
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
