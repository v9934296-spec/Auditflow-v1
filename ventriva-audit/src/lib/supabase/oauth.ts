import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Google sign-in via Supabase Auth.
 *
 * Google verifies the email address, so a Google sign-in does not need
 * Supabase's email-confirmation step — this is the beta path around the
 * unreliable default Supabase confirmation email. The provider must be
 * enabled in Supabase (Authentication → Providers → Google) with a
 * Google Cloud OAuth client; see README §2.
 *
 * The OAuth code is exchanged for a session by the existing
 * `/auth/callback` route, so no new callback handling is needed here.
 */
export function authCallbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export async function signInWithGoogle(
  client: Pick<SupabaseClient, "auth">,
  origin: string,
  next: string,
): Promise<Error | null> {
  const { error } = await client.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: authCallbackUrl(origin, next) },
  });
  return error ?? null;
}
