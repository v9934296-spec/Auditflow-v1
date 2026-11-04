import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";
import { stripe } from "@/lib/stripe/stripe";
import { handleStripeEvent } from "@/lib/stripe/webhook";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.text(); // raw body — required for signature verification
  const signature = req.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "missing signature" }, { status: 400 });
  let event;
  try {
    event = stripe().webhooks.constructEvent(body, signature, serverEnv().STRIPE_WEBHOOK_SECRET);
  } catch {
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (e) {
    console.error("stripe webhook processing failed", event.id, e);
    return NextResponse.json({ error: "processing failed" }, { status: 500 }); // Stripe retries
  }
}
