import { parse as parseYaml } from "yaml";
import type { RepoIndex } from "../files";
import type { RawFinding, ScannerRun, Severity } from "../types";

export interface Pkg {
  ecosystem: "npm" | "PyPI";
  name: string;
  version: string;
  lockfile: string;
}

// ───────────────────────── Lockfile parsers ─────────────────────────

export function parsePackageLock(text: string, lockfile: string): Pkg[] {
  const json = JSON.parse(text) as {
    packages?: Record<string, { version?: string; link?: boolean }>;
    dependencies?: Record<string, { version?: string }>;
  };
  const out: Pkg[] = [];
  if (json.packages) {
    for (const [key, v] of Object.entries(json.packages)) {
      if (!key || v.link || !v.version) continue;
      const idx = key.lastIndexOf("node_modules/");
      if (idx === -1) continue;
      out.push({ ecosystem: "npm", name: key.slice(idx + "node_modules/".length), version: v.version, lockfile });
    }
  } else if (json.dependencies) {
    for (const [name, v] of Object.entries(json.dependencies)) if (v.version) out.push({ ecosystem: "npm", name, version: v.version, lockfile });
  }
  return out;
}

export function parsePnpmLock(text: string, lockfile: string): Pkg[] {
  const doc = parseYaml(text) as { packages?: Record<string, unknown> } | null;
  const out: Pkg[] = [];
  for (const key of Object.keys(doc?.packages ?? {})) {
    // v9: "name@1.2.3" or "@scope/name@1.2.3(peer@x)"; v6: "/name@1.2.3" or "/name/1.2.3"
    const k = key.replace(/^\//, "").replace(/\(.*$/, "");
    const at = k.lastIndexOf("@");
    if (at > 0) {
      out.push({ ecosystem: "npm", name: k.slice(0, at), version: k.slice(at + 1), lockfile });
    } else {
      const slash = k.lastIndexOf("/");
      if (slash > 0) out.push({ ecosystem: "npm", name: k.slice(0, slash), version: k.slice(slash + 1), lockfile });
    }
  }
  return out;
}

export function parseYarnLock(text: string, lockfile: string): Pkg[] {
  const out: Pkg[] = [];
  const blocks = text.split(/\n(?=\S)/);
  for (const block of blocks) {
    const header = block.split("\n")[0] ?? "";
    if (header.startsWith("#") || header.startsWith("__metadata")) continue;
    const first = header.replace(/^"/, "").split(",")[0]?.trim().replace(/"$/, "").replace(/:$/, "") ?? "";
    const at = first.lastIndexOf("@");
    if (at <= 0) continue;
    const name = first.slice(0, at).replace(/^"/, "");
    const version = /\n\s+version:?\s+"?([^"\n]+)"?/.exec(block)?.[1];
    if (name && version) out.push({ ecosystem: "npm", name: name.replace(/@npm:.*$/, ""), version: version.trim(), lockfile });
  }
  return out;
}

export function parseRequirements(text: string, lockfile: string): Pkg[] {
  const out: Pkg[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.split("#")[0]?.trim() ?? "";
    const m = /^([A-Za-z0-9_.\-[\]]+)\s*==\s*([A-Za-z0-9_.\-+!]+)/.exec(line);
    if (m?.[1] && m[2]) out.push({ ecosystem: "PyPI", name: m[1].replace(/\[.*\]$/, ""), version: m[2], lockfile });
  }
  return out;
}

