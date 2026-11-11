import { createHmac, randomBytes } from "node:crypto";
import { request as httpRequest, createServer as createHttpServer, type Server } from "node:http";
import { createServer } from "node:net";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { latestBaseline } from "@/lib/audits/service";
import { assertMaintenanceConnection, createIsolatedDatabaseName, resolveDisposableDatabase, type DisposableDatabase } from "./helpers/disposable-db";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPO = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_REPO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WIN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const SAME_TIME_LOWER_ID = "00000000-0000-4000-8000-000000000001";
const EARLIER_CREATED = "99999999-9999-4999-8999-999999999999";
const JWT_SECRET = "auditflow-postgrest-test-secret-32";

function signJwt(role: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ role, iss: "auditflow-test", exp: 4_000_000_000 })).toString("base64url");
  const signature = createHmac("sha256", JWT_SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function restProxy(postgrestPort: number): Promise<{ url: string; server: Server }> {
  return new Promise((resolve, reject) => {
    const server = createHttpServer((req, incoming) => {
      const proxied = httpRequest({
        hostname: "127.0.0.1",
        port: postgrestPort,
        path: req.url?.replace(/^\/rest\/v1/, "") || "/",
        method: req.method,
        headers: { ...req.headers, host: `127.0.0.1:${postgrestPort}` },
      }, (upstream) => {
        incoming.writeHead(upstream.statusCode ?? 502, upstream.headers);
        upstream.pipe(incoming);
      });
      proxied.on("error", (error) => {
        incoming.writeHead(502);
        incoming.end(error.message);
      });
      req.pipe(proxied);
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function listenPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

describe("latest baseline through PostgREST", () => {
  let target: DisposableDatabase;
  let postgrest: ChildProcess | undefined;
  let proxy: Server | undefined;
  let logs = "";
  let api: ReturnType<typeof createClient>;
  let postgrestUrl = "";

  beforeAll(async () => {
    const bin = process.env["POSTGREST_BIN"];
    if (!bin) throw new Error("POSTGREST_BIN is required for the PostgREST baseline test");
    target = resolveDisposableDatabase({
      AUDITFLOW_TEST_ADMIN_URL: process.env["AUDITFLOW_TEST_ADMIN_URL"],
      AUDITFLOW_TEST_DATABASE_URL: process.env["AUDITFLOW_TEST_DATABASE_URL"],
    }, createIsolatedDatabaseName(process.pid, randomBytes(4).toString("hex")));

    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    const connected = await admin.query<{ db: string }>(`select current_database() as db`);
    assertMaintenanceConnection(connected.rows[0]!.db, target);
    const ident = await admin.query<{ ident: string }>(`select format('%I', $1::text) as ident`, [target.databaseName]);
    if (ident.rows[0]!.ident !== target.databaseName) throw new Error("refusing to interpolate an unexpected database identifier");
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [target.databaseName]);
    await admin.query(`drop database if exists ${target.databaseName}`);
    await admin.query(`create database ${target.databaseName}`);
    await admin.end();

    const setup = new pg.Client({ connectionString: target.databaseUrl });
    await setup.connect();
    const opened = await setup.query<{ db: string }>(`select current_database() as db`);
    if (opened.rows[0]!.db !== target.databaseName) throw new Error(`opened ${opened.rows[0]!.db} instead of ${target.databaseName}`);
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
      do $$ begin
        create role authenticator noinherit login password 'postgrest';
      exception when duplicate_object then null;
      end $$;
      grant anon, authenticated, service_role to authenticator;
    `);
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const file of ["0001_init.sql", "0002_rate_limits.sql", "0003_finding_not_retested.sql", "0004_scan_recovery.sql", "0005_audit_checkout_fulfillment.sql"]) {
      await setup.query(readFileSync(path.join(dir, file), "utf8"));
    }
    await setup.query(`
      grant usage on schema public to authenticator, anon, authenticated, service_role;
      grant select on all tables in schema public to authenticator, service_role;
    `);
    await setup.query(
      `insert into auth.users (id, email) values ($1, 'buyer@example.com')`,
      [USER],
    );
    await setup.query(
      `insert into public.github_installations (id, user_id, account_login, account_type) values (1, $1, 'acme', 'User')`,
      [USER],
    );
    await setup.query(
      `insert into public.repositories (id, user_id, installation_id, github_repo_id, full_name, default_branch, is_private)
       values ($1, $3, 1, 101, 'acme/app', 'main', false), ($2, $3, 1, 102, 'acme/other', 'main', false)`,
      [REPO, OTHER_REPO, USER],
    );
    await setup.query(
      `insert into public.audits (id, user_id, repository_id, kind, status, created_at, completed_at)
       select
         ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
         $1,
         $2,
         (array['full_audit','recheck','monitor'])[1 + (g % 3)]::public.audit_kind,
         'completed',
         timestamptz '2020-01-01 00:00:00+00' + make_interval(hours => g),
         timestamptz '2020-01-01 00:00:00+00' + make_interval(hours => g)
       from generate_series(1, 1001) as g`,
      [USER, REPO],
    );
    await setup.query(
      `insert into public.audits (id, user_id, repository_id, kind, status, created_at, completed_at) values
        ($3, $1, $2, 'recheck', 'completed', timestamptz '2024-06-01 00:00:02+00', timestamptz '2024-06-01 00:00:00+00'),
        ($4, $1, $2, 'full_audit', 'completed', timestamptz '2024-06-01 00:00:02+00', timestamptz '2024-06-01 00:00:00+00'),
        ($5, $1, $2, 'monitor', 'completed', timestamptz '2024-06-01 00:00:01+00', timestamptz '2024-06-01 00:00:00+00'),
        ('11111111-1111-4111-8111-111111111111', $1, $2, 'free_scan', 'completed', timestamptz '2025-01-01 00:00:00+00', timestamptz '2025-01-01 00:00:00+00'),
        ('22222222-2222-4222-8222-222222222222', $1, $2, 'full_audit', 'failed', timestamptz '2025-02-01 00:00:00+00', timestamptz '2025-02-01 00:00:00+00'),
        ('33333333-3333-4333-8333-333333333333', $1, $2, 'monitor', 'running', timestamptz '2025-03-01 00:00:00+00', timestamptz '2025-03-01 00:00:00+00'),
        ('44444444-4444-4444-8444-444444444444', $1, $2, 'full_audit', 'queued', timestamptz '2025-04-01 00:00:00+00', null),
        ('55555555-5555-4555-8555-555555555555', $1, $2, 'full_audit', 'completed', timestamptz '2026-01-01 00:00:00+00', null),
        ('66666666-6666-4666-8666-666666666666', $1, $6, 'full_audit', 'completed', timestamptz '2026-02-01 00:00:00+00', timestamptz '2026-02-01 00:00:00+00')`,
      [USER, REPO, SAME_TIME_LOWER_ID, WIN, EARLIER_CREATED, OTHER_REPO],
    );
    await setup.end();

    const dbUrl = new URL(target.databaseUrl);
    dbUrl.username = "authenticator";
    dbUrl.password = "postgrest";
    const port = await listenPort();
    const adminPort = await listenPort();
    postgrest = spawn(bin, [], {
      env: {
        ...process.env,
        PGRST_DB_URI: dbUrl.href,
        PGRST_DB_SCHEMAS: "public",
        PGRST_DB_ANON_ROLE: "anon",
        PGRST_DB_MAX_ROWS: "1000",
        PGRST_JWT_SECRET: JWT_SECRET,
        PGRST_SERVER_HOST: "127.0.0.1",
        PGRST_SERVER_PORT: String(port),
        PGRST_ADMIN_SERVER_HOST: "127.0.0.1",
        PGRST_ADMIN_SERVER_PORT: String(adminPort),
        PGRST_DB_CHANNEL_ENABLED: "false",
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    postgrest.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    postgrest.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    postgrestUrl = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 20_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (postgrest.exitCode !== null) break;
      try {
        const response = await fetch(postgrestUrl);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // PostgREST is still opening its port.
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error(`PostgREST did not become ready\n${logs}`);
    const forwarded = await restProxy(port);
    proxy = forwarded.server;
    api = createClient(forwarded.url, signJwt("service_role"), { auth: { persistSession: false, autoRefreshToken: false } });
  }, 60_000);

  afterAll(async () => {
    proxy?.close();
    postgrest?.kill();
    if (!target) return;
    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    const connected = await admin.query<{ db: string }>(`select current_database() as db`);
    assertMaintenanceConnection(connected.rows[0]!.db, target);
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [target.databaseName]);
    await admin.query(`drop database if exists ${target.databaseName}`);
    await admin.end();
  });

  it("returns one deterministic baseline past the 1000-row cap", async () => {
    const key = signJwt("service_role");
    const page = await fetch(`${postgrestUrl}/audits?select=id&repository_id=eq.${REPO}&status=eq.completed`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
    });
    const rows = await page.json() as unknown[];
    const total = Number(page.headers.get("content-range")?.split("/")[1]);
    expect(page.ok).toBe(true);
    expect(rows).toHaveLength(1000);
    expect(total).toBeGreaterThan(1000);

    const first = await latestBaseline(REPO, api);
    const second = await latestBaseline(REPO, api);
    expect(first?.id).toBe(WIN);
    expect(second?.id).toBe(WIN);
    expect(first?.kind).toBe("full_audit");
    expect(first?.status).toBe("completed");
  });
});
