import { randomBytes } from "node:crypto";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const ISOLATED_NAME = /^auditflow_fulfill_[0-9]+_[0-9a-f]{8}$/;
const UNSAFE_DATABASES = new Set(["postgres", "template0", "template1"]);

export function createIsolatedDatabaseName(pid = process.pid, nonce = randomBytes(4).toString("hex")): string {
  const name = `auditflow_fulfill_${pid}_${nonce}`;
  if (!ISOLATED_NAME.test(name)) throw new Error(`refusing unsafe database name ${name}`);
  return name;
}

export interface DisposableDatabase {
  adminUrl: string;
  databaseUrl: string;
  databaseName: string;
  maintenanceDatabase: string;
}

function parsePostgresUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("refusing unparseable database URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("refusing non-postgres database URL");
  return url;
}

/**
 * Build the admin connection and a unique disposable database on that same server.
 * A supplied AUDITFLOW_TEST_DATABASE_URL must name that isolated database. Anything else is rejected before a drop.
 */
export function resolveDisposableDatabase(env: { AUDITFLOW_TEST_ADMIN_URL?: string; AUDITFLOW_TEST_DATABASE_URL?: string }, databaseName: string): DisposableDatabase {
  if (!ISOLATED_NAME.test(databaseName) || UNSAFE_DATABASES.has(databaseName)) {
    throw new Error(`refusing unsafe database name ${databaseName}`);
  }
  const admin = parsePostgresUrl(env.AUDITFLOW_TEST_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres");
  if (!LOCAL_HOSTS.has(admin.hostname)) throw new Error(`refusing non-local database host ${admin.hostname}`);
  const maintenanceDatabase = admin.pathname.replace(/^\//, "");
  if (!maintenanceDatabase || maintenanceDatabase === "template0" || maintenanceDatabase === "template1") {
    throw new Error("refusing unsafe maintenance database");
  }
  if (maintenanceDatabase === databaseName) throw new Error("refusing to use the disposable database as the maintenance connection");
  const target = new URL(admin.href);
  target.pathname = `/${databaseName}`;
  const supplied = env.AUDITFLOW_TEST_DATABASE_URL;
  if (supplied) {
    const explicit = parsePostgresUrl(supplied);
    const explicitName = explicit.pathname.replace(/^\//, "");
    if (
      explicit.protocol !== admin.protocol ||
      explicit.hostname !== admin.hostname ||
      explicit.port !== admin.port ||
      explicit.username !== admin.username ||
      explicitName !== databaseName
    ) {
      throw new Error("AUDITFLOW_TEST_DATABASE_URL does not match the isolated database");
    }
  }
  return { adminUrl: admin.href, databaseUrl: target.href, databaseName, maintenanceDatabase };
}

/** Confirms the open connection is the maintenance database before any drop or create. */
export function assertMaintenanceConnection(currentDatabase: string, target: DisposableDatabase): void {
  if (currentDatabase !== target.maintenanceDatabase) {
    throw new Error(`connected to ${currentDatabase}, expected maintenance database ${target.maintenanceDatabase}`);
  }
  if (currentDatabase === target.databaseName || UNSAFE_DATABASES.has(target.databaseName)) {
    throw new Error("refusing to drop the connected database");
  }
}
