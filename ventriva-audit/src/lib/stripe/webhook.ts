import type Stripe from "stripe";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "./stripe";

const ACTIVE = new Set(["active", "trialing", "past_due"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StripeHandlingResult = "processed" | "duplicate" | "ignored" | "unreconciled";

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

function checkoutSession(event: Stripe.Event): Stripe.Checkout.Session | null {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return null;
  return event.data.object;
}

/**
 * One-time audit purchases are fulfilled inside fulfill_audit_checkout.
 * That function commits the session fulfillment row, the credit, and the event id together.
 */
async function fulfillPaymentSession(event: Stripe.Event, session: Stripe.Checkout.Session): Promise<StripeHandlingResult> {
  const rawUser = session.metadata?.user_id ?? session.client_reference_id ?? "";
  const userId = UUID.test(rawUser) ? rawUser : null;
  const { data, error } = await supabaseAdmin().rpc("fulfill_audit_checkout", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_session_id: session.id,
    p_user_id: userId,
    p_mode: session.mode,
    p_payment_status: session.payment_status,
    p_kind: session.metadata?.kind ?? null,
  });
  if (error) throw error;
  if (data === "granted") return "processed";
  if (data === "duplicate") return "duplicate";
  if (data === "unreconciled") return "unreconciled";
  return "ignored";
}

/**
 * Subscription events still use event-id idempotency. A failed attempt deletes the
 * event row so Stripe can retry. Audit-credit purchases do not use this path.
 */
async function processTrackedEvent(event: Stripe.Event): Promise<StripeHandlingResult> {
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
        if (session.mode === "subscription" && session.subscription) {
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

/** Processes one signature-verified Stripe event. Verification stays in the webhook route. */
export async function handleStripeEvent(event: Stripe.Event): Promise<StripeHandlingResult> {
  const session = checkoutSession(event);
  if (session?.mode === "payment") return fulfillPaymentSession(event, session);
  return processTrackedEvent(event);
}
