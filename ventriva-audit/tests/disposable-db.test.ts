import { describe, expect, it } from "vitest";
import { assertMaintenanceConnection, createIsolatedDatabaseName, resolveDisposableDatabase } from "./helpers/disposable-db";

const admin = "postgres://postgres@127.0.0.1:54329/postgres";

describe("disposable database guard", () => {
  it("gives concurrent runs different database names", () => {
    const left = createIsolatedDatabaseName(10, "aaaa1111");
    const right = createIsolatedDatabaseName(11, "bbbb2222");
    expect(left).not.toBe(right);
    expect(left).toBe("auditflow_fulfill_10_aaaa1111");
  });

  it("derives the target from the admin URL and rejects a mismatched database URL", () => {
    const name = createIsolatedDatabaseName(10, "aaaa1111");
    const resolved = resolveDisposableDatabase({ AUDITFLOW_TEST_ADMIN_URL: admin }, name);
    expect(resolved.databaseName).toBe(name);
    expect(resolved.maintenanceDatabase).toBe("postgres");
    expect(resolved.databaseUrl).toContain(`/${name}`);
    expect(() => resolveDisposableDatabase({
      AUDITFLOW_TEST_ADMIN_URL: admin,
      AUDITFLOW_TEST_DATABASE_URL: "postgres://postgres@127.0.0.1:54329/postgres",
    }, name)).toThrow(/does not match/);
    expect(() => resolveDisposableDatabase({
      AUDITFLOW_TEST_ADMIN_URL: admin,
      AUDITFLOW_TEST_DATABASE_URL: "postgres://postgres@127.0.0.1:5432/" + name,
    }, name)).toThrow(/does not match/);
  });

  it("rejects non-local hosts and unsafe names before any connection", () => {
    const name = createIsolatedDatabaseName(10, "aaaa1111");
    expect(() => resolveDisposableDatabase({ AUDITFLOW_TEST_ADMIN_URL: "postgres://postgres@db.example.com:5432/postgres" }, name)).toThrow(/non-local/);
    expect(() => resolveDisposableDatabase({ AUDITFLOW_TEST_ADMIN_URL: admin }, "postgres")).toThrow(/unsafe database name/);
    expect(() => resolveDisposableDatabase({ AUDITFLOW_TEST_ADMIN_URL: "postgres://postgres@127.0.0.1:54329/template0" }, name)).toThrow(/maintenance/);
  });

  it("refuses a destructive connection that is not the maintenance database", () => {
    const name = createIsolatedDatabaseName(10, "aaaa1111");
    const target = resolveDisposableDatabase({ AUDITFLOW_TEST_ADMIN_URL: admin }, name);
    expect(() => assertMaintenanceConnection("postgres", target)).not.toThrow();
    expect(() => assertMaintenanceConnection(name, target)).toThrow(/connected to/);
    expect(() => assertMaintenanceConnection("production", target)).toThrow(/connected to/);
  });
});
