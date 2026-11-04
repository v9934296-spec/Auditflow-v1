import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import type { ProcessingLimits } from "@/lib/config/plans";

/** Directories that are never analyzed (dependencies, build output, VCS). */
export const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".nuxt",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  ".expo",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "Pods",
  ".gradle",
  "DerivedData",
]);

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svgz", ".bmp", ".tiff", ".avif",
  ".mp4", ".mov", ".webm", ".mp3", ".wav", ".ogg", ".m4a",
  ".woff", ".woff2", ".ttf", ".otf", ".eot",
  ".zip", ".gz", ".tgz", ".rar", ".7z", ".jar", ".war",
  ".pdf", ".psd", ".ai", ".sketch", ".fig",
  ".exe", ".dll", ".so", ".dylib", ".bin", ".wasm", ".class", ".o", ".a",
  ".sqlite", ".db", ".pyc",
]);

export class IngestLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IngestLimitError";
  }
}

export interface IngestStats {
  filesExtracted: number;
  bytesExtracted: number;
  skipped: Record<string, number>;
  truncated: boolean;
}

export interface Workspace {
  dir: string;
  stats: IngestStats;
  cleanup: () => Promise<void>;
}

/** Limits the number of bytes flowing through a stream; throws when exceeded. */
function byteLimiter(maxBytes: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > maxBytes) {
        cb(new IngestLimitError(`Repository archive exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit for this audit tier.`));
        return;
      }
      cb(null, chunk);
    },
  });
}

/**
 * Returns the safe relative path for a tar entry, or null if it must be skipped.
 * GitHub tarballs prefix every entry with "<owner>-<repo>-<sha>/"; that segment is stripped.
 */
export function safeEntryPath(entryPath: string): string | null {
  const normalized = entryPath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter((p) => p.length > 0);
  parts.shift(); // strip GitHub's top-level directory
  if (parts.length === 0) return null;
  if (parts.some((p) => p === ".." || p === ".")) return null;
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) return null;
  return parts.join("/");
}

export function skipReason(relPath: string, size: number, limits: ProcessingLimits): string | null {
  const parts = relPath.split("/");
  if (parts.slice(0, -1).some((p) => IGNORED_DIRS.has(p))) return "ignored_directory";
  const ext = path.extname(relPath).toLowerCase();
  if (BINARY_EXT.has(ext)) return "binary";
  if (/\.min\.(js|css)$/.test(relPath) || relPath.endsWith(".map")) return "minified_or_sourcemap";
  if (size > limits.maxFileBytes) return "file_too_large";
  return null;
}

/**
 * Streams a GitHub tarball into an isolated temp directory with strict limits.
 * - Never follows or creates symlinks / hardlinks / devices.
 * - Rejects path traversal.
 * - Caps archive size, file count, per-file size and total extracted bytes.
 * Nothing extracted here is ever executed.
 */
export async function extractTarball(body: ReadableStream<Uint8Array> | NodeJS.ReadableStream, limits: ProcessingLimits): Promise<Workspace> {
  const dir = await mkdtemp(path.join(tmpdir(), "audit-"));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  const stats: IngestStats = { filesExtracted: 0, bytesExtracted: 0, skipped: {}, truncated: false };
  const bump = (reason: string) => {
    stats.skipped[reason] = (stats.skipped[reason] ?? 0) + 1;
  };

  const source: NodeJS.ReadableStream =
    "getReader" in body ? Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>) : body;

  const writes: Promise<void>[] = [];
  const parser = new tar.Parser({
    strict: false,
    onReadEntry: (entry) => {
      const rel = safeEntryPath(entry.path);
      if (entry.type !== "File" || rel === null) {
        if (entry.type === "SymbolicLink" || entry.type === "Link") bump("link");
        entry.resume();
        return;
      }
      const size = entry.size ?? 0;
      const reason = skipReason(rel, size, limits);
      if (reason) {
        bump(reason);
        entry.resume();
        return;
      }
      if (stats.filesExtracted >= limits.maxFiles || stats.bytesExtracted + size > limits.maxExtractedBytes) {
        stats.truncated = true;
        bump("limit_reached");
        entry.resume();
        return;
      }
      stats.filesExtracted += 1;
      stats.bytesExtracted += size;
      const dest = path.join(dir, rel);
      if (!dest.startsWith(dir + path.sep)) {
        bump("path_escape");
        entry.resume();
        return;
      }
      writes.push(
        (async () => {
          await mkdir(path.dirname(dest), { recursive: true });
          await pipeline(entry as unknown as NodeJS.ReadableStream, createWriteStream(dest, { flags: "wx", mode: 0o600 }));
        })(),
      );
    },
  });

  try {
    await pipeline(source, byteLimiter(limits.maxTarballBytes), parser);
    await Promise.all(writes);
  } catch (err) {
    await Promise.allSettled(writes);
    await cleanup();
    throw err;
  }
  return { dir, stats, cleanup };
}

export async function fileSize(p: string): Promise<number> {
  return (await stat(p)).size;
}
