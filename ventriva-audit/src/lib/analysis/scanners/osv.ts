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
      lockfiles.push(f.path);
      try {
        pkgs.push(...parse(await repo.read(f.path), f.path));
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

export interface SeverityJudgment {
  severity: Severity;
  /** True when the advisory carried no severity this rubric can classify. Never silently mapped to medium. */
  uncertain: boolean;
}

const V3_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const V3_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const V3_PR: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const V3_PR_CHANGED: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };
const V3_UI: Record<string, number> = { N: 0.85, R: 0.62 };
const V3_CIA: Record<string, number> = { N: 0, L: 0.22, H: 0.56 };
const V2_AV: Record<string, number> = { L: 0.395, A: 0.646, N: 1.0 };
const V2_AC: Record<string, number> = { H: 0.35, M: 0.61, L: 0.71 };
const V2_AU: Record<string, number> = { M: 0.45, S: 0.56, N: 0.704 };
const V2_CIA: Record<string, number> = { N: 0, P: 0.275, C: 0.66 };

/** FIRST.org CVSS roundup to one decimal. */
function roundup(input: number): number {
  const intInput = Math.round(input * 100000);
  if (intInput % 10000 === 0) return intInput / 100000;
  return (Math.floor(intInput / 10000) + 1) / 10;
}

