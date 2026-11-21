import { expect, it } from "vitest";
import { memoryIndex } from "@/lib/analysis/files";
import { analyzeRepository } from "@/lib/analysis/pipeline";
import { scanEslint } from "@/lib/analysis/scanners/eslint";

it("actually runs rules on TypeScript instead of counting an ESLint configuration warning as inspection", async () => {
  const result = await scanEslint(memoryIndex({ "app.ts": "const execute = new Function('return 1');" }));
  expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: "eslint.no-new-func", filePath: "app.ts" })]));
});

it("names inspected, uncovered and unsupported source files without calling ingestion inspection", async () => {
  const result = await analyzeRepository(memoryIndex({
    "app.ts": "export const answer = 42;",
    "broken.ts": "export const = ;",
    "app.py": "print('hello')",
    "app.go": "package main",
    "README.md": "hello",
  }), { kind: "full_audit", disableSemgrep: true });

  expect(result.coverage).toMatchObject({
    filesIngested: 5,
    filesInspected: 1,
    sourceInventory: {
      inspected: ["app.ts"],
      notInspected: ["app.py", "broken.ts"],
      unsupported: ["app.go"],
    },
  });
});

it("records empty inspection lists when there is no source rather than omitting the inventory", async () => {
  const result = await analyzeRepository(memoryIndex({ "README.md": "hello" }), {
    kind: "free_scan", disableSemgrep: true,
  });
  expect(result.coverage).toMatchObject({
    sourceInventory: { inspected: [], notInspected: [], unsupported: [] },
    filesInspected: 0,
    sourceCoverage: 0,
  });
});
