import { NextResponse } from "next/server";
import { createInstallState, installUrl } from "@/lib/github/app";
import { getUser } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));
  const { state, nonce } = createInstallState(user.id);
  const res = NextResponse.redirect(installUrl(state));
  res.cookies.set("gh_install_nonce", nonce, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/github", maxAge: 15 * 60 });
  return res;
}
