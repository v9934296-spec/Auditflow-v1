import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/0003_finding_not_retested.sql"), "utf8");

describe("finding_change migration", () => {
  it("adds not_retested without rewriting historical findings or policies", () => {
    expect(sql.toLowerCase()).toContain("add value if not exists 'not_retested'");
    expect(sql.toLowerCase()).not.toMatch(/\b(delete|update|drop|truncate)\b/);
    expect(sql.toLowerCase()).not.toContain("create policy");
  });
});
