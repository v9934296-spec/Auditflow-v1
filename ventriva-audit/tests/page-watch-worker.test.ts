import { expect, it, vi } from "vitest";
import { checkPageWatches } from "@/trigger/check-watches";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pageSnapshot, readPage } from "@/lib/watch/page";

vi.mock("@trigger.dev/sdk", () => ({ schedules: { task: (config: unknown) => config } }));
vi.mock("@/lib/supabase/admin", () => ({ supabaseAdmin: vi.fn() }));
vi.mock("@/lib/watch/page", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/watch/page")>()), readPage: vi.fn(),
}));

it("saves a baseline, records one change, and keeps history for unchanged snapshots", async () => {
  const watch = {
    id: "test-watch", url: "https://example.com/pricing",
    digest: null as string | null, snapshot: null as string | null,
    history: [], next_check_at: "2026-01-01T00:00:00.000Z",
  };
  const database = {
    from: () => ({
      select: () => ({
        lte: () => ({
          order: () => ({ order: () => ({ limit: async () => ({ data: [watch], error: null }) }) }),
        }),
      }),
      update: (update: Partial<typeof watch>) => ({
        eq: (key: string, id: string) => ({
          eq: async (version: string, timestamp: string) => {
            expect([key, id]).toEqual(["id", watch.id]);
            expect([version, timestamp]).toEqual(["next_check_at", watch.next_check_at]);
            Object.assign(watch, update);
            return { error: null };
          },
        }),
      }),
    }),
  };
  vi.mocked(supabaseAdmin).mockReturnValue(database as unknown as ReturnType<typeof supabaseAdmin>);
  const run = (checkPageWatches as unknown as { run: () => Promise<void> }).run;

  vi.mocked(readPage).mockResolvedValue(pageSnapshot("<body>Basic plan.</body>"));
  await run();
  expect(watch.snapshot).toEqual("Basic plan.");
  expect(watch.history).toEqual([]);

  vi.mocked(readPage).mockResolvedValue(pageSnapshot("<body>New plan.</body>"));
  await run();
  await run();
  expect(watch.history).toEqual([
    { at: expect.any(String), added: ["New plan."], removed: ["Basic plan."] },
  ]);
});
