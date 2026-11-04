import { describe, expect, it } from "vitest";
import { memoryIndex } from "@/lib/analysis/files";
import { parsePackageLock, parsePnpmLock, parseRequirements, parseYarnLock, scanOsv, type FetchLike } from "@/lib/analysis/scanners/osv";

describe("lockfile parsers", () => {
  it("parses package-lock v3 including scoped and nested", () => {
    const pkgs = parsePackageLock(JSON.stringify({ packages: { "": {}, "node_modules/next": { version: "14.0.0" }, "node_modules/@a/b": { version: "1.0.0" }, "node_modules/x/node_modules/y": { version: "2.0.0" }, "packages/app": { version: "0.0.1" } } }), "package-lock.json");
    expect(pkgs.map((p) => `${p.name}@${p.version}`)).toEqual(["next@14.0.0", "@a/b@1.0.0", "y@2.0.0"]);
  });
  it("parses pnpm v9 and v6 keys", () => {
    const pkgs = parsePnpmLock("lockfileVersion: '9.0'\npackages:\n  next@14.0.0:\n    resolution: {}\n  '@scope/pkg@1.2.3(react@18.0.0)':\n    resolution: {}\n  /old@0.1.0:\n    resolution: {}\n", "pnpm-lock.yaml");
    expect(pkgs.map((p) => `${p.name}@${p.version}`)).toEqual(["next@14.0.0", "@scope/pkg@1.2.3", "old@0.1.0"]);
  });
  it("parses yarn v1", () => {
    const pkgs = parseYarnLock('# yarn lockfile v1\n\n"@babel/core@^7.0.0", "@babel/core@^7.1.0":\n  version "7.2.0"\n\nlodash@^4.17.0:\n  version "4.17.20"\n', "yarn.lock");
    expect(pkgs.map((p) => `${p.name}@${p.version}`)).toEqual(["@babel/core@7.2.0", "lodash@4.17.20"]);
  });
  it("parses pinned requirements only", () => {
    expect(parseRequirements("django==4.2.0\nrequests>=2\nflask[async]==3.0.0 # web\n", "requirements.txt").map((p) => p.name)).toEqual(["django", "flask"]);
  });
});

describe("scanOsv", () => {
  it("maps advisories to verified findings with fixed versions", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (url.endsWith("/querybatch")) return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-test-1234" }] }] }));
      return new Response(JSON.stringify({ id: "GHSA-test-1234", summary: "Auth bypass in middleware", aliases: ["CVE-2025-29927"], database_specific: { severity: "CRITICAL" }, affected: [{ package: { name: "next" }, ranges: [{ events: [{ introduced: "0" }, { fixed: "14.2.25" }] }] }] }));
    };
    const repo = memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/next": { version: "14.0.0" } } }) });
    const { findings, run } = await scanOsv(repo, fetchImpl);
    expect(run.status).toBe("ran");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "critical", tier: "verified", source: "osv" });
    expect(findings[0]!.title).toContain("CVE-2025-29927");
    expect(findings[0]!.remediation).toContain("14.2.25");
  });
  it("skips (does not pass) when no lockfile exists", async () => {
    const { run } = await scanOsv(memoryIndex({ "index.js": "" }), async () => new Response("{}"));
    expect(run.status).toBe("skipped");
  });
});
