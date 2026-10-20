import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import pg from "pg";

// All changes are enclosed in one transaction and rolled back in the dedicated cluster.
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(process.env.RUN_LOCAL_CATALOG_ROLE_TESTS, "1");
const root = join(homedir(), "Library/Application Support/BeautyB2B/pg17-b4-test");
assert.equal((await readFile(join(root, "data/PG_VERSION"), "utf8")).trim(), "17");
const migration = await readFile(new URL("../supabase/migrations/20261020120000_add_catalog_admin_read_runtime.sql", import.meta.url), "utf8");
const body = migration.replace(/^BEGIN;\s*/m, "").replace(/\s*COMMIT;\s*$/m, "");
const client = new pg.Client({ host: join(root, "socket"), port: 55432,
  user: userInfo().username, database: "beauty_b2b_catalog_test", connectionTimeoutMillis: 2_000 });
const policies = ["products", "variants", "categories", "product_categories", "images", "translations"];
const tables = ["products", "product_variants", "categories", "product_categories", "product_images", "product_translations"];
const role = "catalog_admin_reader_runtime";
const inspect = async (signature) => (await client.query(`SELECT
  has_function_privilege('catalog_admin', $1::regprocedure, 'EXECUTE') AS admin,
  has_function_privilege('catalog_import', $1::regprocedure, 'EXECUTE') AS importer,
  has_function_privilege('catalog_receipt_maintenance', $1::regprocedure, 'EXECUTE') AS maintainer
  `, [signature])).rows[0];
const denied = async (sql) => {
  await client.query("SAVEPOINT denied_check");
  try { await assert.rejects(client.query(sql), (error) => error.code === "42501"); }
  finally { await client.query("ROLLBACK TO SAVEPOINT denied_check"); }
};

