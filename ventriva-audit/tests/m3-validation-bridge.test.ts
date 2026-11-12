import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

import { listLinkedAnalyses } from "@/lib/validation/bridge";

const uid = "11111111-1111-4111-8111-111111111111";
const secret = "m3-only-test-secret-length-at-least-thirty-two-characters";
const source = "https://venturelens-l2q2.onrender.com";

beforeEach(() => {
  vi.stubEnv("VENTRIVA_BRIDGE_SECRET", secret);
  vi.stubEnv("VENTRIVA_BRIDGE_ORIGIN", source);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("M3 signed and bounded server-side validation adapter", () => {
  it("fails closed without configuration or with an unsafe upstream origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("VENTRIVA_BRIDGE_SECRET", "");
    expect(await listLinkedAnalyses(uid)).toEqual({ status: "unavailable" });
    vi.stubEnv("VENTRIVA_BRIDGE_SECRET", secret);
    vi.stubEnv("VENTRIVA_BRIDGE_ORIGIN", "http://127.0.0.1:8000");
    expect(await listLinkedAnalyses(uid)).toEqual({ status: "unavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("signs the exact fixed path and user identity, never forwards browser tokens", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      analyses: [{ id: "analysis-1", name: "Safe", kind: "preview", status: "complete", created_at: "2026-11-11" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listLinkedAnalyses(uid)).toEqual({ status: "ok", analyses: [{
      id: "analysis-1", name: "Safe", kind: "preview", status: "complete", created_at: "2026-11-11",
    }] });
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(source + "/api/internal/v1/analyses");
    expect(options.method).toBe("GET");
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
    const headers = options.headers as Record<string, string>;
    expect(headers["x-bridge-user-id"]).toBe(uid);
    const expected = createHmac("sha256", secret).update(
      `GET\n/api/internal/v1/analyses\n${uid}\n${headers["x-bridge-timestamp"]}`
    ).digest("hex");
    expect(headers["x-bridge-signature"]).toBe(expected);
    expect(headers).not.toHaveProperty("authorization");
    expect(headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("turns absent account links into an explicit not-linked status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 404 })));
    expect(await listLinkedAnalyses(uid)).toEqual({ status: "not_linked" });
  });

  it("rejects extra report data, malformed output and oversized responses", async () => {
    for (const data of [
      { analyses: [{ id: "a", name: "n", kind: "preview", status: "complete", created_at: "now", report: { secret: 1 } }] },
      { analyses: [{ id: "a", name: "n", kind: "other", status: "complete", created_at: "now" }] },
      { analyses: [{ id: "a", name: "n", kind: "preview", status: "complete", created_at: "now" }], secret: "leak" },
      { analyses: Array(21).fill({ id: "a", name: "n", kind: "preview", status: "complete", created_at: "now" }) },
    ]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(data), { status: 200 })));
      expect(await listLinkedAnalyses(uid)).toEqual({ status: "unavailable" });
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("x".repeat(70_000), { status: 200 })));
    expect(await listLinkedAnalyses(uid)).toEqual({ status: "unavailable" });
  });

  it("returns unavailable for upstream failures and invalid user identifiers", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("internal upstream secret in error"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await listLinkedAnalyses(uid)).toEqual({ status: "unavailable" });
    expect(await listLinkedAnalyses("not-a-uuid")).toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
