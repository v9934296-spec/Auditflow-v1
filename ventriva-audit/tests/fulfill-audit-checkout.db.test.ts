import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { assertMaintenanceConnection, createIsolatedDatabaseName, resolveDisposableDatabase, type DisposableDatabase } from "./helpers/disposable-db";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

describe("fulfill_audit_checkout (postgres)", () => {
  let pool: pg.Pool;
  let target: DisposableDatabase;

  beforeAll(async () => {
    target = resolveDisposableDatabase({
      AUDITFLOW_TEST_ADMIN_URL: process.env["AUDITFLOW_TEST_ADMIN_URL"],
      AUDITFLOW_TEST_DATABASE_URL: process.env["AUDITFLOW_TEST_DATABASE_URL"],
    }, createIsolatedDatabaseName());
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
    `);
    const dir = path.join(process.cwd(), "supabase", "migrations");
    for (const file of ["0001_init.sql", "0002_rate_limits.sql", "0003_finding_not_retested.sql", "0004_scan_recovery.sql", "0005_audit_checkout_fulfillment.sql", "0006_atomic_audit_completion.sql"]) {
      await setup.query(readFileSync(path.join(dir, file), "utf8"));
    }
    await setup.query(`insert into auth.users (id, email) values ($1, 'buyer@example.com'), ($2, 'other@example.com')`, [USER, OTHER]);
    await setup.end();
    pool = new pg.Pool({ connectionString: target.databaseUrl });
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    if (!target) return;
    const admin = new pg.Client({ connectionString: target.adminUrl });
    await admin.connect();
    const connected = await admin.query<{ db: string }>(`select current_database() as db`);
    assertMaintenanceConnection(connected.rows[0]!.db, target);
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [target.databaseName]);
    await admin.query(`drop database if exists ${target.databaseName}`);
    await admin.end();
  });

  async function credits(user = USER): Promise<number> {
    const { rows } = await pool.query(`select audit_credits from public.entitlements where user_id = $1`, [user]);
    return rows[0]?.audit_credits ?? -1;
  }

  async function fulfill(args: { event: string; session: string; user?: string | null; mode?: string; status?: string; kind?: string | null }) {
    const { rows } = await pool.query(
      `select public.fulfill_audit_checkout($1, $2, $3, $4, $5, $6, $7) as result`,
      [args.event, "checkout.session.completed", args.session, args.user === undefined ? USER : args.user, args.mode ?? "payment", args.status ?? "paid", args.kind === undefined ? "audit" : args.kind],
    );
    return rows[0].result as string;
  }

  it("grants one credit, then ignores event and session replays including concurrency", async () => {
    expect(await fulfill({ event: "evt_a", session: "cs_a" })).toBe("granted");
    expect(await credits()).toBe(1);
    expect(await fulfill({ event: "evt_a", session: "cs_a" })).toBe("duplicate");
    expect(await fulfill({ event: "evt_b", session: "cs_a" })).toBe("duplicate");
    expect(await credits()).toBe(1);

    const clients = [await pool.connect(), await pool.connect()];
    try {
      const results = await Promise.all(clients.map((client, i) => client.query(
        `select public.fulfill_audit_checkout($1, 'checkout.session.completed', 'cs_race', $2::uuid, 'payment', 'paid', 'audit') as result`,
        [`evt_race_${i}`, USER],
      )));
      expect(results.map((r) => r.rows[0].result).sort()).toEqual(["duplicate", "granted"]);
    } finally {
      clients.forEach((c) => c.release());
    }
    expect(await credits()).toBe(2);
  });

  it("rolls back a forced failure and then grants exactly once on retry", async () => {
    await pool.query(`
      create or replace function public._fail_credit() returns trigger language plpgsql as $$
      begin
        if new.audit_credits > old.audit_credits then raise exception 'forced failure'; end if;
        return new;
      end $$;
      create trigger fail_credit before update on public.entitlements for each row execute function public._fail_credit();
    `);
    const before = await credits();
    await expect(fulfill({ event: "evt_fail", session: "cs_fail" })).rejects.toThrow(/forced failure/);
    expect(await credits()).toBe(before);
    const { rows: rowsAfterFail } = await pool.query(`select count(*)::int as n from public.audit_credit_fulfillments where checkout_session_id = 'cs_fail'`);
    expect(rowsAfterFail[0].n).toBe(0);
    const { rows: events } = await pool.query(`select count(*)::int as n from public.stripe_events where id = 'evt_fail'`);
    expect(events[0].n).toBe(0);

    await pool.query(`drop trigger fail_credit on public.entitlements`);
    expect(await fulfill({ event: "evt_fail", session: "cs_fail" })).toBe("granted");
    expect(await fulfill({ event: "evt_fail", session: "cs_fail" })).toBe("duplicate");
    expect(await credits()).toBe(before + 1);
  });

  it("does not grant another credit when a committed call's response is discarded", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const { rows } = await client.query(
        `select public.fulfill_audit_checkout('evt_lost', 'checkout.session.completed', 'cs_lost', $1::uuid, 'payment', 'paid', 'audit') as result`,
        [USER],
      );
      expect(rows[0].result).toBe("granted");
      await client.query("commit");
    } finally {
      client.release();
    }
    const before = await credits();
    expect(await fulfill({ event: "evt_lost_retry", session: "cs_lost" })).toBe("duplicate");
    expect(await credits()).toBe(before);
  });

  it("does not grant credits for unpaid, unrelated, subscription, or invalid-user sessions", async () => {
    const before = await credits();
    expect(await fulfill({ event: "evt_unpaid", session: "cs_unpaid", status: "unpaid" })).toBe("ineligible");
    expect(await fulfill({ event: "evt_kind", session: "cs_kind", kind: "pro" })).toBe("ineligible");
    expect(await fulfill({ event: "evt_sub", session: "cs_sub", mode: "subscription" })).toBe("ineligible");
    expect(await fulfill({ event: "evt_user", session: "cs_user", user: OTHER })).toBe("granted");
    expect(await credits(OTHER)).toBe(1);
    await pool.query(`delete from public.entitlements where user_id = $1`, [OTHER]);
    expect(await fulfill({ event: "evt_missing", session: "cs_missing", user: OTHER })).toBe("ineligible");
    expect(await fulfill({ event: "evt_nobody", session: "cs_nobody", user: "33333333-3333-4333-8333-333333333333" })).toBe("ineligible");
    expect(await credits()).toBe(before);
    const { rows } = await pool.query(`select count(*)::int as n from public.audit_credit_fulfillments where checkout_session_id in ('cs_unpaid','cs_kind','cs_sub','cs_missing','cs_nobody')`);
    expect(rows[0].n).toBe(0);
  });

  it("does not grant when an older event row exists without a fulfillment record", async () => {
    await pool.query(`insert into public.stripe_events (id, type) values ('evt_old', 'checkout.session.completed')`);
    const before = await credits();
    expect(await fulfill({ event: "evt_old", session: "cs_old" })).toBe("unreconciled");
    expect(await credits()).toBe(before);
    const { rows } = await pool.query(`select count(*)::int as n from public.audit_credit_fulfillments where checkout_session_id = 'cs_old'`);
    expect(rows[0].n).toBe(0);
  });

  it("lets only the service role execute fulfillment", async () => {
    const anon = await pool.query(`select has_function_privilege('anon', 'public.fulfill_audit_checkout(text,text,text,uuid,text,text,text)', 'execute') as ok`);
    const authenticated = await pool.query(`select has_function_privilege('authenticated', 'public.fulfill_audit_checkout(text,text,text,uuid,text,text,text)', 'execute') as ok`);
    const service = await pool.query(`select has_function_privilege('service_role', 'public.fulfill_audit_checkout(text,text,text,uuid,text,text,text)', 'execute') as ok`);
    expect(anon.rows[0].ok).toBe(false);
    expect(authenticated.rows[0].ok).toBe(false);
    expect(service.rows[0].ok).toBe(true);

    const client = await pool.connect();
    try {
      await client.query("set role anon");
      await expect(client.query(`select public.fulfill_audit_checkout('evt_role', 'checkout.session.completed', 'cs_role', $1::uuid, 'payment', 'paid', 'audit')`, [USER])).rejects.toThrow(/permission denied/i);
    } finally {
      await client.query("reset role");
      client.release();
    }
  });
});
