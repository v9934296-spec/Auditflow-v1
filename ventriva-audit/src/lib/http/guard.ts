import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";

/** Rejects cross-site state-changing requests (defense in depth on top of SameSite cookies). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(publicEnv.appUrl).origin;
  } catch {
    return false;
  }
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}
