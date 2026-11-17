import type Stripe from "stripe";
import { belongsToAuditCheckout } from "@/lib/billing/products";
import { serverEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { stripe } from "./stripe";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type StripeHandlingResult = "processed" | "duplicate" | "ignored" | "unreconciled";

async function userIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin().from("profiles").select("id").eq("stripe_customer_id", customerId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Apply only this product's live Stripe subscription snapshot. A signed event
 * triggers a fresh Stripe fetch, while PostgreSQL validates owner/price and
 * commits event tracking with all audit entitlements atomically.
 */
export async function syncSubscription(sub: Stripe.Subscription, event: Stripe.Event): Promise<StripeHandlingResult> {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const userId = (sub.metadata?.user_id as string | undefined) ?? (await userIdForCustomer(customerId));
  if (!userId || !UUID.test(userId)) throw new Error("Cannot reconcile Stripe subscription owner");
  const item = sub.items.data[0];
  if (!item || sub.items.data.length !== 1) throw new Error("Unsupported subscription item count");
  const expected = serverEnv().STRIPE_PRICE_PRO;
  // Other products and Ventriva subscriptions must retain their own ledger.
  if (item.price.id !== expected) return "ignored";
  if (!Number.isSafeInteger(event.created) || event.created <= 0) throw new Error("Stripe event timestamp missing");
  if (!Number.isSafeInteger(item.current_period_start) || !Number.isSafeInteger(item.current_period_end)) {
    throw new Error("Invalid Stripe subscription period");
  }
  const { data, error } = await supabaseAdmin().rpc("apply_audit_subscription_event", {
    p_event_id: event.id,
    p_event_type: event.type,
    p_event_created: event.created,
    p_subscription_id: sub.id,
    p_customer_id: customerId,
    p_user_id: userId,
    p_price_id: item.price.id,
    p_expected_price_id: expected,
    p_status: sub.status,
    p_period_start: new Date(item.current_period_start * 1000).toISOString(),
    p_period_end: new Date(item.current_period_end * 1000).toISOString(),
    p_cancel_at_period_end: sub.cancel_at_period_end,
  });
  if (error) throw error;
  if (data === "applied") return "processed";
  if (data === "duplicate") return "duplicate";
  if (data === "stale") return "ignored";
  throw new Error("Unexpected audit subscription reconciliation response");
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
  // A legacy Ventriva purchase must never be fulfilled as an AuditFlow credit.
  if (!belongsToAuditCheckout(session.metadata)) return "ignored";
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
 * Never use a snapshot from a delayed webhook. Fetch current Stripe state
 * and allow the database to handle event idempotency and update ordering.
 */
async function processTrackedEvent(event: Stripe.Event): Promise<StripeHandlingResult> {
  let subId: string | null = null;
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode !== "subscription" || !session.subscription) return "ignored";
    subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  } else if (event.type === "customer.subscription.created" ||
             event.type === "customer.subscription.updated" ||
             event.type === "customer.subscription.deleted") {
    subId = (event.data.object as Stripe.Subscription).id;
  } else {
    return "ignored";
  }
  const current = await stripe().subscriptions.retrieve(subId);
  return syncSubscription(current, event);
}

/**
 * Processes one signature-verified Stripe event. Verification stays in the webhook route.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<StripeHandlingResult> {
  if (event.type === "charge.refunded") {
    return handleRefund(event);
  }
  const session = checkoutSession(event);
  if (session?.mode === "payment") return fulfillPaymentSession(event, session);
  return processTrackedEvent(event);
}

async function handleRefund(event: Stripe.Event): Promise<StripeHandlingResult> {
  const charge = event.data.object as Stripe.Charge;
  if (!charge.refunded || charge.amount_refunded < charge.amount) return "ignored";

  const paymentIntent = typeof charge.payment_intent === "string"
    ? charge.payment_intent
    : charge.payment_intent?.id;
  if (!paymentIntent) return "ignored";

  const sessions = await stripe().checkout.sessions.list({ payment_intent: paymentIntent, limit: 2 });
  const session = sessions.data[0];
  if (!session || session.mode !== "payment" || !belongsToAuditCheckout(session.metadata)) return "ignored";
  if (sessions.data.length !== 1 || sessions.has_more) throw new Error("Ambiguous refunded checkout session");

  const { data, error } = await supabaseAdmin().rpc("clawback_audit_credit", {
    p_event_id: event.id,
    p_session_id: session.id,
  });
  if (error) throw error;
  if (data === "duplicate") return "duplicate";
  if (data === "decremented" || data === "no_credit") return "processed";
  throw new Error("Unexpected audit refund reconciliation response");
}
