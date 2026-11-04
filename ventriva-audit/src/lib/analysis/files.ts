import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const LANGUAGE_BY_EXT: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".mts": "TypeScript",
  ".cts": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".rb": "Ruby",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".swift": "Swift",
  ".php": "PHP",
  ".cs": "C#",
  ".sql": "SQL",
  ".vue": "Vue",
  ".svelte": "Svelte",
  ".dart": "Dart",
};

/** Languages our code scanners (Semgrep rules + ESLint) actually inspect. */
export const SCANNED_LANGUAGES = new Set(["TypeScript", "JavaScript", "Python", "SQL"]);

export interface RepoFile {
  /** Path relative to repo root, forward slashes. */
  path: string;
  language: string | null;
  size: number;
}

export interface RepoIndex {
  root: string;
  files: RepoFile[];
  /** Lazy, cached text reader. */
  read: (relPath: string) => Promise<string>;
  has: (relPath: string) => boolean;
  /** Files whose path matches the regex. */
  match: (re: RegExp) => RepoFile[];
  sourceFiles: RepoFile[];
}

export async function indexRepo(root: string): Promise<RepoIndex> {
  const files: RepoFile[] = [];
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
      } else if (e.isFile()) {
        const rel = path.relative(root, abs).split(path.sep).join("/");
        const { size } = await stat(abs);
        files.push({ path: rel, language: LANGUAGE_BY_EXT[path.extname(e.name).toLowerCase()] ?? null, size });
      }
    }
  }
  await walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const set = new Set(files.map((f) => f.path));
  const cache = new Map<string, string>();

  return {
    root,
    files,
    sourceFiles: files.filter((f) => f.language !== null),
    has: (p) => set.has(p),
    match: (re) => files.filter((f) => re.test(f.path)),
    read: async (rel) => {
      const hit = cache.get(rel);
      if (hit !== undefined) return hit;
      if (!set.has(rel)) return "";
      const text = await readFile(path.join(root, rel), "utf8");
      cache.set(rel, text);
      return text;
    },
  };
}

/** Builds an in-memory index (used by tests and by targeted rechecks). */
export function memoryIndex(contents: Record<string, string>): RepoIndex {
  const files: RepoFile[] = Object.entries(contents)
    .map(([p, c]) => ({ path: p, language: LANGUAGE_BY_EXT[path.extname(p).toLowerCase()] ?? null, size: Buffer.byteLength(c) }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const set = new Set(files.map((f) => f.path));
  return {
    root: "<memory>",
    files,
    sourceFiles: files.filter((f) => f.language !== null),
    has: (p) => set.has(p),
    match: (re) => files.filter((f) => re.test(f.path)),
    read: async (p) => contents[p] ?? "",
  };
}

export function languageBreakdown(files: RepoFile[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of files) if (f.language) out[f.language] = (out[f.language] ?? 0) + 1;
  return out;
}

/** Returns lines [start-ctx, end+ctx] (1-indexed, inclusive) of a text. */
export function excerpt(text: string, startLine: number, endLine: number, ctx = 2): string {
  const lines = text.split("\n");
  const from = Math.max(1, startLine - ctx);
  const to = Math.min(lines.length, endLine + ctx);
  return lines
    .slice(from - 1, to)
    .map((l, i) => `${String(from + i).padStart(4, " ")} | ${l.length > 300 ? l.slice(0, 300) + "…" : l}`)
    .join("\n");
}

export function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

/** Reads every package.json outside ignored dirs (monorepo-aware). */
export async function readPackageJsons(repo: RepoIndex): Promise<{ path: string; pkg: PackageJson }[]> {
  const out: { path: string; pkg: PackageJson }[] = [];
  for (const f of repo.match(/(^|\/)package\.json$/)) {
    try {
      out.push({ path: f.path, pkg: JSON.parse(await repo.read(f.path)) as PackageJson });
    } catch {
      // malformed package.json is reported by the readiness detectors
    }
  }
  return out;
}

export function allDependencies(pkgs: { pkg: PackageJson }[]): Set<string> {
  const deps = new Set<string>();
  for (const { pkg } of pkgs) {
    for (const name of Object.keys(pkg.dependencies ?? {})) deps.add(name);
    for (const name of Object.keys(pkg.devDependencies ?? {})) deps.add(name);
  }
  return deps;
}
