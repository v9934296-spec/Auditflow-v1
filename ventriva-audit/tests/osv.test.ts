import { describe, expect, it } from "vitest";
import { memoryIndex } from "@/lib/analysis/files";
import { cvssV2Base, cvssV3Base, parsePackageLock, parsePnpmLock, parseRequirements, parseYarnLock, scanOsv, type FetchLike } from "@/lib/analysis/scanners/osv";

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
  it("classifies CVSS v3 and v2 vectors and does not invent a medium severity", () => {
    expect(cvssV3Base("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H")).toBe(9.8);
    expect(cvssV3Base("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N")).toBe(7.5);
    expect(cvssV2Base("AV:N/AC:L/Au:N/C:P/I:N/A:N")).toBe(5);
    expect(cvssV2Base("AV:N/AC:L/Au:N/C:C/I:C/A:C")).toBe(10);
  });
  it("uses a CVSS v3 vector when database_specific severity is absent", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).endsWith("/querybatch")) return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-cvss" }] }] }));
      return new Response(JSON.stringify({ id: "GHSA-cvss", summary: "RCE", severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }));
    };
    const { findings, run } = await scanOsv(memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) }), fetchImpl);
    expect(run.status).toBe("ran");
    expect(findings[0]?.severity).toBe("critical");
    expect(findings[0]?.evidence.facts?.severityUncertain).toBe(false);
  });
  it("marks an unsupported severity as unclassified and the scan partial", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).endsWith("/querybatch")) return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-v4" }] }] }));
      return new Response(JSON.stringify({ id: "GHSA-v4", summary: "Issue", severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N" }] }));
    };
    const { findings, run } = await scanOsv(memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) }), fetchImpl);
    expect(findings[0]?.severity).not.toBe("medium");
    expect(findings[0]?.evidence.facts?.severityUncertain).toBe(true);
    expect(run.status).toBe("partial");
  });
  it("classifies a complete CVSS v2 compromise as high, because v2 has no critical band", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).endsWith("/querybatch")) return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-v2" }] }] }));
      return new Response(JSON.stringify({ id: "GHSA-v2", summary: "Full compromise", severity: [{ type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:C/I:C/A:C" }], affected: [{ package: { name: "leftpad" }, ranges: [{ events: [{ fixed: "2.0.0" }] }] }], references: [{ type: "ADVISORY", url: "https://example.test/GHSA-v2" }] }));
    };
    const { findings, run } = await scanOsv(memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) }), fetchImpl);
    expect(run.status).toBe("ran");
    expect(findings[0]?.severity).toBe("high");
    expect(findings[0]?.evidence.facts?.advisory).toBe("GHSA-v2");
    expect(findings[0]?.evidence.facts?.package).toBe("leftpad");
    expect(findings[0]?.evidence.facts?.severityUncertain).toBe(false);
  });
  it("does not treat a querybatch timeout as a completed scan with zero vulnerabilities", async () => {
    const repo = memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) });
    const { findings, run } = await scanOsv(repo, async () => { throw new Error("timeout"); });
    expect(run.status).toBe("failed");
    expect(run.reason).toMatch(/timeout/);
    expect(findings).toHaveLength(0);
  });
  it("marks a malformed querybatch body as a failed scan and returns no findings", async () => {
    const repo = memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) });
    const { findings, run } = await scanOsv(repo, async () => new Response("not-json", { status: 200 }));
    expect(run.status).toBe("failed");
    expect(findings).toHaveLength(0);
  });
  it("does not treat a short querybatch result list as zero vulnerabilities", async () => {
    const repo = memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) });
    const { findings, run } = await scanOsv(repo, async () => new Response(JSON.stringify({ results: [] }), { status: 200 }));
    expect(run.status).toBe("failed");
    expect(findings).toHaveLength(0);
  });
  it("keeps a critical CVSS v3 rating when a higher CVSS v2 score is also present", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).endsWith("/querybatch")) return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-both" }] }] }));
      return new Response(JSON.stringify({ id: "GHSA-both", summary: "RCE", severity: [{ type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:C/I:C/A:C" }, { type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H" }] }));
    };
    const { findings, run } = await scanOsv(memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) }), fetchImpl);
    expect(run.status).toBe("ran");
    expect(findings[0]?.severity).toBe("critical");
  });
  it("keeps advisories from a completed batch when a later batch times out", async () => {
    const packages: Record<string, { version: string }> = {};
    for (let i = 0; i < 1001; i++) packages[`node_modules/pkg${i}`] = { version: "1.0.0" };
    let calls = 0;
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).endsWith("/querybatch")) {
        calls += 1;
        if (calls === 1) return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-keep" }] }, ...Array.from({ length: 999 }, () => ({}))] }));
        throw new Error("timeout");
      }
      return new Response(JSON.stringify({ id: "GHSA-keep", summary: "Kept", database_specific: { severity: "CRITICAL" }, affected: [{ package: { name: "pkg0" }, ranges: [{ events: [{ fixed: "2.0.0" }] }] }] }));
    };
    const { findings, run } = await scanOsv(memoryIndex({ "package-lock.json": JSON.stringify({ packages }) }), fetchImpl);
    expect(run.status).toBe("partial");
    expect(findings.some((f) => f.evidence.facts?.advisory === "GHSA-keep")).toBe(true);
    expect(run.reason).toMatch(/timeout/);
  });
  it("marks a failed advisory lookup as partial", async () => {
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).endsWith("/querybatch")) return new Response(JSON.stringify({ results: [{ vulns: [{ id: "GHSA-down" }] }] }));
      return new Response("nope", { status: 500 });
    };
    const { run } = await scanOsv(memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) }), fetchImpl);
    expect(run.status).toBe("partial");
    expect(run.reason).toMatch(/lookup/);
  });
  it("marks a malformed lockfile as partial rather than a successful or skipped scan", async () => {
    const { run } = await scanOsv(memoryIndex({ "package-lock.json": "{not json" }), async () => new Response("{}"));
    expect(run.status).toBe("partial");
    expect(run.reason).toMatch(/parse/i);
    expect(run.inspectedFiles).toEqual([]);
  });
  it("marks advisory expansion past the lookup cap as partial", async () => {
    const ids = Array.from({ length: 151 }, (_, i) => ({ id: `GHSA-${i}` }));
    const fetchImpl: FetchLike = async (url) => {
      if (String(url).endsWith("/querybatch")) return new Response(JSON.stringify({ results: [{ vulns: ids }] }));
      return new Response(JSON.stringify({ id: "x", summary: "n", database_specific: { severity: "LOW" } }));
    };
    const { run } = await scanOsv(memoryIndex({ "package-lock.json": JSON.stringify({ packages: { "node_modules/leftpad": { version: "1.0.0" } } }) }), fetchImpl);
    expect(run.status).toBe("partial");
    expect(run.reason).toMatch(/not expanded/);
  });
});
