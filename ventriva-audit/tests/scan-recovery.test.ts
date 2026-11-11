import { expect, it, vi } from "vitest";
import { tasks } from "@trigger.dev/sdk";
import { failAudit, runAudit } from "@/lib/audits/run";
import { startAudit } from "@/lib/audits/service";
import { supabaseAdmin } from "@/lib/supabase/admin";

vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: vi.fn() } }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

it("delegates repeated failures to a single atomic database transition per delivery", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ single: () => ({ data: { status: "failed", credit_consumed: "audit_credit", user_id: "user" } }) }) }),
    update: () => ({ eq: () => ({ error: null }) }),
  }));
  vi.mocked(supabaseAdmin).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof supabaseAdmin>);

  await failAudit("audit", new Error("worker timed out"));
  await failAudit("audit", new Error("worker timed out"));

  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["fail_audit", "fail_audit"]);
  expect(from).not.toHaveBeenCalled();
});

it("keeps the reserved audit available when the dispatch response is lost", async () => {
  const audit = { id: "audit", user_id: "user", kind: "free_scan", status: "queued" };
  const rpc = vi.fn(() => ({ single: () => ({ data: audit, error: null }) }));
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => ({ data: { id: "repo" }, error: null }) }) }) }),
  }));
  vi.mocked(supabaseAdmin).mockReturnValue({ from, rpc } as unknown as ReturnType<typeof supabaseAdmin>);
  vi.mocked(tasks.trigger).mockRejectedValueOnce(new Error("response lost"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(startAudit("user", "repo", "free_scan")).resolves.toEqual(audit);
    expect(tasks.trigger).toHaveBeenCalledWith("run-audit", { auditId: "audit" }, expect.objectContaining({ idempotencyKey: "audit-audit" }));
    expect(rpc.mock.calls).toHaveLength(1);
  } finally {
    log.mockRestore();
  }
});

it("skips a delayed job when the audit has already been recovered", async () => {
  const filters: [string, string][] = [];
  const claim = {
    eq(column: string, value: string) {
      filters.push([column, value]);
      return claim;
    },
    select: () => ({ maybeSingle: () => ({ data: null, error: null }) }),
  };
  const update = vi.fn(() => claim);
  const from = vi.fn(() => ({ update }));
  vi.mocked(supabaseAdmin).mockReturnValue({ from } as unknown as ReturnType<typeof supabaseAdmin>);

  await expect(runAudit("audit")).resolves.toEqual({ status: "skipped" });
  expect(from).toHaveBeenCalledExactlyOnceWith("audits");
  expect(filters).toEqual([["id", "audit"], ["status", "queued"]]);
});
