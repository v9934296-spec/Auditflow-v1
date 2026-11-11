import { beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

const { insert, rpc, retrieve, constructEvent } = vi.hoisted(() => ({
  insert: vi.fn(),
  rpc: vi.fn(),
  retrieve: vi.fn(),
  constructEvent: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  serverEnv: () => ({ STRIPE_PRICE_PRO: "price_pro_test", STRIPE_WEBHOOK_SECRET: "whsec_test" }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      if (table === "stripe_events") {
        return {
          insert: (...args: unknown[]) => insert(...args),
          delete: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      return {
        upsert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
        select: () => ({ eq: () => ({ single: async () => ({ data: { period_start: null }, error: null }), maybeSingle: async () => ({ data: { id: "user-1" } }) }) }),
      };
    },
  }),
}));

vi.mock("@/lib/stripe/stripe", () => ({
  stripe: () => ({ subscriptions: { retrieve }, webhooks: { constructEvent } }),
}));

import { handleStripeEvent } from "@/lib/stripe/webhook";
import { POST } from "@/app/api/stripe/webhook/route";

const userId = "11111111-1111-4111-8111-111111111111";

function paymentEvent(over: Partial<Stripe.Checkout.Session> = {}, id = "evt_1"): Stripe.Event {
  return {
    id,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_1",
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        metadata: { kind: "audit", user_id: userId },
        client_reference_id: userId,
        ...over,
      },
    },
  } as Stripe.Event;
}

describe("audit checkout fulfillment routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: "granted", error: null });
    insert.mockResolvedValue({ error: null });
  });

  it("sends an eligible payment to the atomic fulfillment function and does not pre-insert the event", async () => {
    const result = await handleStripeEvent(paymentEvent());
    expect(result).toBe("processed");
    expect(rpc).toHaveBeenCalledWith("fulfill_audit_checkout", expect.objectContaining({
      p_event_id: "evt_1",
      p_session_id: "cs_1",
      p_user_id: userId,
      p_mode: "payment",
      p_payment_status: "paid",
      p_kind: "audit",
    }));
    expect(insert).not.toHaveBeenCalled();
  });

  it("does not call credit fulfillment for a subscription checkout", async () => {
    retrieve.mockResolvedValue({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { user_id: userId },
      items: { data: [{ price: { id: "price_pro_test" }, current_period_start: 1_700_000_000, current_period_end: 1_700_000_100 }] },
    });
    const event = paymentEvent({ mode: "subscription", subscription: "sub_1", metadata: { kind: "pro", user_id: userId } });
    const result = await handleStripeEvent(event);
    expect(result).toBe("processed");
    expect(rpc).not.toHaveBeenCalled();
    expect(insert).toHaveBeenCalled();
    expect(retrieve).toHaveBeenCalledWith("sub_1");
  });

  it("treats a repeated subscription event id as a duplicate", async () => {
    insert.mockResolvedValue({ error: { code: "23505", message: "duplicate" } });
    const event = {
      id: "evt_sub",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    } as Stripe.Event;
    expect(await handleStripeEvent(event)).toBe("duplicate");
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe("webhook signature boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
  });

  it("rejects an invalid signature before fulfillment", async () => {
    const req = new Request("http://localhost/api/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=nope" },
      body: "{}",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("rejects a missing signature before fulfillment", async () => {
    const req = new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
