import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rateLimit, startAudit, createCheckoutSession } = vi.hoisted(() => ({
  getUser: vi.fn(),
  rateLimit: vi.fn(),
  startAudit: vi.fn(),
  createCheckoutSession: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  publicEnv: { appUrl: "https://staging.example.test", supabaseUrl: "", supabaseAnonKey: "" },
}));
vi.mock("@/lib/supabase/server", () => ({ getUser }));
vi.mock("@/lib/http/rate-limit", () => ({ rateLimit }));
vi.mock("@/lib/audits/service", () => ({
  startAudit,
  AuditRequestError: class AuditRequestError extends Error {
    constructor(message: string, public status = 400) { super(message); }
  },
}));
vi.mock("@/lib/audits/entitlements", () => ({
  EntitlementError: class EntitlementError extends Error {},
}));
vi.mock("@/lib/stripe/stripe", () => ({ createCheckoutSession }));

import { POST as startAuditRoute } from "@/app/api/audits/route";
import { POST as checkoutRoute } from "@/app/api/billing/checkout/route";

const repositoryId = "11111111-1111-4111-8111-111111111111";
const user = { id: "22222222-2222-4222-8222-222222222222",
  email: "owner@example.test", email_confirmed_at: "2026-01-01T00:00:00Z" };

function request(path: string, body: unknown, origin = "https://staging.example.test") {
  return new Request(`https://staging.example.test${path}`, {
    method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue(user);
  rateLimit.mockResolvedValue(true);
  startAudit.mockResolvedValue({ id: "audit-1" });
  createCheckoutSession.mockResolvedValue("https://checkout.stripe.com/test");
});

describe("M1 AuditFlow API contracts", () => {
  it("rejects a cross-site audit request before reading identity or spending credits", async () => {
    const result = await startAuditRoute(request("/api/audits", {
      repositoryId, kind: "full_audit",
    }, "https://attacker.example"));
    expect(result.status).toBe(403);
    expect(getUser).not.toHaveBeenCalled();
    expect(startAudit).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated audit requests and does not dispatch", async () => {
    getUser.mockResolvedValue(null);
    const result = await startAuditRoute(request("/api/audits", { repositoryId, kind: "free_scan" }));
    expect(result.status).toBe(401);
    expect(startAudit).not.toHaveBeenCalled();
  });

  it("requires verified email and accepts only the named audit kinds", async () => {
    getUser.mockResolvedValueOnce({ ...user, email_confirmed_at: null });
    const unconfirmed = await startAuditRoute(request("/api/audits", { repositoryId, kind: "full_audit" }));
    expect(unconfirmed.status).toBe(403);
    const invalid = await startAuditRoute(request("/api/audits", { repositoryId, kind: "monitor" }));
    expect(invalid.status).toBe(400);
    expect(startAudit).not.toHaveBeenCalled();
  });

  it("preserves the start-audit response contract", async () => {
    const result = await startAuditRoute(request("/api/audits", { repositoryId, kind: "free_scan" }));
    expect(result.status).toBe(201);
    expect(await result.json()).toEqual({ id: "audit-1" });
    expect(startAudit).toHaveBeenCalledExactlyOnceWith(user.id, repositoryId, "free_scan");
  });

  it("blocks anonymous checkout and returns no Stripe URL", async () => {
    getUser.mockResolvedValue(null);
    const result = await checkoutRoute(request("/api/billing/checkout", { kind: "audit" }));
    expect(result.status).toBe(401);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("does not accept Ventriva's distinct subscription plan identifiers", async () => {
    const result = await checkoutRoute(request("/api/billing/checkout", { kind: "founder" }));
    expect(result.status).toBe(400);
    expect(createCheckoutSession).not.toHaveBeenCalled();
  });

  it("preserves audit checkout URL response and owner identity", async () => {
    const result = await checkoutRoute(request("/api/billing/checkout", { kind: "audit" }));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ url: "https://checkout.stripe.com/test" });
    expect(createCheckoutSession).toHaveBeenCalledExactlyOnceWith(user.id, user.email, "audit");
  });
});
