import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { requireSupabaseCatalogConfig } from "../src/lib/catalog-read/postgres-supabase-config.ts";

const ref = "abcdefghijklmnopqrst";
const ca = "-----BEGIN CERTIFICATE-----\nsynthetic-offline-test-only\n-----END CERTIFICATE-----";
const direct = { CATALOG_READ_SUPABASE_PROJECT_REF: ref, CATALOG_READ_SUPABASE_MODE: "direct",
  CATALOG_READ_SUPABASE_HOST: `db.${ref}.supabase.co`, CATALOG_READ_SUPABASE_PORT: "5432",
  CATALOG_READ_SUPABASE_DATABASE: "postgres", CATALOG_READ_SUPABASE_USER: "catalog_admin_reader_runtime",
  CATALOG_READ_SUPABASE_PASSWORD: "isolated-test-password-not-a-real-credential", CATALOG_READ_SUPABASE_CA_PEM: ca };
const pooler = { ...direct, CATALOG_READ_SUPABASE_MODE: "transaction",
  CATALOG_READ_SUPABASE_HOST: "aws-0-us-east-1.pooler.supabase.com",
  CATALOG_READ_SUPABASE_PORT: "6543", CATALOG_READ_SUPABASE_USER: `catalog_admin_reader_runtime.${ref}` };
const reject = (env) => assert.throws(() => requireSupabaseCatalogConfig(env),
  (error) => error.code === "NOT_CONFIGURED" && !error.message.includes("password"));

test("direct and shared pooler targets are accepted without exposing a connection string", () => {
  const first = requireSupabaseCatalogConfig(direct);
  const second = requireSupabaseCatalogConfig(pooler);
  assert.equal(first.poolMax, 2);
  assert.equal(second.poolMax, 1);
  assert.equal(first.host, `db.${ref}.supabase.co`);
});

test("missing or unsafe targets fail closed", () => {
  for (const change of [
    { CATALOG_READ_SUPABASE_PROJECT_REF: undefined },
    { CATALOG_READ_SUPABASE_HOST: "127.0.0.1" },
    { CATALOG_READ_SUPABASE_HOST: "localhost" },
    { CATALOG_READ_SUPABASE_PORT: "55432" },
    { CATALOG_READ_SUPABASE_DATABASE: "beauty_b2b_catalog_test" },
    { CATALOG_READ_SUPABASE_USER: "catalog_read_local" },
    { CATALOG_READ_SUPABASE_USER: "service_role" },
    { CATALOG_READ_SUPABASE_PASSWORD: undefined },
    { CATALOG_READ_SUPABASE_CA_PEM: undefined },
    { CATALOG_READ_SUPABASE_MODE: "unexpected" },
  ]) reject({ ...direct, ...change });
});

test("pooler username, endpoint and port remain bound to mode and project", () => {
  reject({ ...pooler, CATALOG_READ_SUPABASE_USER: `catalog_admin_reader_runtime.${"z".repeat(20)}` });
  reject({ ...pooler, CATALOG_READ_SUPABASE_HOST: `db.${ref}.supabase.co` });
  reject({ ...pooler, CATALOG_READ_SUPABASE_PORT: "5432" });
  reject({ ...pooler, CATALOG_READ_SUPABASE_MODE: "session" });
  assert.equal(requireSupabaseCatalogConfig({ ...pooler, CATALOG_READ_SUPABASE_MODE: "session",
    CATALOG_READ_SUPABASE_PORT: "5432" }).mode, "session");
});

test("server wiring remains opt-in and connector is server-only with verified TLS", async () => {
  const [entry, connector, migration] = await Promise.all([
    readFile(new URL("../src/lib/catalog-read/server.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/catalog-read/postgres-supabase.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20261020120000_add_catalog_admin_read_runtime.sql", import.meta.url), "utf8"),
  ]);
  assert.match(entry, /CATALOG_READ_SOURCE === "supabase" && process\.env\.NODE_ENV === "production"/);
  assert.match(entry, /error instanceof CatalogReadError && error\.code === "NOT_CONFIGURED"/);
  assert.match(connector, /^import "server-only";/);
  assert.match(connector, /rejectUnauthorized: true, servername: config\.host/);
  assert.match(connector, /REPEATABLE READ READ ONLY/);
  assert.doesNotMatch(connector, /connectionString|service_role|catalog_import|catalog_admin\b/);
  assert.doesNotMatch(migration, /PASSWORD\s+'[^']+'/i);
  assert.equal((migration.match(/CREATE POLICY catalog_admin_reader_/g) ?? []).length, 6);
});
