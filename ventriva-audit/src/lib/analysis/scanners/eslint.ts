import { Linter } from "eslint";
import tsParser from "@typescript-eslint/parser";
import security from "eslint-plugin-security";
import type { RepoIndex } from "../files";
import { excerpt } from "../files";
import { redact } from "../redact";
import type { Category, RawFinding, ScannerRun, Severity } from "../types";

/**
 * ESLint is run through the in-memory `Linter` API with OUR config only.
 * The customer's eslint.config.js / .eslintrc are never loaded, because loading
 * them would execute repository code.
 */

interface RuleMeta {
  category: Category;
  severity: Severity;
  title: string;
  remediation: string;
}

export const ESLINT_RULES: Record<string, RuleMeta> = {
  "security/detect-child-process": { category: "security", severity: "medium", title: "Child process spawned from application code", remediation: "Avoid spawning processes from request handlers. If required, use execFile/spawn with fixed binaries and argument arrays, never a shell string." },
  "security/detect-eval-with-expression": { category: "security", severity: "high", title: "eval() called with a dynamic expression", remediation: "Remove eval; use JSON.parse or explicit logic." },
  "security/detect-non-literal-require": { category: "security", severity: "medium", title: "require() with a dynamic path", remediation: "Use static imports or an allowlist map of modules." },
  "security/detect-non-literal-regexp": { category: "security", severity: "low", title: "RegExp built from a dynamic value", remediation: "Escape user input before building a RegExp, or avoid dynamic patterns (ReDoS risk)." },
  "security/detect-unsafe-regex": { category: "security", severity: "medium", title: "Regular expression vulnerable to catastrophic backtracking (ReDoS)", remediation: "Rewrite the pattern to avoid nested quantifiers, or use a linear-time engine (re2)." },
  "security/detect-possible-timing-attacks": { category: "security", severity: "medium", title: "Secret compared with a non-constant-time comparison", remediation: "Use crypto.timingSafeEqual on equal-length buffers when comparing secrets, tokens or signatures." },
  "security/detect-pseudoRandomBytes": { category: "security", severity: "medium", title: "crypto.pseudoRandomBytes is not cryptographically secure", remediation: "Use crypto.randomBytes." },
  "security/detect-buffer-noassert": { category: "security", severity: "medium", title: "Buffer read/write with noAssert", remediation: "Remove the noAssert flag." },
  "security/detect-new-buffer": { category: "security", severity: "low", title: "Deprecated new Buffer() constructor", remediation: "Use Buffer.from / Buffer.alloc." },
  "security/detect-bidi-characters": { category: "security", severity: "high", title: "Bidirectional control characters in source (Trojan Source)", remediation: "Remove the invisible bidi control characters and review the surrounding code." },
  "no-implied-eval": { category: "security", severity: "high", title: "String passed to setTimeout/setInterval is evaluated as code", remediation: "Pass a function instead of a string." },
  "no-new-func": { category: "security", severity: "high", title: "new Function() executes dynamic code", remediation: "Remove new Function; use explicit logic." },
  complexity: { category: "maintainability", severity: "low", title: "Function is highly complex", remediation: "Split this function into smaller, single-purpose functions and add tests around the extracted pieces." },
};

const MAX_MAINTAINABILITY_FINDINGS = 25;

function config(isTs: boolean): Linter.Config[] {
  const rules: Linter.RulesRecord = {};
  for (const id of Object.keys(ESLINT_RULES)) rules[id] = id === "complexity" ? ["warn", { max: 20 }] : "warn";
  return [
    {
      files: ["**/*"],
      plugins: { security: security as unknown as NonNullable<Linter.Config["plugins"]>[string] },
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ...(isTs ? { parser: tsParser as unknown as Linter.Parser } : {}),
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
      linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "off" },
      rules,
    },
  ];
}

export async function scanEslint(repo: RepoIndex): Promise<{ findings: RawFinding[]; run: ScannerRun }> {
  const started = Date.now();
  const linter = new Linter({ configType: "flat" });
  const tsConfig = config(true);
  const jsConfig = config(false);
  const findings: RawFinding[] = [];
  let scanned = 0;
  let parseFailures = 0;
  let maintainability = 0;

  const targets = repo.sourceFiles.filter((f) => f.language === "TypeScript" || f.language === "JavaScript");
  for (const f of targets) {
    const text = await repo.read(f.path);
    const isTs = f.language === "TypeScript";
    let messages: Linter.LintMessage[];
    try {
      messages = linter.verify(text, isTs ? tsConfig : jsConfig, { filename: f.path.endsWith("x") ? "file.tsx" : isTs ? "file.ts" : "file.jsx" });
    } catch {
      parseFailures++;
      continue;
    }
    scanned++;
    if (messages.some((m) => m.fatal)) {
      parseFailures++;
      continue;
    }
    for (const m of messages) {
      if (!m.ruleId) continue;
      const meta = ESLINT_RULES[m.ruleId];
      if (!meta) continue;
      if (meta.category === "maintainability") {
        if (maintainability >= MAX_MAINTAINABILITY_FINDINGS) continue;
        maintainability++;
      }
      const end = m.endLine ?? m.line;
      findings.push({
        ruleId: `eslint.${m.ruleId}`,
        source: "eslint",
        category: meta.category,
        severity: meta.severity,
        tier: "suspected",
        confidence: meta.category === "maintainability" ? "high" : "low",
        title: meta.title,
        description: m.message,
        remediation: meta.remediation,
        filePath: f.path,
        startLine: m.line,
        endLine: end,
        snippet: redact(excerpt(text, m.line, Math.min(end, m.line + 6), 1)),
        evidence: { method: `ESLint rule ${m.ruleId} (in-memory linter, repository config ignored, code never executed).` },
      });
    }
  }
  return {
    findings,
    run: {
      name: "eslint",
      status: targets.length === 0 ? "skipped" : "ran",
      filesScanned: scanned,
      durationMs: Date.now() - started,
      ...(targets.length === 0 ? { reason: "No JavaScript/TypeScript files." } : parseFailures ? { reason: `${parseFailures} file(s) could not be parsed and were not linted.` } : {}),
    },
  };
}
