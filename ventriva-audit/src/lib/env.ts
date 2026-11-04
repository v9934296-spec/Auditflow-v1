import { z } from "zod";

/**
 * Server-only environment, validated lazily so that `next build` works without secrets.
 * Never import this from a client component.
 */
const serverSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  GITHUB_APP_ID: z.string().min(1),
  GITHUB_APP_SLUG: z.string().min(1),
  GITHUB_APP_CLIENT_ID: z.string().min(1),
  GITHUB_APP_CLIENT_SECRET: z.string().min(1),
  GITHUB_APP_PRIVATE_KEY: z.string().min(100),
  GITHUB_WEBHOOK_SECRET: z.string().min(16),
  STRIPE_SECRET_KEY: z.string().startsWith("sk_"),
  STRIPE_WEBHOOK_SECRET: z.string().startsWith("whsec_"),
  STRIPE_PRICE_AUDIT: z.string().startsWith("price_"),
  STRIPE_PRICE_PRO: z.string().startsWith("price_"),
  ANTHROPIC_API_KEY: z.string().min(20),
  TRIGGER_SECRET_KEY: z.string().min(10),
  STATE_SIGNING_SECRET: z.string().min(32),
  DAILY_AI_SPEND_CAP_USD: z.coerce.number().positive().default(25),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment: ${missing}`);
  }
  // GitHub private keys are commonly stored with escaped newlines.
  cached = { ...parsed.data, GITHUB_APP_PRIVATE_KEY: parsed.data.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n") };
  return cached;
}

export const publicEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
};
