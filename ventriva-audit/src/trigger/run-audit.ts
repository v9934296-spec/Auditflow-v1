import { AbortTaskRunError, logger, task } from "@trigger.dev/sdk";
import { failAudit, PermanentAuditError, runAudit } from "@/lib/audits/run";

/**
 * Isolated analysis worker. Runs on Trigger.dev machines, never on the web server.
 * Repository code is downloaded, parsed and scanned — it is never installed, built or executed.
 */
export const runAuditTask = task({
  id: "run-audit",
  maxDuration: 900,
  queue: { concurrencyLimit: 5 },
  retry: { maxAttempts: 2 },
  run: async (payload: { auditId: string }) => {
    try {
      const result = await runAudit(payload.auditId);
      logger.info("audit finished", { auditId: payload.auditId, ...result });
      return result;
    } catch (e) {
      if (e instanceof PermanentAuditError) {
        await failAudit(payload.auditId, e);
        throw new AbortTaskRunError(e.message);
      }
      throw e;
    }
  },
  onFailure: async ({ payload, error }) => {
    await failAudit(payload.auditId, error);
  },
});
