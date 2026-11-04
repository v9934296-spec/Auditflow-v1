import { PRO, type AuditKind } from "@/lib/config/plans";
import type { EntitlementsRow } from "@/lib/db/types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const ENTITLEMENT_MESSAGES: Record<string, string> = {
  FREE_SCAN_USED: "You've used your free scan. Buy a full audit to keep going.",
  NO_AUDIT_CREDITS: "You don't have an audit credit. Purchase a full audit ($29) first.",
  PRO_REQUIRED: "Targeted rechecks and monitoring require the Pro plan.",
  RECHECKS_EXHAUSTED: `You've used all ${PRO.rechecksPerPeriod} rechecks for this billing period.`,
  ENTITLEMENT_MISSING: "Your account isn't fully set up yet. Please sign out and back in.",
};

export class EntitlementError extends Error {
  constructor(readonly code: string) {
    super(ENTITLEMENT_MESSAGES[code] ?? "Not allowed.");
    this.name = "EntitlementError";
  }
}

export async function getEntitlements(userId: string): Promise<EntitlementsRow> {
  const { data, error } = await supabaseAdmin().from("entitlements").select("*").eq("user_id", userId).single();
  if (error) throw error;
  return data as EntitlementsRow;
}

/** Atomically consumes the entitlement for `kind` (row-locked in Postgres). */
export async function consumeEntitlement(userId: string, kind: AuditKind): Promise<string> {
  const { data, error } = await supabaseAdmin().rpc("consume_entitlement", { p_user_id: userId, p_kind: kind, p_rechecks_per_period: PRO.rechecksPerPeriod });
  if (error) {
    const code = Object.keys(ENTITLEMENT_MESSAGES).find((c) => error.message.includes(c));
    if (code) throw new EntitlementError(code);
    throw error;
  }
  return data as string;
}

export async function refundEntitlement(userId: string, consumed: string | null): Promise<void> {
  if (!consumed || consumed === "monitor") return;
  const { error } = await supabaseAdmin().rpc("refund_entitlement", { p_user_id: userId, p_consumed: consumed });
  if (error) throw error;
}

export function canUse(e: EntitlementsRow, kind: AuditKind): boolean {
  const proActive = e.plan === "pro" && !!e.period_end && new Date(e.period_end) > new Date();
  switch (kind) {
    case "free_scan":
      return e.free_scans_used < 1;
    case "full_audit":
      return e.audit_credits > 0;
    case "recheck":
      return proActive && e.rechecks_used < PRO.rechecksPerPeriod;
    case "monitor":
      return proActive;
  }
}
