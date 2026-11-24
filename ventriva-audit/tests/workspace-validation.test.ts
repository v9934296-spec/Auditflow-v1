import { createHash, createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { readWorkspaceAnalysis, startWorkspaceAnalysis } from "@/lib/validation/workspace";

vi.mock("server-only", () => ({}));

const user = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const secret = "workspace-unit-test-secret-over-32-characters";
const origin = "https://venturelens-l2q2.onrender.com";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("signs the fixed path and exact body for workspace submissions", async () => {
  vi.stubEnv("VENTRIVA_BRIDGE_ORIGIN", origin);
  vi.stubEnv("VENTRIVA_BRIDGE_SECRET", secret);
  const transport = vi.fn(async (url: string, init: RequestInit) => {
    const path = "/api/internal/v1/analyses/create";
    expect(url).toBe(origin + path);
    expect(init.redirect).toBe("error");
    const headers = new Headers(init.headers);
    const digest = createHash("sha256").update(String(init.body)).digest("hex");
    const nonce = headers.get("x-bridge-nonce");
    const timestamp = headers.get("x-bridge-timestamp");
    const signature = createHmac("sha256", secret)
      .update(`POST\n${path}\n${user}\n${timestamp}\n${nonce}\n${digest}`).digest("hex");
    expect(headers.get("x-bridge-signature")).toBe(signature);
    expect(JSON.parse(String(init.body))).toEqual({
      request_id: id, kind: "preview", idea: { name: "Kites", concept: "Repair kites", target_customer: "" },
    });
    return Response.json({ id });
  });
  vi.stubGlobal("fetch", transport);
  expect(await startWorkspaceAnalysis(user, {
    requestId: id, kind: "preview", name: "Kites", concept: "Repair kites", target_customer: "",
  })).toEqual({ ok: true, data: { id } });
  expect(transport).toHaveBeenCalledOnce();
});

it("keeps an unavailable or unauthorized report from being rendered", async () => {
  vi.stubEnv("VENTRIVA_BRIDGE_ORIGIN", origin);
  vi.stubEnv("VENTRIVA_BRIDGE_SECRET", secret);
  const transport = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ report: { incomplete: true } }));
  vi.stubGlobal("fetch", transport);
  expect(await readWorkspaceAnalysis(user, id)).toEqual({ ok: false, status: 404 });
  expect(await readWorkspaceAnalysis(user, id)).toEqual({ ok: false, status: 503 });
});
