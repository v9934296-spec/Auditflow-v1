import { describe, expect, it } from "vitest";
import { productModules, VALIDATION_APP_URL } from "@/lib/product/modules";

describe("M2 Ventriva presentation contracts", () => {
  it("exposes distinct Validate, Audit and Watch modules with stable local paths", () => {
    expect(productModules.map((m) => [m.id, m.href])).toEqual([
      ["validate", "/validate"],
      ["audit", "/dashboard"],
      ["watch", "/watch"],
    ]);
    expect(new Set(productModules.map((m) => m.id)).size).toBe(3);
    expect(productModules.every((m) => m.summary.length > 35)).toBe(true);
  });

  it("labels the validation app as independent rather than implying shared accounts", () => {
    expect(productModules.find((m) => m.id === "validate")?.status).toBe("separate_app");
    expect(new URL(VALIDATION_APP_URL).protocol).toBe("https:");
    expect(new URL(VALIDATION_APP_URL).hostname).toBe("venturelens-l2q2.onrender.com");
  });

  it("exposes public page watches separately from audit monitoring", () => {
    expect(productModules.find((m) => m.id === "watch")?.status).toBe("available");
  });
});
