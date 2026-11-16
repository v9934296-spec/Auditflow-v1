import { schedules } from "@trigger.dev/sdk";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { pageDiff, readPage } from "@/lib/watch/page";

export const checkPageWatches = schedules.task({
  id: "check-page-watches",
  cron: "*/5 * * * *",
  queue: { concurrencyLimit: 1 },
  retry: { maxAttempts: 1 },
  run: async () => {
    const db = supabaseAdmin();
    const now = new Date();
    const due = await db.from("page_watches").select("*")
      .lte("next_check_at", now.toISOString()).order("next_check_at").order("id").limit(10);
    if (due.error) throw due.error;

    const results = await Promise.allSettled(due.data.map(async (watch) => {
      const nextCheck = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      const common = { last_checked_at: now.toISOString(), next_check_at: nextCheck };
      let update;
      try {
        const page = await readPage(watch.url);
        const changed = watch.digest && watch.digest !== page.digest;
        const history = changed
          ? [{ at: common.last_checked_at, ...pageDiff(watch.snapshot ?? "", page.text) }, ...watch.history].slice(0, 20)
          : watch.history;
        update = { ...common, last_error: null, snapshot: page.text, title: page.title, digest: page.digest, history };
      } catch {
        update = { ...common, last_error: "Could not read the page. Confirm it is a direct public HTTPS URL." };
      }
      const { error } = await db.from("page_watches").update(update)
        .eq("id", watch.id).eq("next_check_at", watch.next_check_at);
      if (error) throw error;
    }));
    if (results.some((result) => result.status === "rejected")) throw new Error("Some watch checks could not be saved.");
  },
});
