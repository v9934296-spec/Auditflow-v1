import type Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "./stripe";

const ACTIVE = new Set(["active", "trialing", "past_due"]);

async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const db = supabaseAdmin();
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = (sub.metadata?.user_id as string | undefined) ?? (await userIdForCustomer(customerId));
  if (!userId) throw new Error(`No user for Stripe customer ${customerId}`);
  const item = sub.items.data[0];
  if (!item) throw new Error(`Subscription ${sub.id} has no items`);
  if (item.price.id !== serverEnv().STRIPE_PRICE_PRO) return; // not our Pro plan

  const periodStart = new Date(item.current_period_start * 1000).toISOString();
  const periodEnd = new Date(item.current_period_end * 1000).toISOString();

  const { error } = await db.from("subscriptions").upsert({
    id: sub.id,
    user_id: userId,
    status: sub.status,
    price_id: item.price.id,
    current_period_start: periodStart,
    current_period_end: periodEnd,
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;

  const { data: ent, error: entErr } = await db.from("entitlements").select("period_start").eq("user_id", userId).single();
  if (entErr) throw entErr;
  const active = ACTIVE.has(sub.status);
  const newPeriod = ent.period_start !== periodStart;
  const { error: upErr } = await db
    .from("entitlements")
    .update({
      plan: active ? "pro" : "free",
      period_start: active ? periodStart : null,
      period_end: active ? periodEnd : null,
      ...(newPeriod ? { rechecks_used: 0 } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
  if (upErr) throw upErr;
  if (!active) await db.from("repositories").update({ monitoring_enabled: false }).eq("user_id", userId);
}

async function grantAuditFromSession(session: Stripe.Checkout.Session): Promise<void> {
  if (session.mode !== "payment" || session.payment_status !== "paid" || session.metadata?.kind !== "audit") return;
  const userId = session.metadata.user_id ?? session.client_reference_id;
  if (!userId) throw new Error(`Checkout ${session.id} has no user`);
  const { error } = await supabaseAdmin().rpc("grant_audit_credit", { p_user_id: userId, p_count: 1 });
  if (error) throw error;
}

/**
 * Processes one verified Stripe event exactly once.
 * The event id is recorded FIRST (unique constraint) and removed again if processing fails,
 * so Stripe's retry can re-run it.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored"> {
  const db = supabaseAdmin();
  const { error: dupErr } = await db.from("stripe_events").insert({ id: event.id, type: event.type });
  if (dupErr) {
    if (dupErr.code === "23505") return "duplicate";
    throw dupErr;
  }
  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object;
        if (session.mode === "payment") await grantAuditFromSession(session);
        else if (session.mode === "subscription" && session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          await syncSubscription(await stripe().subscriptions.retrieve(subId));
        }
        return "processed";
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
        await syncSubscription(event.data.object);
        return "processed";
      default:
        return "ignored";
    }
  } catch (e) {
    await db.from("stripe_events").delete().eq("id", event.id);
    throw e;
  }
}
