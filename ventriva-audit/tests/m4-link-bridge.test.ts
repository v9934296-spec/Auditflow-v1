import { createHash, createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { LinkCode, updateLegacyLink } from "@/lib/validation/link";

const id = "11111111-1111-4111-8111-111111111111";
const code = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef";
const secret = "test-shared-bridge-secret-not-for-production-64chars";
const host = "https://venturelens-l2q2.onrender.com";

beforeEach(() => {
  vi.stubEnv("VENTRIVA_BRIDGE_ORIGIN", host);
  vi.stubEnv("VENTRIVA_BRIDGE_SECRET", secret);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("M4 signed account-link bridge writes", () => {
  it("requires a fixed trusted origin, verified UUID and well-formed code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VENTRIVA_BRIDGE_ORIGIN", "http://localhost:8000");
    expect(await updateLegacyLink(id, "redeem", code)).toEqual({ status: "unavailable" });
    vi.stubEnv("VENTRIVA_BRIDGE_ORIGIN", host);
    expect(await updateLegacyLink("another-user", "redeem", code)).toEqual({ status: "unavailable" });
    expect(await updateLegacyLink(id, "redeem", "guess")).toEqual({ status: "conflict" });
    expect(LinkCode.safeParse(code).success).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs exact body and identity for a one-time code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "linked" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await updateLegacyLink(id, "redeem", code)).toEqual({ status: "linked" });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(host + "/api/internal/v1/link/redeem");
    expect(request.method).toBe("POST");
    expect(request.redirect).toBe("error");
    expect(request.cache).toBe("no-store");
    const headers = request.headers as Record<string, string>;
    expect(headers["x-bridge-user-id"]).toBe(id);
    expect(headers["x-bridge-nonce"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(request.body).toBe(JSON.stringify({ code }));
    const digest = createHash("sha256").update(request.body as string).digest("hex");
    expect(headers["x-bridge-signature"]).toBe(createHmac("sha256", secret)
      .update(`POST\n/api/internal/v1/link/redeem\n${id}\n${headers["x-bridge-timestamp"]}\n${headers["x-bridge-nonce"]}\n${digest}`).digest("hex"));
    expect(headers).not.toHaveProperty("authorization");
  });

  it("supports an independent signed revoke action without needing a code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"revoked":true}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await updateLegacyLink(id, "revoke")).toEqual({ status: "revoked", revoked: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(host + "/api/internal/v1/link/revoke");
    expect(options.body).toBe("{}");
  });

  it("fails closed on conflict, malformed, oversized and failed responses", async () => {
    const inputs = [
      [new Response("{}", { status: 409 }), { status: "conflict" }],
      [new Response('{"status":"linked","secret":"leak"}'), { status: "unavailable" }],
      [new Response("x".repeat(5000)), { status: "unavailable" }],
      [new Response("not json"), { status: "unavailable" }],
      [new Response("{}", { status: 503 }), { status: "unavailable" }],
    ] as const;
    for (const [response, expected] of inputs) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      expect(await updateLegacyLink(id, "redeem", code)).toEqual(expected);
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("never leak upstream secrets")));
    expect(await updateLegacyLink(id, "redeem", code)).toEqual({ status: "unavailable" });
  });
});
