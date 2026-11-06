import { mkdtemp, readdir, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import * as tar from "tar";
import { afterAll, describe, expect, it } from "vitest";
import { LIMITS } from "@/lib/config/plans";
import { extractTarball, IngestLimitError, safeEntryPath } from "@/lib/analysis/ingest";

const cleanups: string[] = [];
afterAll(async () => Promise.all(cleanups.map((d) => rm(d, { recursive: true, force: true }))));

async function makeTarball(files: Record<string, string>, opts: { symlink?: [string, string] } = {}): Promise<string> {
  const src = await mkdtemp(path.join(tmpdir(), "src-"));
  cleanups.push(src);
  const top = path.join(src, "owner-repo-abc123");
  for (const [p, c] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(top, p)), { recursive: true });
    await writeFile(path.join(top, p), c);
  }
  const out = path.join(src, "repo.tgz");
  await tar.create({ gzip: true, file: out, cwd: src, portable: true }, ["owner-repo-abc123"]);
  if (opts.symlink) {
    const [name, target] = opts.symlink;
    const raw = gunzipSync(await readFile(out));
    let end = raw.length;
    while (end >= 512 && raw.subarray(end - 512, end).every((byte) => byte === 0)) end -= 512;
    const header = new tar.Header({
      path: `owner-repo-abc123/${name}`,
      linkpath: target,
      type: "SymbolicLink",
      mode: 0o777,
      size: 0,
      uid: 0,
      gid: 0,
      mtime: new Date(0),
    });
    if (header.encode() || !header.block) throw new Error("could not encode symlink tar header");
    await writeFile(out, gzipSync(Buffer.concat([raw.subarray(0, end), header.block, Buffer.alloc(1024)])));
  }
  return out;
}

async function listAll(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listAll(abs, base)));
    else out.push(path.relative(base, abs).split(path.sep).join("/") + (e.isSymbolicLink() ? "@" : ""));
  }
  return out.sort();
}

describe("safeEntryPath", () => {
  it("strips the top-level dir and rejects traversal", () => {
    expect(safeEntryPath("owner-repo-sha/src/a.ts")).toBe("src/a.ts");
    expect(safeEntryPath("owner-repo-sha/../../etc/passwd")).toBeNull();
    expect(safeEntryPath("owner-repo-sha/")).toBeNull();
  });
});

describe("extractTarball", () => {
  it("extracts source, skips deps, binaries and symlinks", async () => {
    const tgz = await makeTarball(
      { "src/index.ts": "export {}", "node_modules/evil/index.js": "x", "logo.png": "png", "dist/app.min.js": "x", "README.md": "# hi" },
      { symlink: ["link-to-etc", "/etc/passwd"] },
    );
    const ws = await extractTarball(createReadStream(tgz), LIMITS.full_audit);
    cleanups.push(ws.dir);
    expect(await listAll(ws.dir)).toEqual(["README.md", "src/index.ts"]);
    expect(ws.stats.skipped.link).toBe(1);
    expect(ws.stats.skipped.ignored_directory).toBe(2);
    expect(await readFile(path.join(ws.dir, "src/index.ts"), "utf8")).toBe("export {}");
    await ws.cleanup();
  });

  it("enforces the file-count limit and marks the result truncated", async () => {
    const files = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i}.ts`, "x"]));
    const ws = await extractTarball(createReadStream(await makeTarball(files)), { ...LIMITS.free_scan, maxFiles: 5 });
    cleanups.push(ws.dir);
    expect((await listAll(ws.dir)).length).toBe(5);
    expect(ws.stats.truncated).toBe(true);
  });

  it("aborts when the archive exceeds the tarball limit", async () => {
    const big = (await import("node:crypto")).randomBytes(200_000).toString("base64");
    const tgz = await makeTarball({ "a.txt": big });
    await expect(extractTarball(createReadStream(tgz), { ...LIMITS.free_scan, maxTarballBytes: 1000 })).rejects.toBeInstanceOf(IngestLimitError);
  });
});
