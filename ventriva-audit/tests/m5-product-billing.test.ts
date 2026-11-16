import { describe, expect, it } from "vitest";
import { BILLING_PRODUCTS, auditCheckoutMetadata, belongsToAuditCheckout, canTransferEntitlement, checkoutOwner } from "@/lib/billing/products";

describe("M5 product-scoped billing boundary", () => {
  it("keeps distinct owners, identifiers and entitlement ledgers", () => {
    expect(BILLING_PRODUCTS.audit.ledger).toBe("postgres");
    expect(BILLING_PRODUCTS.validation.ledger).toBe("mongo");
    expect(BILLING_PRODUCTS.audit.identity).toBe("supabase");
    expect(BILLING_PRODUCTS.validation.identity).toBe("legacy_session");
    expect(checkoutOwner({ product: "audit", kind: "pro" })).toBe("auditflow");
    expect(checkoutOwner({ product: "validation", kind: "pro" })).toBe("legacy_ventriva");
  });
  it("adds explicit namespace to new checkout metadata and rejects unrelated products", () => {
    const meta = auditCheckoutMetadata("uuid", "audit");
    expect(meta).toEqual({ user_id: "uuid", kind: "audit", product: "audit" });
    expect(belongsToAuditCheckout(meta)).toBe(true);
    expect(belongsToAuditCheckout({ kind: "audit", product: "validation" })).toBe(false);
    expect(belongsToAuditCheckout({ kind: "audit", product: "some_other_product" })).toBe(false);
    expect(belongsToAuditCheckout({ kind: "pro", product: "audit" })).toBe(false);
    // AuditFlow checkouts that predate M5 have no explicit product metadata.
    expect(belongsToAuditCheckout({ kind: "audit" })).toBe(true);
  });
  it("defaults to no cross-product entitlement migration", () => {
    const ready = {
      explicitCustomerConsent: true,
      verifiedAccountLink: true,
      verifiedSourceSubscription: true,
      reconciliationApproved: true,
    };
    expect(canTransferEntitlement(ready)).toBe(true);
    for (const field of Object.keys(ready) as (keyof typeof ready)[]) {
      expect(canTransferEntitlement({ ...ready, [field]: false })).toBe(false);
    }
  });
});