export async function collectPackages(repo: RepoIndex): Promise<{ pkgs: Pkg[]; lockfiles: string[]; errors: string[] }> {
  const pkgs: Pkg[] = [];
  const lockfiles: string[] = [];
  const errors: string[] = [];
  const parsers: [RegExp, (t: string, l: string) => Pkg[]][] = [
    [/(^|\/)package-lock\.json$/, parsePackageLock],
    [/(^|\/)npm-shrinkwrap\.json$/, parsePackageLock],
    [/(^|\/)pnpm-lock\.yaml$/, parsePnpmLock],
    [/(^|\/)yarn\.lock$/, parseYarnLock],
    [/(^|\/)requirements(-[a-z]+)?\.txt$/, parseRequirements],
  ];
  for (const [re, parse] of parsers) {
    for (const f of repo.match(re)) {
      try {
        pkgs.push(...parse(await repo.read(f.path), f.path));
        lockfiles.push(f.path);
      } catch (e) {
        errors.push(`${f.path}: ${(e as Error).message}`);
      }
    }
  }
  const seen = new Set<string>();
  const unique = pkgs.filter((p) => {
    const k = `${p.ecosystem}:${p.name}@${p.version}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { pkgs: unique, lockfiles, errors };
}

// ───────────────────────── OSV client ─────────────────────────

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: { type: string; score: string }[];
  database_specific?: { severity?: string };
  affected?: { package?: { name?: string; ecosystem?: string }; ranges?: { events?: Record<string, string>[] }[] }[];
  references?: { type: string; url: string }[];
}

export function osvSeverity(v: OsvVuln): Severity {
  const label = v.database_specific?.severity?.toUpperCase();
  if (label === "CRITICAL") return "critical";
  if (label === "HIGH") return "high";
  if (label === "MODERATE" || label === "MEDIUM") return "medium";
  if (label === "LOW") return "low";
  return "medium";
}

export function fixedVersion(v: OsvVuln, name: string): string | null {
  for (const a of v.affected ?? []) {
    if (a.package?.name !== name) continue;
    for (const r of a.ranges ?? []) for (const e of r.events ?? []) if (e.fixed) return e.fixed;
  }
  return null;
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const OSV = "https://api.osv.dev/v1";
const MAX_DETAIL_LOOKUPS = 150;

export async function scanOsv(repo: RepoIndex, fetchImpl: FetchLike = fetch): Promise<{ findings: RawFinding[]; run: ScannerRun; packagesChecked: number }> {
  const started = Date.now();
  const { pkgs, lockfiles, errors } = await collectPackages(repo);
  if (lockfiles.length === 0) {
    return { findings: [], packagesChecked: 0, run: { name: "osv", status: "skipped", reason: "No supported lockfile found (package-lock.json, pnpm-lock.yaml, yarn.lock, pinned requirements.txt)." } };
  }

  const hits = new Map<string, Pkg[]>(); // vuln id -> affected packages
  for (let i = 0; i < pkgs.length; i += 1000) {
    const batch = pkgs.slice(i, i + 1000);
    const res = await fetchImpl(`${OSV}/querybatch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: batch.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
    });
    if (!res.ok) throw new Error(`OSV querybatch failed with HTTP ${res.status}`);
    const json = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    json.results.forEach((r, idx) => {
      const pkg = batch[idx];
      if (!pkg) return;
      for (const v of r.vulns ?? []) hits.set(v.id, [...(hits.get(v.id) ?? []), pkg]);
    });
  }

  const findings: RawFinding[] = [];
  const ids = [...hits.keys()].slice(0, MAX_DETAIL_LOOKUPS);
  for (const id of ids) {
    const res = await fetchImpl(`${OSV}/vulns/${encodeURIComponent(id)}`);
    if (!res.ok) continue;
    const v = (await res.json()) as OsvVuln;
    for (const pkg of hits.get(id) ?? []) {
      const fixed = fixedVersion(v, pkg.name);
      const severity = osvSeverity(v);
      const advisory = v.references?.find((r) => r.type === "ADVISORY")?.url ?? `https://osv.dev/vulnerability/${id}`;
      findings.push({
        ruleId: `osv.${id}`,
        source: "osv",
        category: "security",
        severity,
        tier: "verified",
        confidence: "high",
        title: `${pkg.name}@${pkg.version} has a known vulnerability (${v.aliases?.find((a) => a.startsWith("CVE-")) ?? id})`,
        description: v.summary ?? v.details?.slice(0, 400) ?? "Known vulnerability in a locked dependency version.",
        remediation: fixed
          ? `Upgrade ${pkg.name} to ${fixed} or later and regenerate the lockfile. If it is a transitive dependency, upgrade the parent package or add an override/resolution.`
          : `No fixed version is published yet. Check whether your code reaches the vulnerable functionality, and consider replacing ${pkg.name}.`,
        filePath: pkg.lockfile,
        evidence: {
          method: "Exact package version from the lockfile matched an OSV.dev advisory.",
          facts: { advisory: id, aliases: v.aliases ?? [], package: pkg.name, installed: pkg.version, fixed: fixed ?? "none", reference: advisory },
        },
        fingerprintKey: `${pkg.lockfile}|${pkg.name}|${id}`,
      });
    }
  }

  const notes = [errors.length ? `Lockfile parse errors: ${errors.join("; ")}` : null, hits.size > MAX_DETAIL_LOOKUPS ? `${hits.size - MAX_DETAIL_LOOKUPS} additional advisories not expanded.` : null].filter(Boolean);
  return {
    findings,
    packagesChecked: pkgs.length,
    run: { name: "osv", status: "ran", filesScanned: lockfiles.length, durationMs: Date.now() - started, ...(notes.length ? { reason: notes.join(" ") } : {}) },
  };
}
