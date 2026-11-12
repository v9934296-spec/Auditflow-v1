import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, rateLimit, updateLegacyLink } = vi.hoisted(() => ({
  getUser: vi.fn(), rateLimit: vi.fn(), updateLegacyLink: vi.fn(),
}));
vi.mock("@/lib/env", () => ({ publicEnv: { appUrl: "https://audit.example.test" } }));
vi.mock("@/lib/supabase/server", () => ({ getUser }));
vi.mock("@/lib/http/rate-limit", () => ({ rateLimit }));
vi.mock("@/lib/validation/link", () => ({
  LinkCode: { safeParse: (value: unknown) => ({
    success: typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value),
    data: value,
  }) },
  updateLegacyLink,
}));
import { POST, DELETE } from "@/app/api/validation/link/route";

const id = "11111111-1111-4111-8111-111111111111";
const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";

function req(method: string, body?: unknown, origin = "https://audit.example.test") {
  return new Request("https://audit.example.test/api/validation/link", {
    method, headers: { origin, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ id, email_confirmed_at: "2026-11-01" });
  rateLimit.mockResolvedValue(true);
  updateLegacyLink.mockResolvedValue({ status: "linked" });
});

describe("M4 link and unlink API authorization", () => {
  it("blocks cross-site and anonymous requests without invoking the legacy service", async () => {
    expect((await POST(req("POST", { code }, "https://attacker.test"))).status).toBe(403);
    expect(updateLegacyLink).not.toHaveBeenCalled();
    getUser.mockResolvedValue(null);
    expect((await POST(req("POST", { code }))).status).toBe(401);
    expect((await DELETE(req("DELETE"))).status).toBe(401);
    expect(updateLegacyLink).not.toHaveBeenCalled();
  });

  it("enforces confirmed email and per-user link rate limits", async () => {
    getUser.mockResolvedValueOnce({ id, email_confirmed_at: null });
    expect((await POST(req("POST", { code }))).status).toBe(403);
    rateLimit.mockResolvedValue(false);
    expect((await POST(req("POST", { code }))).status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith("validationLink", id);
    expect(updateLegacyLink).not.toHaveBeenCalled();
  });

  it("rejects malformed codes and extra body keys", async () => {
    expect((await POST(req("POST", { code: "short" }))).status).toBe(400);
    expect((await POST(req("POST", { code, other: id }))).status).toBe(400);
    expect(updateLegacyLink).not.toHaveBeenCalled();
  });

  it("only redeems under the signed-in Supabase account and never caches output", async () => {
    const result = await POST(req("POST", { code }));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(await result.json()).toEqual({ linked: true });
    expect(updateLegacyLink).toHaveBeenCalledExactlyOnceWith(id, "redeem", code);
  });

  it("does not expose internal errors or link another customer on conflict", async () => {
    updateLegacyLink.mockResolvedValueOnce({ status: "conflict" });
    const rejected = await POST(req("POST", { code }));
    expect(rejected.status).toBe(409);
    updateLegacyLink.mockResolvedValueOnce({ status: "unavailable" });
    const down = await POST(req("POST", { code }));
    expect(down.status).toBe(503);
    expect((await down.json()).error).not.toMatch(/secret|internal hostname|mongo/i);
  });

  it("revokes only the authenticated user's mapping and returns no tokens", async () => {
    updateLegacyLink.mockResolvedValue({ status: "revoked", revoked: true });
    const res = await DELETE(req("DELETE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ revoked: true });
    expect(updateLegacyLink).toHaveBeenCalledExactlyOnceWith(id, "revoke");
  });
});
