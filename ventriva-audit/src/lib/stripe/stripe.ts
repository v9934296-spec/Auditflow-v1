import Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";

let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;
  client = new Stripe(serverEnv().STRIPE_SECRET_KEY, { maxNetworkRetries: 2, appInfo: { name: "ventriva-audit" } });
  return client;
}

export type CheckoutKind = "audit" | "pro";

async function ensureCustomer(userId: string, email: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: profile, error } = await db.from("profiles").select("stripe_customer_id").eq("id", userId).single();
  if (error) throw error;
  if (profile.stripe_customer_id) return profile.stripe_customer_id as string;
  const customer = await stripe().customers.create({ email, metadata: { user_id: userId } }, { idempotencyKey: `customer-${userId}` });
  const { error: upErr } = await db.from("profiles").update({ stripe_customer_id: customer.id }).eq("id", userId).is("stripe_customer_id", null);
  if (upErr) throw upErr;
  return customer.id;
}

/** Prices are always Stripe Price IDs from env — the client only chooses which product. */
export async function createCheckoutSession(userId: string, email: string, kind: CheckoutKind): Promise<string> {
  const env = serverEnv();
  const customer = await ensureCustomer(userId, email);
  const common = {
    customer,
    client_reference_id: userId,
    success_url: `${env.NEXT_PUBLIC_APP_URL}/dashboard?checkout=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/pricing?checkout=cancelled`,
    metadata: { user_id: userId, kind },
    allow_promotion_codes: true,
  };
  const session =
    kind === "audit"
      ? await stripe().checkout.sessions.create({ ...common, mode: "payment", line_items: [{ price: env.STRIPE_PRICE_AUDIT, quantity: 1 }], payment_intent_data: { metadata: { user_id: userId, kind } } })
      : await stripe().checkout.sessions.create({ ...common, mode: "subscription", line_items: [{ price: env.STRIPE_PRICE_PRO, quantity: 1 }], subscription_data: { metadata: { user_id: userId } } });
  if (!session.url) throw new Error("Stripe did not return a checkout URL.");
  return session.url;
}

export async function createPortalSession(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin().from("profiles").select("stripe_customer_id").eq("id", userId).single();
  if (error || !data.stripe_customer_id) throw new Error("No billing account yet.");
  const session = await stripe().billingPortal.sessions.create({ customer: data.stripe_customer_id as string, return_url: `${serverEnv().NEXT_PUBLIC_APP_URL}/dashboard` });
  return session.url;
}
