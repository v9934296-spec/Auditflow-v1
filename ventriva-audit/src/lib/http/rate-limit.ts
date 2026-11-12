import { supabaseAdmin } from "@/lib/supabase/admin";

export const RATE_LIMITS = {
  checkout: { limit: 10, windowSeconds: 600 },
  audits: { limit: 20, windowSeconds: 600 },
  repoSync: { limit: 10, windowSeconds: 600 },
  portal: { limit: 10, windowSeconds: 600 },
  monitoring: { limit: 30, windowSeconds: 600 },
  validationRead: { limit: 20, windowSeconds: 600 },
} as const;

/** Returns true when the call is allowed. Fails closed if the limiter itself errors. */
export async function rateLimit(bucket: keyof typeof RATE_LIMITS, subject: string): Promise<boolean> {
  const { limit, windowSeconds } = RATE_LIMITS[bucket];
  const { data, error } = await supabaseAdmin().rpc("hit_rate_limit", { p_key: `${bucket}:${subject}`, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) return false;
  return data === true;
}
