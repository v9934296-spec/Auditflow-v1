import { beforeEach, describe, expect, it, vi } from "vitest";
import { tasks } from "@trigger.dev/sdk";
import { startAudit } from "@/lib/audits/service";
import { supabaseAdmin } from "@/lib/supabase/admin";

vi.mock("@trigger.dev/sdk", () => ({ tasks: { trigger: vi.fn() } }));
vi.mock("@/lib/env", () => ({ serverEnv: () => ({}) }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));

const REPO = "repo-1";

function history(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `audit-${index}`,
    repository_id: REPO,
    status: "completed",
    kind: index % 2 === 0 ? "full_audit" : "recheck",
    completed_at: new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString(),
    created_at: new Date(Date.UTC(2020, 0, 1) + index * 86_400_000).toISOString(),
  }));
}

describe("latest baseline query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tasks.trigger).mockResolvedValue({ id: "run" } as never);
  });

  function mockAudits(rows: ReturnType<typeof history>, error: { message: string } | null = null) {
    const rpc = vi.fn((_name: string, _args: Record<string, unknown>) => ({ single: async () => ({ data: { id: "queued", user_id: "user", kind: "recheck", status: "queued" }, error: null }) }));
    const seen: { eq: [string, unknown][]; in?: [string, unknown]; not: [string, unknown, unknown][]; orders: [string, unknown][]; limit?: number } = { eq: [], not: [], orders: [] };
    const audits = {
      select: () => audits,
      eq(column: string, value: unknown) {
        seen.eq.push([column, value]);
        return audits;
      },
      in(column: string, value: unknown) {
        seen.in = [column, value];
        return audits;
      },
      not(column: string, operator: unknown, value: unknown) {
        seen.not.push([column, operator, value]);
        return audits;
      },
      order(column: string, options: unknown) {
        seen.orders.push([column, options]);
        return audits;
      },
      limit(count: number) {
        seen.limit = count;
        return audits;
      },
      maybeSingle() {
        if (error) return { data: null, error };
        const kinds = new Set((seen.in?.[1] as string[] | undefined) ?? []);
        const repository = seen.eq.find(([column]) => column === "repository_id")?.[1];
        const status = seen.eq.find(([column]) => column === "status")?.[1];
        const eligible = rows.filter((row) => row.repository_id === repository && row.status === status && kinds.has(row.kind));
        const descending = seen.orders[0]?.[0] === "completed_at" && (seen.orders[0][1] as { ascending?: boolean }).ascending === false && seen.limit === 1;
        const ordered = [...eligible].sort((a, b) => {
          const completed = descending ? b.completed_at.localeCompare(a.completed_at) : a.completed_at.localeCompare(b.completed_at);
          if (completed !== 0) return completed;
          const created = b.created_at.localeCompare(a.created_at);
          if (created !== 0) return created;
          return b.id.localeCompare(a.id);
        });
        const page = descending ? ordered.slice(0, seen.limit) : ordered.slice(0, 1000);
        return { data: page[0] ?? null, error: null };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    };
    vi.mocked(supabaseAdmin).mockReturnValue({
      from: (table: string) => {
        if (table === "repositories") {
          return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: REPO, user_id: "user" }, error: null }) }) }) }) };
        }
        if (table === "audits") return audits;
        throw new Error(table);
      },
      rpc,
    } as unknown as ReturnType<typeof supabaseAdmin>);
    return { seen, rpc };
  }

  it("selects the newest baseline when more than 1000 audits exist", async () => {
    const rows = history(1001);
    const { seen, rpc } = mockAudits(rows);
    await startAudit("user", REPO, "recheck");
    expect(seen.eq).toEqual(expect.arrayContaining([["repository_id", REPO], ["status", "completed"]]));
    expect(seen.in?.[0]).toBe("kind");
    expect(seen.in?.[1]).toEqual(["full_audit", "recheck", "monitor"]);
    expect(seen.not).toEqual([["completed_at", "is", null]]);
    expect(seen.orders).toEqual([
      ["completed_at", { ascending: false, nullsFirst: false }],
      ["created_at", { ascending: false }],
      ["id", { ascending: false }],
    ]);
    expect(seen.limit).toBe(1);
    expect(rpc).toHaveBeenCalledWith("queue_user_audit", expect.objectContaining({ p_previous_audit_id: "audit-1000" }));
  });

  it("throws when the baseline query fails", async () => {
    mockAudits([], { message: "baseline query failed" });
    await expect(startAudit("user", REPO, "recheck")).rejects.toMatchObject({ message: "baseline query failed" });
  });
});
