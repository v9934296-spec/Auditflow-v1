import { describe, expect, it } from "vitest";
import { memoryIndex } from "@/lib/analysis/files";
import { scanSecrets } from "@/lib/analysis/scanners/secrets";
import { FAKE_STRIPE_LIVE } from "./helpers/fixtures";

describe("scanSecrets", () => {
  it("reports live keys in source as verified critical", async () => {
    const { findings } = await scanSecrets(memoryIndex({ "lib/pay.ts": `const k = "${FAKE_STRIPE_LIVE}";` }));
    expect(findings[0]).toMatchObject({ ruleId: "secrets.stripe-live-secret", severity: "critical", tier: "verified" });
  });
  it("downgrades keys in test fixtures to suspected and one level lower", async () => {
    const { findings } = await scanSecrets(memoryIndex({ "tests/pay.test.ts": `const k = "${FAKE_STRIPE_LIVE}";` }));
    expect(findings[0]).toMatchObject({ severity: "high", tier: "suspected", confidence: "low" });
  });
  it("ignores obvious placeholders and .env.example files", async () => {
    const placeholder = ["sk", "live", "x".repeat(24)].join("_");
    const { findings } = await scanSecrets(memoryIndex({ ".env.example": `STRIPE_SECRET_KEY=${placeholder}\n`, "a.ts": 'const k = "AKIAIOSFODNN7EXAMPLE";' }));
    expect(findings).toHaveLength(0);
  });
  it("flags committed .env files", async () => {
    const { findings } = await scanSecrets(memoryIndex({ ".env.production": "X=1" }));
    expect(findings.map((f) => f.ruleId)).toContain("secrets.env-file-committed");
  });
});
