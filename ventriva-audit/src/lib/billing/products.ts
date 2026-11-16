/**
 * M5 billing boundaries. A single Ventriva workspace is not a single Stripe
 * balance. The legacy validation service remains authoritative for its own
 * MongoDB allowances, purchases and subscriptions.
 *
 * This catalog controls routing/presentation only. No migration grants credits.
 */
export type BillingProduct = "audit" | "validation";
export type ProductCheckout =
  | { product: "audit"; kind: "audit" | "pro" }
  | { product: "validation"; kind: "idea_pack" | "founder" | "pro" };

export const BILLING_PRODUCTS = {
  audit: {
    label: "Repository audit",
    owner: "auditflow" as const,
    identity: "supabase" as const,
    ledger: "postgres" as const,
    checkout: "local" as const,
    plans: ["audit", "pro"] as const,
  },
  validation: {
    label: "Idea validation",
    owner: "legacy_ventriva" as const,
    identity: "legacy_session" as const,
    ledger: "mongo" as const,
    checkout: "external" as const,
    plans: ["idea_pack", "founder", "pro"] as const,
  },
} as const;

/** Product routing must never infer ownership from email, shared Stripe IDs, or a linked account. */
export function checkoutOwner(value: ProductCheckout): "auditflow" | "legacy_ventriva" {
  return BILLING_PRODUCTS[value.product].owner;
}

/** A Stripe event is fulfilled only in the application owning that checkout. */
export function belongsToAuditCheckout(metadata: Record<string, string> | null | undefined): boolean {
  return metadata?.kind === "audit" && (metadata.product === undefined || metadata.product === "audit");
}

/** New sessions always carry a product namespace. */
export function auditCheckoutMetadata(userId: string, kind: "audit" | "pro") {
  return { user_id: userId, kind, product: "audit" } as const;
}

/** Never transfer credits because accounts share an email or a Stripe customer. */
export function canTransferEntitlement(approval: {
  explicitCustomerConsent: boolean;
  verifiedAccountLink: boolean;
  verifiedSourceSubscription: boolean;
  reconciliationApproved: boolean;
}): boolean {
  return approval.explicitCustomerConsent && approval.verifiedAccountLink &&
    approval.verifiedSourceSubscription && approval.reconciliationApproved;
}