await client.connect();
try {
  const target = (await client.query(`SELECT current_database() AS db,
    current_setting('data_directory') AS data, current_setting('port') AS port,
    current_setting('listen_addresses') AS listen`)).rows[0];
  assert.deepEqual(target, { db: "beauty_b2b_catalog_test", data: join(root, "data"),
    port: "55432", listen: "127.0.0.1" });
  await client.query("BEGIN");
  // Preserve the previously tested runtime role and policies inside this transaction.
  await client.query(`ALTER ROLE ${role} RENAME TO catalog_admin_reader_runtime_gate_backup`);
  for (let i = 0; i < tables.length; i++) await client.query(`ALTER POLICY catalog_admin_reader_${policies[i]}
    ON catalog_private.${tables[i]} RENAME TO catalog_admin_reader_${policies[i]}_gate_backup`);

  await client.query("SAVEPOINT unknown_function");
  await assert.rejects(client.query(body), (error) =>
    /Unreviewed catalog_private function/.test(error.message));
  await client.query("ROLLBACK TO SAVEPOINT unknown_function");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1", [role])).rows[0].n, 0);

  // Synthetic copies exercise the reviewed receipt ACL shape without touching real receipts.
  await client.query("DROP FUNCTION catalog_private.local_import_probe()");
  await client.query("CREATE ROLE catalog_receipt_maintenance NOLOGIN NOINHERIT");
  await client.query("CREATE ROLE catalog_receipt_lookup_owner NOLOGIN NOINHERIT");
  await client.query("CREATE ROLE catalog_receipt_lifecycle_owner NOLOGIN NOINHERIT");
  await client.query(`CREATE FUNCTION catalog_private.lookup_catalog_import_receipt(text,text)
    RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS 'SELECT 1'`);
  await client.query(`CREATE FUNCTION catalog_private.purge_due_catalog_receipt_results(integer)
    RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS 'SELECT 1'`);
  const lookup = "catalog_private.lookup_catalog_import_receipt(text,text)";
  const purge = "catalog_private.purge_due_catalog_receipt_results(integer)";
  await client.query(`REVOKE EXECUTE ON FUNCTION ${lookup}, ${purge} FROM PUBLIC`);
  await client.query(`GRANT CREATE ON SCHEMA catalog_private TO catalog_receipt_lookup_owner, catalog_receipt_lifecycle_owner`);
  await client.query(`ALTER FUNCTION ${lookup} OWNER TO catalog_receipt_lookup_owner`);
  await client.query(`ALTER FUNCTION ${purge} OWNER TO catalog_receipt_lifecycle_owner`);
  await client.query(`REVOKE CREATE ON SCHEMA catalog_private FROM catalog_receipt_lookup_owner, catalog_receipt_lifecycle_owner`);
  await client.query(`GRANT EXECUTE ON FUNCTION ${lookup} TO catalog_import`);
  await client.query(`GRANT EXECUTE ON FUNCTION ${purge} TO catalog_receipt_maintenance`);
  await client.query("GRANT USAGE ON SCHEMA catalog_private TO catalog_receipt_maintenance");
  const before = [await inspect(lookup), await inspect(purge)];
  const foundation = "catalog_private.normalized_variant_attributes(jsonb)";
  const foundationBefore = (await client.query(`SELECT
    has_function_privilege('catalog_admin', $1::regprocedure, 'EXECUTE') AS admin,
    has_function_privilege('catalog_import', $1::regprocedure, 'EXECUTE') AS importer,
    has_function_privilege('catalog_public_reader', $1::regprocedure, 'EXECUTE') AS public_reader,
    has_function_privilege('catalog_receipt_maintenance', $1::regprocedure, 'EXECUTE') AS maintainer`,
  [foundation])).rows[0];

  await client.query("SAVEPOINT unexpected_acl");
  await client.query(`GRANT EXECUTE ON FUNCTION ${purge} TO catalog_import`);
  await assert.rejects(client.query(body), (error) =>
    /Unreviewed receipt maintenance ACL/.test(error.message));
  await client.query("ROLLBACK TO SAVEPOINT unexpected_acl");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1", [role])).rows[0].n, 0);

  await client.query("SAVEPOINT unknown_grantee");
  await client.query("CREATE ROLE catalog_unknown_function_grantee NOLOGIN");
  await client.query(`GRANT EXECUTE ON FUNCTION ${foundation} TO catalog_unknown_function_grantee`);
  await assert.rejects(client.query(body), (error) =>
    /Unreviewed foundation function grantee/.test(error.message));
  await client.query("ROLLBACK TO SAVEPOINT unknown_grantee");

  await client.query("SAVEPOINT postcondition_failure");
  await client.query("GRANT TEMPORARY ON DATABASE beauty_b2b_catalog_test TO PUBLIC");
  await assert.rejects(client.query(body), (error) =>
    /unexpected effective privileges/.test(error.message));
  await client.query("ROLLBACK TO SAVEPOINT postcondition_failure");
  assert.equal((await client.query("SELECT count(*)::int AS n FROM pg_roles WHERE rolname = $1", [role])).rows[0].n, 0);

  await client.query(body);
  assert.deepEqual([await inspect(lookup), await inspect(purge)], before);
  const foundationAfter = (await client.query(`SELECT
    has_function_privilege('catalog_admin', $1::regprocedure, 'EXECUTE') AS admin,
    has_function_privilege('catalog_import', $1::regprocedure, 'EXECUTE') AS importer,
    has_function_privilege('catalog_public_reader', $1::regprocedure, 'EXECUTE') AS public_reader,
    has_function_privilege('catalog_receipt_maintenance', $1::regprocedure, 'EXECUTE') AS maintainer`,
  [foundation])).rows[0];
  assert.deepEqual(foundationAfter, foundationBefore);
  assert.deepEqual(before, [
    { admin: false, importer: true, maintainer: false },
    { admin: false, importer: false, maintainer: true },
  ]);
  await client.query(`SET LOCAL ROLE ${role}`);
  const statuses = (await client.query("SELECT DISTINCT status FROM catalog_private.products")).rows.map((r) => r.status);
  for (const status of ["draft", "published", "retired"]) assert.ok(statuses.includes(status));
  assert.equal((await client.query("SELECT row_security_active('catalog_private.products') AS active")).rows[0].active, true);
  for (const table of tables) {
    const privileges = (await client.query(`SELECT
      has_table_privilege(current_user, 'catalog_private.${table}', 'SELECT') AS read,
      has_table_privilege(current_user, 'catalog_private.${table}', 'INSERT') AS insert,
      has_table_privilege(current_user, 'catalog_private.${table}', 'UPDATE') AS update,
      has_table_privilege(current_user, 'catalog_private.${table}', 'DELETE') AS delete,
      has_table_privilege(current_user, 'catalog_private.${table}', 'TRUNCATE') AS truncate`)).rows[0];
    assert.deepEqual(privileges, { read: true, insert: false, update: false, delete: false, truncate: false });
    assert.equal((await client.query(`SELECT row_security_active('catalog_private.${table}') AS active`)).rows[0].active, true);
  }
  for (const sql of ["INSERT INTO catalog_private.products DEFAULT VALUES",
    "UPDATE catalog_private.products SET status=status WHERE false",
    "DELETE FROM catalog_private.products WHERE false", "TRUNCATE catalog_private.products",
    "CREATE TABLE catalog_private.forbidden_gate_test (id integer)",
    "CREATE TEMP TABLE forbidden_gate_test (id integer)",
    "SELECT * FROM catalog_public.products", "SELECT * FROM rfq_private.sentinel",
    "SELECT * FROM catalog_private.lookup_catalog_import_receipt('actor','key')",
    "SELECT catalog_private.purge_due_catalog_receipt_results(1)"]) await denied(sql);
  await client.query("RESET ROLE");
  await client.query("SET LOCAL ROLE catalog_import");
  assert.equal((await client.query("SELECT * FROM catalog_private.lookup_catalog_import_receipt('actor','key')")).rows[0].lookup_catalog_import_receipt, 1);
  assert.equal((await client.query("UPDATE catalog_private.products SET product_code=product_code WHERE product_code='FAMILY-01'")).rowCount, 1);
  await denied("SELECT catalog_private.purge_due_catalog_receipt_results(1)");
  await client.query("RESET ROLE");
  await client.query("SET LOCAL ROLE catalog_admin");
  await denied("SELECT * FROM catalog_private.lookup_catalog_import_receipt('actor','key')");
  await denied("SELECT catalog_private.purge_due_catalog_receipt_results(1)");
  await client.query("RESET ROLE");
  await client.query("SET LOCAL ROLE catalog_receipt_maintenance");
  assert.equal((await client.query("SELECT catalog_private.purge_due_catalog_receipt_results(1) AS n")).rows[0].n, 1);
  await denied("SELECT * FROM catalog_private.lookup_catalog_import_receipt('actor','key')");
  await client.query("RESET ROLE");
  process.stdout.write("Isolated migration gate: unknown function and ACL fail closed; role, RLS, read-only and receipt privileges pass.\n");
} finally {
  try {
    await client.query("ROLLBACK");
    const restored = (await client.query(`SELECT
      to_regrole('catalog_admin_reader_runtime') IS NOT NULL AS role_restored,
      to_regrole('catalog_admin_reader_runtime_gate_backup') IS NULL AS backup_absent,
      to_regprocedure('catalog_private.local_import_probe()') IS NOT NULL AS probe_restored,
      to_regprocedure('catalog_private.purge_due_catalog_receipt_results(integer)') IS NULL AS synthetic_absent`)).rows[0];
    assert.deepEqual(restored, { role_restored: true, backup_absent: true,
      probe_restored: true, synthetic_absent: true });
  } finally { await client.end(); }
}