function vectorMetrics(vector: string): Record<string, string> {
  const body = vector.replace(/^CVSS:\d+(?:\.\d+)?\//i, "");
  const out: Record<string, string> = {};
  for (const part of body.split("/")) {
    const [k, v] = part.split(":");
    if (k && v) out[k] = v;
  }
  return out;
}

export function cvssV3Base(vector: string): number | null {
  const m = vectorMetrics(vector);
  const av = V3_AV[m.AV ?? ""];
  const ac = V3_AC[m.AC ?? ""];
  const ui = V3_UI[m.UI ?? ""];
  const c = V3_CIA[m.C ?? ""];
  const i = V3_CIA[m.I ?? ""];
  const a = V3_CIA[m.A ?? ""];
  const scopeChanged = m.S === "C";
  const prTable = scopeChanged ? V3_PR_CHANGED : V3_PR;
  const pr = prTable[m.PR ?? ""];
  if (av === undefined || ac === undefined || ui === undefined || pr === undefined || c === undefined || i === undefined || a === undefined) return null;
  if (m.S !== "U" && m.S !== "C") return null;
  const impact = 1 - (1 - c) * (1 - i) * (1 - a);
  const iss = scopeChanged ? 7.52 * (impact - 0.029) - 3.25 * (impact - 0.02) ** 15 : 6.42 * impact;
  const exploitability = 8.22 * av * ac * pr * ui;
  if (impact <= 0) return 0;
  const raw = scopeChanged ? Math.min(1.08 * (iss + exploitability), 10) : Math.min(iss + exploitability, 10);
  return roundup(raw);
}

export function cvssV2Base(vector: string): number | null {
  const m = vectorMetrics(vector);
  const av = V2_AV[m.AV ?? ""];
  const ac = V2_AC[m.AC ?? ""];
  const au = V2_AU[m.Au ?? ""];
  const c = V2_CIA[m.C ?? ""];
  const i = V2_CIA[m.I ?? ""];
  const a = V2_CIA[m.A ?? ""];
  if (av === undefined || ac === undefined || au === undefined || c === undefined || i === undefined || a === undefined) return null;
  const impact = 10.41 * (1 - (1 - c) * (1 - i) * (1 - a));
  const exploitability = 20 * av * ac * au;
  const f = impact === 0 ? 0 : 1.176;
  return roundup((0.6 * impact + 0.4 * exploitability - 1.5) * f);
}

function qualitative(score: number, version: 2 | 3): Severity {
  if (score <= 0) return "info";
  if (score < 4) return "low";
  if (score < 7) return "medium";
  if (version === 2 || score < 9) return "high";
  return "critical";
}

function fromCvss(type: string, score: string): { severity: Severity; rank: number; version: number } | null {
  const numeric = /^[0-9]+(?:\.[0-9]+)?$/.test(score) ? Number(score) : null;
  if (type === "CVSS_V3" || type === "CVSS_V3.0" || type === "CVSS_V3.1") {
    const value = numeric ?? cvssV3Base(score);
    return value === null ? null : { severity: qualitative(value, 3), rank: value, version: 3 };
  }
  if (type === "CVSS_V2") {
    const value = numeric ?? cvssV2Base(score);
    return value === null ? null : { severity: qualitative(value, 2), rank: value, version: 2 };
  }
  return null;
}

export function osvSeverity(v: OsvVuln): SeverityJudgment {
  const label = v.database_specific?.severity?.toUpperCase();
  if (label === "CRITICAL" || label === "HIGH" || label === "MODERATE" || label === "MEDIUM" || label === "LOW") {
    const severity: Severity = label === "CRITICAL" ? "critical" : label === "HIGH" ? "high" : label === "LOW" ? "low" : "medium";
    return { severity, uncertain: false };
  }
  let best: { severity: Severity; rank: number; version: number } | null = null;
  let sawUnsupported = false;
  for (const entry of v.severity ?? []) {
    if (!entry.type || !entry.score) {
      sawUnsupported = true;
      continue;
    }
    const parsed = fromCvss(entry.type, entry.score);
    if (!parsed) {
      sawUnsupported = true;
      continue;
    }
    if (!best || parsed.version > best.version || (parsed.version === best.version && parsed.rank > best.rank)) best = parsed;
  }
  if (best) return { severity: best.severity, uncertain: false };
  return { severity: "info", uncertain: true };
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
  if (pkgs.length === 0 && errors.length > 0) {
    const read = lockfiles.filter((f) => !errors.some((e) => e.startsWith(`${f}:`)));
    return incomplete(started, 0, lockfiles, [], [`Lockfile parse errors: ${errors.join("; ")}`], read);
  }

  const hits = new Map<string, Pkg[]>(); // vuln id -> affected packages
  let batchesCompleted = 0;
  let batchFailure: string | null = null;
  for (let i = 0; i < pkgs.length; i += 1000) {
    const batch = pkgs.slice(i, i + 1000);
    try {
      const res = await fetchImpl(`${OSV}/querybatch`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ queries: batch.map((p) => ({ package: { name: p.name, ecosystem: p.ecosystem }, version: p.version })) }),
      });
      if (!res.ok) {
        batchFailure = `OSV querybatch failed with HTTP ${res.status}`;
        break;
      }
      let json: { results?: { vulns?: { id?: string }[] }[] };
      try {
        json = (await res.json()) as { results?: { vulns?: { id?: string }[] }[] };
      } catch {
        batchFailure = "OSV querybatch response was not valid JSON.";
        break;
      }
      if (!Array.isArray(json.results) || json.results.length !== batch.length) {
        batchFailure = "OSV querybatch response did not include one result per package.";
        break;
      }
      batchesCompleted++;
      json.results.forEach((r, idx) => {
        const pkg = batch[idx];
        if (!pkg) return;
        for (const v of r.vulns ?? []) if (v.id) hits.set(v.id, [...(hits.get(v.id) ?? []), pkg]);
      });
    } catch (e) {
      batchFailure = (e as Error).message;
      break;
    }
  }
  const parsedLockfiles = errors.length ? lockfiles.filter((f) => !errors.some((e) => e.startsWith(`${f}:`))) : lockfiles;
  if (batchFailure && batchesCompleted === 0) {
    return {
      findings: [],
      packagesChecked: pkgs.length,
      run: { name: "osv", status: "failed", filesScanned: lockfiles.length, inspectedFiles: parsedLockfiles, durationMs: Date.now() - started, reason: batchFailure },
    };
  }

  const findings: RawFinding[] = [];
  const ids = [...hits.keys()];
  const expanded = ids.slice(0, MAX_DETAIL_LOOKUPS);
  let detailFailures = 0;
  let unclassified = 0;
  for (const id of expanded) {
    let res: Response;
    try {
      res = await fetchImpl(`${OSV}/vulns/${encodeURIComponent(id)}`);
    } catch {
      detailFailures++;
      continue;
    }
    if (!res.ok) {
      detailFailures++;
      continue;
    }
    let v: OsvVuln;
    try {
      v = (await res.json()) as OsvVuln;
    } catch {
      detailFailures++;
      continue;
    }
    if (!v || typeof v !== "object") {
      detailFailures++;
      continue;
    }
    for (const pkg of hits.get(id) ?? []) {
      const fixed = fixedVersion(v, pkg.name);
      const judged = osvSeverity(v);
      if (judged.uncertain) unclassified++;
      const advisory = v.references?.find((r) => r.type === "ADVISORY")?.url ?? `https://osv.dev/vulnerability/${id}`;
      findings.push({
        ruleId: `osv.${id}`,
        source: "osv",
        category: "security",
        severity: judged.severity,
        tier: judged.uncertain ? "suspected" : "verified",
        confidence: judged.uncertain ? "low" : "high",
        title: `${pkg.name}@${pkg.version} has a known vulnerability (${v.aliases?.find((a) => a.startsWith("CVE-")) ?? id})`,
        description: judged.uncertain
          ? `${v.summary ?? v.details?.slice(0, 400) ?? "Known vulnerability in a locked dependency version."} Severity was not classified from the advisory and was not recorded as medium.`
          : v.summary ?? v.details?.slice(0, 400) ?? "Known vulnerability in a locked dependency version.",
        remediation: fixed
          ? `Upgrade ${pkg.name} to ${fixed} or later and regenerate the lockfile. If it is a transitive dependency, upgrade the parent package or add an override/resolution.`
          : `No fixed version is published yet. Check whether your code reaches the vulnerable functionality, and consider replacing ${pkg.name}.`,
        filePath: pkg.lockfile,
        evidence: {
          method: "Exact package version from the lockfile matched an OSV.dev advisory.",
          facts: { advisory: id, aliases: v.aliases ?? [], package: pkg.name, installed: pkg.version, fixed: fixed ?? "none", reference: advisory, severityUncertain: judged.uncertain },
        },
        fingerprintKey: `${pkg.lockfile}|${pkg.name}|${id}`,
      });
    }
  }

  const notes = [
    errors.length ? `Lockfile parse errors: ${errors.join("; ")}` : null,
    batchFailure,
    ids.length > MAX_DETAIL_LOOKUPS ? `${ids.length - MAX_DETAIL_LOOKUPS} additional advisories were not expanded.` : null,
    detailFailures ? `${detailFailures} advisory lookup(s) failed or returned a malformed response.` : null,
    unclassified ? `${unclassified} advisory severity value(s) could not be classified.` : null,
  ].filter((n): n is string => Boolean(n));
  const partial = notes.length > 0;
  return {
    findings,
    packagesChecked: pkgs.length,
    run: {
      name: "osv",
      status: partial ? "partial" : "ran",
      filesScanned: lockfiles.length,
      inspectedFiles: errors.length ? lockfiles.filter((f) => !errors.some((e) => e.startsWith(`${f}:`))) : lockfiles,
      durationMs: Date.now() - started,
      ...(notes.length ? { reason: notes.join(" ") } : {}),
    },
  };
}

function incomplete(started: number, packagesChecked: number, lockfiles: string[], findings: RawFinding[], notes: string[], inspected: string[] = lockfiles): { findings: RawFinding[]; run: ScannerRun; packagesChecked: number } {
  return {
    findings,
    packagesChecked,
    run: { name: "osv", status: "partial", filesScanned: lockfiles.length, inspectedFiles: inspected, durationMs: Date.now() - started, reason: notes.join(" ") },
  };
}
