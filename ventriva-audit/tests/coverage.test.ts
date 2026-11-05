import { describe, expect, it } from "vitest";
import { inspectedSourceFiles } from "@/lib/analysis/pipeline";

describe("inspectedSourceFiles", () => {
  const source = ["a.ts", "b.py", "c.sql"];

  it("does not treat a scanner that omitted its file list as having inspected the tree", () => {
    expect(inspectedSourceFiles(source, [{ name: "eslint", status: "ran" }, { name: "semgrep", status: "ran" }])).toEqual([]);
  });

  it("leaves a Python-only tree uncovered when ESLint has nothing it can parse", () => {
    expect(inspectedSourceFiles(["app.py"], [{ name: "eslint", status: "skipped", reason: "No JavaScript/TypeScript files.", inspectedFiles: [] }])).toEqual([]);
  });

  it("counts only files that parsed, so a total parser failure covers nothing", () => {
    expect(inspectedSourceFiles(source, [{ name: "eslint", status: "partial", reason: "3 file(s) could not be parsed and were not linted.", inspectedFiles: [] }])).toEqual([]);
  });

  it("reports 3 of 10 eligible files as partial coverage, not a full inspection", () => {
    const files = Array.from({ length: 10 }, (_, i) => `src/f${i}.ts`);
    const inspected = inspectedSourceFiles(files, [{ name: "semgrep", status: "ran", inspectedFiles: files.slice(0, 3) }]);
    expect(inspected).toHaveLength(3);
    expect(inspected.length / files.length).toBe(0.3);
  });

  it("unions Semgrep's reported files and ignores the ones it did not scan", () => {
    expect(inspectedSourceFiles(source, [
      { name: "semgrep", status: "ran", inspectedFiles: ["b.py"] },
      { name: "eslint", status: "partial", inspectedFiles: ["a.ts"] },
      { name: "secrets", status: "ran", inspectedFiles: source },
    ]).sort()).toEqual(["a.ts", "b.py"]);
  });
});
