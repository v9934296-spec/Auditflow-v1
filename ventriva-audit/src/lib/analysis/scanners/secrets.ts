import path from "node:path";
import type { RepoIndex } from "../files";
import { excerpt, lineOf } from "../files";
import { JWT_RE, SECRET_PATTERNS, jwtRole, redact } from "../redact";
import type { RawFinding, ScannerRun } from "../types";

const ENV_FILE_RE = /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/;
const ENV_TEMPLATE_RE = /(^|\/)\.env\.(example|sample|template|defaults?)$/i;
const TEST_PATH_RE = /(^|\/)(tests?|__tests__|fixtures?|__mocks__|e2e|spec)\/|\.(test|spec)\.[a-z]+$/i;
const DOWNGRADE = { critical: "high", high: "medium", medium: "low" } as const;

const TEXT_LIKE = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml|toml|env|py|rb|go|rs|java|kt|swift|php|cs|sql|sh|md|txt|ini|cfg|conf|properties|xml|html|vue|svelte|dart)$/i;

/** Placeholder values that are clearly not real credentials. */
function looksLikePlaceholder(v: string): boolean {
  return /(x{6,}|your[_-]|example|placeholder|changeme|dummy|<.*>|\.\.\.|0{10,})/i.test(v);
}

export async function scanSecrets(repo: RepoIndex): Promise<{ findings: RawFinding[]; run: ScannerRun }> {
  const started = Date.now();
  const findings: RawFinding[] = [];
  let scanned = 0;

  for (const f of repo.files) {
    const base = path.basename(f.path);
    if (ENV_FILE_RE.test(f.path) && !ENV_TEMPLATE_RE.test(f.path)) {
      findings.push({
        ruleId: "secrets.env-file-committed",
        source: "secrets",
        category: "security",
        severity: "critical",
        tier: "verified",
        confidence: "high",
        title: `Environment file committed to the repository: ${f.path}`,
        description:
          "A real environment file is tracked in git. Anyone with read access to the repository (and its full history) can read every value in it.",
        remediation:
          "Remove the file from git (`git rm --cached`), add it to .gitignore, rotate every credential it contained, and provide a `.env.example` with placeholder values instead. Rewriting history alone is not enough — rotate the keys.",
        filePath: f.path,
        evidence: { method: "File path matched an environment-file pattern and is not a template (.env.example/.sample).", facts: { file: base } },
        fingerprintKey: f.path,
      });
    }
    if (!TEXT_LIKE.test(f.path) && !ENV_FILE_RE.test(f.path)) continue;
    const text = await repo.read(f.path);
    scanned++;

    for (const p of SECRET_PATTERNS) {
      const re = new RegExp(p.re.source, p.re.flags);
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (looksLikePlaceholder(m[0])) continue;
        const line = lineOf(text, m.index);
        const inTests = TEST_PATH_RE.test(f.path);
        findings.push({
          ruleId: `secrets.${p.id}`,
          source: "secrets",
          category: "security",
          severity: ENV_TEMPLATE_RE.test(f.path) && !p.live ? "low" : inTests ? DOWNGRADE[p.severity] : p.severity,
          tier: inTests ? "suspected" : "verified",
          confidence: inTests ? "low" : p.live ? "high" : "medium",
          title: `${p.label} found in ${f.path}`,
          description: `A value matching the ${p.label} format is hardcoded in source. The value has been redacted from this report.${inTests ? " It is in a test or fixture file, so it may be a fake value — confirm it is not a real credential." : ""}`,
          remediation:
            "Revoke and rotate this credential with the provider now, move it to your hosting provider's encrypted environment variables, and read it via `process.env` on the server only.",
          filePath: f.path,
          startLine: line,
          endLine: line,
          snippet: redact(excerpt(text, line, line, 1)),
          evidence: { method: `Matched the ${p.label} token format (pattern ${p.id}).` },
          fingerprintKey: `${f.path}|${p.id}|${m[0].slice(0, 6)}`,
        });
      }
    }

    const jwt = new RegExp(JWT_RE.source, JWT_RE.flags);
    let j: RegExpExecArray | null;
    while ((j = jwt.exec(text)) !== null) {
      if (jwtRole(j[0]) !== "service_role") continue;
      const line = lineOf(text, j.index);
      findings.push({
        ruleId: "secrets.supabase-service-role-key",
        source: "secrets",
        category: "security",
        severity: "critical",
        tier: "verified",
        confidence: "high",
        title: `Supabase service-role key hardcoded in ${f.path}`,
        description:
          "This JWT's payload declares role=service_role. The service-role key bypasses Row Level Security and grants full read/write access to your entire database.",
        remediation:
          "Rotate the service-role key in Supabase (Project Settings → API), store it only as a server-side environment variable, and never ship it to the browser or a mobile bundle.",
        filePath: f.path,
        startLine: line,
        endLine: line,
        snippet: redact(excerpt(text, line, line, 1)),
        evidence: { method: "Decoded the JWT payload (without verification) and found role=service_role." },
        fingerprintKey: `${f.path}|service_role`,
      });
    }
  }

  return { findings, run: { name: "secrets", status: "ran", filesScanned: scanned, durationMs: Date.now() - started } };
}
