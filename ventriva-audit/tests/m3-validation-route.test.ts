import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rateLimit, listLinkedAnalyses } = vi.hoisted(() => ({
  getUser: vi.fn(), rateLimit: vi.fn(), listLinkedAnalyses: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ getUser }));
vi.mock("@/lib/http/rate-limit", () => ({ rateLimit }));
vi.mock("@/lib/validation/bridge", () => ({ listLinkedAnalyses }));

import { GET } from "@/app/api/validation/analyses/route";

const uid = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ id: uid });
  rateLimit.mockResolvedValue(true);
  listLinkedAnalyses.mockResolvedValue({ status: "ok", analyses: [] });
});

describe("M3 user-facing validation gateway", () => {
  it("denies unauthenticated requests without reading the legacy API", async () => {
    getUser.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(rateLimit).not.toHaveBeenCalled();
    expect(listLinkedAnalyses).not.toHaveBeenCalled();
  });

  it("rate limits each authenticated Supabase identity before fetching", async () => {
    rateLimit.mockResolvedValue(false);
    const response = await GET();
    expect(response.status).toBe(429);
    expect(rateLimit).toHaveBeenCalledExactlyOnceWith("validationRead", uid);
    expect(listLinkedAnalyses).not.toHaveBeenCalled();
  });

  it("does not claim accounts are linked before M4 verification", async () => {
    listLinkedAnalyses.mockResolvedValue({ status: "not_linked" });
    const response = await GET();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Account linking not yet complete" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("never forwards internal upstream errors and handles failures generically", async () => {
    listLinkedAnalyses.mockResolvedValue({ status: "unavailable" });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Validation service unavailable" });
  });

  it("returns only the validated summaries for the authenticated user", async () => {
    const item = { id: "analysis-1", name: "Idea", status: "complete", kind: "full", created_at: "2026-11-11" };
    listLinkedAnalyses.mockResolvedValue({ status: "ok", analyses: [item] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ analyses: [item] });
    expect(listLinkedAnalyses).toHaveBeenCalledExactlyOnceWith(uid);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
