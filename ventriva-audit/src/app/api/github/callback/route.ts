import { NextResponse, type NextRequest } from "next/server";
import { getInstallation, verifyInstallationAccess, verifyInstallState } from "@/lib/github/app";
import { syncInstallationRepos } from "@/lib/github/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getUser } from "@/lib/supabase/server";

/**
 * GitHub App "Setup URL". Requires:
 *  1. a signed-in user,
 *  2. a valid HMAC-signed state bound to that user AND to a nonce cookie set in this browser,
 *  3. proof (via the OAuth code) that the GitHub user actually has access to the installation.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const fail = (reason: string) => NextResponse.redirect(new URL(`/dashboard?github_error=${encodeURIComponent(reason)}`, req.url));
  const user = await getUser();
  if (!user) return NextResponse.redirect(new URL("/login", req.url));

  const installationId = Number(url.searchParams.get("installation_id"));
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return fail("Missing installation.");

  // Repository selection changed from GitHub's settings page (no state is sent). Only resync
  // installations this user already owns; repo changes also arrive via the webhook.
  if (url.searchParams.get("setup_action") === "update" && !state) {
    const { data: owned } = await supabaseAdmin().from("github_installations").select("id").eq("id", installationId).eq("user_id", user.id).maybeSingle();
    if (owned) await syncInstallationRepos(user.id, installationId);
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }
  if (!verifyInstallState(state, user.id, req.cookies.get("gh_install_nonce")?.value)) return fail("Your connect link expired. Please try again.");
  if (!code) return fail("GitHub did not return an authorization code. Enable 'Request user authorization during installation' on the GitHub App.");

  const access = await verifyInstallationAccess(code, installationId);
  if (!access.ok) return fail("We couldn't confirm you have access to that GitHub installation.");

  const db = supabaseAdmin();
  const { data: existing } = await db.from("github_installations").select("user_id").eq("id", installationId).maybeSingle();
  if (existing && existing.user_id !== user.id) return fail("This GitHub installation is already connected to another account.");

  const account = await getInstallation(installationId);
  const { error } = await db.from("github_installations").upsert({ id: installationId, user_id: user.id, account_login: account.login, account_type: account.type, suspended_at: null });
  if (error) return fail("Could not save the installation.");
  await syncInstallationRepos(user.id, installationId);

  const res = NextResponse.redirect(new URL("/dashboard?github=connected", req.url));
  res.cookies.delete({ name: "gh_install_nonce", path: "/api/github" });
  return res;
}
