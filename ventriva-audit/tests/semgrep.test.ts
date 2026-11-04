import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { indexRepo } from "@/lib/analysis/files";
import { scanSemgrep } from "@/lib/analysis/scanners/semgrep";

let installed = true;
try {
  execFileSync("semgrep", ["--version"], { stdio: "ignore" });
} catch {
  installed = false;
}

describe.skipIf(!installed)("semgrep (integration)", () => {
  it("runs bundled rules against a repo without executing it", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sg-"));
    await mkdir(path.join(dir, "app"), { recursive: true });
    await writeFile(path.join(dir, "app/client.tsx"), '"use client";\nconst k = process.env.SUPABASE_SERVICE_ROLE_KEY;\neval(userInput);\n');
    const { findings, run } = await scanSemgrep(await indexRepo(dir));
    await rm(dir, { recursive: true, force: true });
    expect(run.status).toBe("ran");
    const ids = findings.map((f) => f.ruleId);
    expect(ids).toContain("semgrep.supabase-service-role-in-client");
    expect(ids).toContain("semgrep.eval-usage");
    expect(findings.find((f) => f.ruleId === "semgrep.supabase-service-role-in-client")!.severity).toBe("critical");
  }, 120_000);
});
