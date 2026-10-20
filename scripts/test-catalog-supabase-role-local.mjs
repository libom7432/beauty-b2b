import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import pg from "pg";

// Only the existing Beauty B2B cluster may be touched. Never accepts a connection URL.
const root = join(homedir(), "Library/Application Support/BeautyB2B/pg17-b4-test");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(process.env.RUN_LOCAL_CATALOG_ROLE_TESTS, "1");
assert.equal((await readFile(join(root, "data/PG_VERSION"), "utf8")).trim(), "17");
const owner = new pg.Client({ host: join(root, "socket"), port: 55432,
  user: userInfo().username, database: "beauty_b2b_catalog_test", connectionTimeoutMillis: 2_000 });
await owner.connect();
const password = randomBytes(32).toString("base64url");
try {
  const target = (await owner.query(`SELECT current_database() AS db,
    current_setting('data_directory') AS data, current_setting('port') AS port,
    current_setting('listen_addresses') AS listen`)).rows[0];
  assert.deepEqual(target, { db: "beauty_b2b_catalog_test", data: join(root, "data"),
    port: "55432", listen: "127.0.0.1" });
  // The generated password is base64url only; it is never printed or stored.
  await owner.query(`ALTER ROLE catalog_admin_reader_runtime PASSWORD '${password}'`);
  const reader = new pg.Client({ host: "127.0.0.1", port: 55432,
    user: "catalog_admin_reader_runtime", database: "beauty_b2b_catalog_test",
    password, ssl: false, connectionTimeoutMillis: 2_000 });
  await reader.connect();
  try {
    const role = (await reader.query(`SELECT current_user AS name, r.rolsuper, r.rolcreatedb,
      r.rolcreaterole, r.rolbypassrls, r.rolinherit,
      has_database_privilege(current_user, current_database(), 'TEMP') AS temp,
      has_database_privilege(current_user, current_database(), 'CREATE') AS db_create,
      pg_has_role(current_user, 'catalog_admin', 'member') AS admin_member,
      pg_has_role(current_user, 'catalog_import', 'member') AS import_member
      FROM pg_roles r WHERE r.rolname = current_user`)).rows[0];
    assert.deepEqual(role, { name: "catalog_admin_reader_runtime", rolsuper: false,
      rolcreatedb: false, rolcreaterole: false, rolbypassrls: false, rolinherit: false,
      temp: false, db_create: false,
      admin_member: false, import_member: false });
    const statuses = (await reader.query("SELECT DISTINCT status FROM catalog_private.products")).rows
      .map((row) => row.status);
    for (const status of ["draft", "published", "retired"]) assert.ok(statuses.includes(status));
    const tables = ["products", "product_variants", "categories", "product_categories",
      "product_images", "product_translations"];
    for (const table of tables) {
      const grants = (await reader.query(`SELECT has_table_privilege(current_user,
        'catalog_private.${table}', 'SELECT') AS r,
        has_table_privilege(current_user, 'catalog_private.${table}', 'INSERT') AS i,
        has_table_privilege(current_user, 'catalog_private.${table}', 'UPDATE') AS u,
        has_table_privilege(current_user, 'catalog_private.${table}', 'DELETE') AS d,
        has_table_privilege(current_user, 'catalog_private.${table}', 'TRUNCATE') AS t`)).rows[0];
      assert.deepEqual(grants, { r: true, i: false, u: false, d: false, t: false });
      const policy = (await reader.query(`SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname = 'catalog_private' AND tablename = $1
          AND cmd = 'SELECT' AND 'catalog_admin_reader_runtime' = ANY(roles)`, [table])).rows[0];
      assert.equal(policy.n, 1);
    }
    for (const sql of [
      "INSERT INTO catalog_private.products DEFAULT VALUES",
      "UPDATE catalog_private.products SET status = status WHERE false",
      "DELETE FROM catalog_private.products WHERE false",
      "TRUNCATE catalog_private.products",
      "CREATE TABLE catalog_private.b4b2a_forbidden (id integer)",
      "CREATE TEMP TABLE b4b2a_forbidden (id integer)",
    ]) await assert.rejects(reader.query(sql), (error) => error.code === "42501");
    const schemas = (await reader.query(`SELECT nspname,
      has_schema_privilege(current_user, oid, 'USAGE') AS allowed
      FROM pg_namespace WHERE nspname IN ('rfq_private','admin_private')`)).rows;
    assert.ok(schemas.every((row) => !row.allowed));
    const functions = (await reader.query(`SELECT p.proname,
      has_function_privilege(current_user, p.oid, 'EXECUTE') AS reader_exec,
      EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public_exec
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'catalog_private'`)).rows;
    assert.ok(functions.length > 0);
    assert.ok(functions.every((row) => !row.reader_exec && !row.public_exec));
    await assert.rejects(reader.query("SELECT count(*) FROM catalog_public.products"),
      (error) => error.code === "42501");
  } finally { await reader.end(); }
  await owner.query("BEGIN READ ONLY");
  try {
    await owner.query("SET LOCAL ROLE anon");
    const publicProducts = (await owner.query("SELECT id FROM catalog_public.products")).rows;
    assert.ok(publicProducts.length > 0);
    await assert.rejects(owner.query("SELECT id FROM catalog_private.products"),
      (error) => error.code === "42501");
  } finally { await owner.query("ROLLBACK"); }
} finally {
  try { await owner.query("ALTER ROLE catalog_admin_reader_runtime PASSWORD NULL"); }
  finally { await owner.end(); }
}
process.stdout.write("Isolated Catalog Admin read role: passed; temporary credential removed.\n");
