import { describe, expect, it } from "vitest";
import { productModules, VALIDATION_APP_URL } from "@/lib/product/modules";

describe("M2 Ventriva presentation contracts", () => {
  it("exposes distinct Validate, Audit and Monitor modules with stable local paths", () => {
    expect(productModules.map((m) => [m.id, m.href])).toEqual([
      ["validate", "/validate"],
      ["audit", "/dashboard"],
      ["monitor", "/monitor"],
    ]);
    expect(new Set(productModules.map((m) => m.id)).size).toBe(3);
    expect(productModules.every((m) => m.summary.length > 35)).toBe(true);
  });

  it("labels the validation app as independent rather than implying shared accounts", () => {
    expect(productModules.find((m) => m.id === "validate")?.status).toBe("separate_app");
    expect(new URL(VALIDATION_APP_URL).protocol).toBe("https:");
    expect(new URL(VALIDATION_APP_URL).hostname).toBe("venturelens-l2q2.onrender.com");
  });

  it("does not claim that monitoring is available without its existing entitlement", () => {
    expect(productModules.find((m) => m.id === "monitor")?.status).toBe("audit_pro");
  });
});
