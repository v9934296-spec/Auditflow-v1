import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { assertMaintenanceConnection, createIsolatedDatabaseName, resolveDisposableDatabase, type DisposableDatabase } from "./helpers/disposable-db";

const USER = "33333333-3333-4333-8333-333333333333";
const AUDIT = "44444444-4444-4444-8444-444444444444";

describe("complete_audit (postgres)", () => {
  let pool: pg.Pool;
  let target: DisposableDatabase;

  beforeAll(async () => {
    target = resolveDisposableDatabase({
      AUDITFLOW_TEST_ADMIN_URL: process.env["AUDITFLOW_TEST_ADMIN_URL"],
      AUDITFLOW_TEST_DATABASE_URL: process.env["AUDITFLOW_TEST_DATABASE_URL"],
    }, createIsolatedDatabaseName());
    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ db: string }>("select current_database() as db");
      assertMaintenanceConnection(rows[0]!.db, target);
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [target.databaseName]);
      await admin.query(`drop database if exists ${target.databaseName}`);
      await admin.query(`create database ${target.databaseName}`);
    } finally {
      await admin.end();
    }

    const setup = new pg.Client({ connectionString: target.databaseUrl });
    await setup.connect();
    try {
      const { rows } = await setup.query<{ db: string }>("select current_database() as db");
      if (rows[0]!.db !== target.databaseName) throw new Error("opened an unexpected database");
      await setup.query(`
        create schema if not exists auth;
        create table auth.users (id uuid primary key, email text);
        create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
        do $$ begin
          create role anon nologin;
          create role authenticated nologin;
          create role service_role nologin bypassrls;
        exception when duplicate_object then null;
        end $$;
      `);
      const migrations = ["0001_init.sql", "0002_rate_limits.sql", "0003_finding_not_retested.sql",
        "0004_scan_recovery.sql", "0005_audit_checkout_fulfillment.sql", "0006_atomic_audit_completion.sql"];
      for (const file of migrations) {
        await setup.query(readFileSync(path.join(process.cwd(), "supabase", "migrations", file), "utf8"));
      }
      await setup.query("insert into auth.users (id, email) values ($1, 'audit@example.com')", [USER]);
      await setup.query("insert into public.github_installations (id, user_id, account_login, account_type) values (1, $1, 'audit-org', 'Organization')", [USER]);
      const { rows: repositories } = await setup.query<{ id: string }>(`
        insert into public.repositories (user_id, installation_id, github_repo_id, full_name, default_branch, is_private)
        values ($1, 1, 10, 'audit-org/test', 'main', false) returning id
      `, [USER]);
      await setup.query(`
        insert into public.audits (id, user_id, repository_id, kind, status)
        values ($1, $2, $3, 'full_audit', 'running')
      `, [AUDIT, USER, repositories[0]!.id]);
    } finally {
      await setup.end();
    }
    pool = new pg.Pool({ connectionString: target.databaseUrl });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (!target) return;
    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    try {
      const { rows } = await admin.query<{ db: string }>("select current_database() as db");
      assertMaintenanceConnection(rows[0]!.db, target);
      await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()", [target.databaseName]);
      await admin.query(`drop database if exists ${target.databaseName}`);
    } finally {
      await admin.end();
    }
  });

  const finding = {
    fingerprint: "fingerprint-1", rule_id: "security.one", source: "semgrep", category: "security",
    severity: "high", priority: "P1", evidence_tier: "verified", confidence: "high",
    title: "A security issue", description: "Needs fixing", remediation: "Fix the issue",
    evidence: { method: "scanner" }, change: "new",
  };
  const base = {
    sha: "0123456789abcdef", rubricVersion: "2026.11-v2", overall: 70,
    verdict: "launch_with_fixes", categoryScores: { counts: { P1: 1 } },
    coverage: { sourceCoverage: 1 }, summary: "One issue",
    aiCostUsd: 0, inputTokens: 0, outputTokens: 0,
    findings: [finding],
    tickets: [{ fingerprint: finding.fingerprint, priority: "P1", title: "Fix issue", body_markdown: "Repair it" }],
    usage: [], alerts: [],
  };

  async function complete(payload: Record<string, unknown>): Promise<boolean> {
    const { rows } = await pool.query<{ done: boolean }>(
      "select public.complete_audit($1::uuid, $2::jsonb) as done",
      [AUDIT, JSON.stringify(payload)],
    );
    return rows[0]!.done;
  }

  async function count(table: "findings" | "tickets" | "usage_ledger" | "alerts"): Promise<number> {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from public.${table} where audit_id = $1`, [AUDIT],
    );
    return rows[0]!.n;
  }

  it("rolls back every table and status when ticket references a missing finding", async () => {
    await expect(complete({
      ...base, tickets: [{ ...base.tickets[0], fingerprint: "missing" }],
    })).rejects.toThrow(/AUDIT_TICKET_FINDING_MISSING/);
    expect(await count("findings")).toBe(0);
    expect(await count("tickets")).toBe(0);
    expect(await count("usage_ledger")).toBe(0);
    const { rows } = await pool.query("select status, completed_at from public.audits where id = $1", [AUDIT]);
    expect(rows[0].status).toBe("running");
    expect(rows[0].completed_at).toBeNull();
  });

  it("commits findings, ticket, usage, alert and completed audit atomically", async () => {
    expect(await complete({
      ...base,
      usage: [{ provider: "anthropic", model: "model", input_tokens: 10, output_tokens: 5, cost_usd: 0.01 }],
      alerts: [{ severity: "high", message: "P1: An issue" }],
    })).toBe(true);
    expect(await count("findings")).toBe(1);
    expect(await count("tickets")).toBe(1);
    expect(await count("usage_ledger")).toBe(1);
    expect(await count("alerts")).toBe(1);
    const { rows } = await pool.query("select status, rubric_version, overall_score, completed_at from public.audits where id = $1", [AUDIT]);
    expect(rows[0].status).toBe("completed");
    expect(rows[0].rubric_version).toBe("2026.11-v2");
    expect(rows[0].overall_score).toBe(70);
    expect(rows[0].completed_at).not.toBeNull();
  });

  it("ignores replayed completion without duplicate results", async () => {
    expect(await complete(base)).toBe(false);
    expect(await count("findings")).toBe(1);
    expect(await count("tickets")).toBe(1);
    expect(await count("usage_ledger")).toBe(1);
  });
});
