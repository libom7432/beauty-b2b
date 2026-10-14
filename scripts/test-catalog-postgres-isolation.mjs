/** Post-migration checks against the dedicated, synthetic-only local cluster. */
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { readCatalogSnapshot } from "../src/lib/catalog-import/transaction.ts";

// node-postgres defaults int8 to text; the B4.5-A mapper expects bigint or a safe number.
// A future SQL reader must make this conversion explicitly, including overflow rejection.
pg.types.setTypeParser(20, (value) => BigInt(value));

const url = process.env.CATALOG_TEST_DATABASE_URL;
const expectedDir = process.env.CATALOG_TEST_DATA_DIR;
if (process.env.CATALOG_TEST_ENABLE !== "1" || !url || !expectedDir) throw new Error("Local test opt-in and data directory required");
const target = new URL(url);
if (target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" || target.port !== "55439" || target.pathname !== "/catalog_schema_test")
  throw new Error("Refusing non-isolated database target");

const db = new pg.Client({ connectionString: url });
await db.connect();
let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const sql = (statement, values = []) => db.query(statement, values);
async function asRole(role, statement, expectedSuccess) {
  await sql("BEGIN");
  try {
    await sql(`SET LOCAL ROLE ${role}`);
    let succeeded = true;
    try { await sql(statement); } catch { succeeded = false; }
    check(succeeded === expectedSuccess, `${role}: ${statement}`);
  } finally { await sql("ROLLBACK"); }
}

try {
  const identity = (await sql(`SELECT current_database() db, current_user username, host(inet_server_addr()) host,
    inet_server_port() port, current_setting('data_directory') data_dir, current_setting('listen_addresses') listens,
    to_regnamespace('rfq_private') rfq_schema`)).rows[0];
  console.log(`LOCAL PREFLIGHT host=${identity.host} port=${identity.port} database=${identity.db} user=${identity.username} data_dir=${identity.data_dir} listens=${identity.listens}`);
  check(identity.db === "catalog_schema_test" && identity.username === "catalog_test_owner", "database and owner");
  check(identity.host === "127.0.0.1" && identity.port === 55439 && identity.listens === "127.0.0.1", "loopback only");
  check(fs.realpathSync(identity.data_dir) === fs.realpathSync(expectedDir) && identity.rfq_schema === null, "isolated data directory and no RFQ schema");

  const tables = ["products", "product_variants", "categories", "product_categories", "product_images", "product_translations"];
  const catalogTables = (await sql("SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='catalog_private'")).rows;
  check(catalogTables.length === 6 && tables.every((name) => catalogTables.some((table) => table.tablename === name && table.rowsecurity)), "six RLS-enabled tables");
  const views = (await sql(`SELECT c.relname, c.reloptions, pg_get_userbyid(c.relowner) owner
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='catalog_public' AND c.relkind='v'`)).rows;
  check(views.length === 6 && views.every((view) => view.owner === "catalog_public_reader" && view.reloptions?.includes("security_barrier=true")), "read-only security-barrier views");
  const constraints = (await sql(`SELECT cl.relname, co.contype, co.conname FROM pg_constraint co
    JOIN pg_class cl ON cl.oid=co.conrelid JOIN pg_namespace ns ON ns.oid=cl.relnamespace
    WHERE ns.nspname='catalog_private' AND cl.relname=ANY($1)`, [tables])).rows;
  check(tables.every((table) => constraints.some((constraint) => constraint.relname === table && constraint.contype === "p")), "six primary keys");
  const uuidIds = (await sql(`SELECT c.relname FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='catalog_private'
      AND c.relname=ANY($1) AND a.attname='id' AND a.atttypid='uuid'::regtype`, [["products", "product_variants", "categories", "product_images"]])).rows;
  check(uuidIds.length === 4, "four entity UUID identities; association tables use composite keys");
  check(["product_variants", "product_categories", "product_images", "product_translations"].every((table) => constraints.some((constraint) => constraint.relname === table && constraint.contype === "f")), "association foreign keys");
  const indexes = (await sql("SELECT indexname FROM pg_indexes WHERE schemaname='catalog_private'")).rows.map((row) => row.indexname);
  check(["products_product_code_key", "product_variants_sku_key", "product_variants_combination_uq", "product_categories_one_primary_uq", "product_images_storage_key_uq", "product_images_primary_uq", "product_translations_pkey"].every((name) => indexes.includes(name)), "identity and publication indexes");
  const roles = (await sql("SELECT rolname, rolcanlogin, rolinherit FROM pg_roles WHERE rolname=ANY($1)", [["anon", "catalog_admin", "catalog_import", "catalog_public_reader", "rfq_api"]])).rows;
  check(roles.length === 5 && roles.every((role) => !role.rolcanlogin && !role.rolinherit), "no-login, no-inherit role boundaries");
  const memberships = (await sql(`SELECT member.rolname member, parent.rolname parent FROM pg_auth_members m
    JOIN pg_roles member ON member.oid=m.member JOIN pg_roles parent ON parent.oid=m.roleid
    WHERE member.rolname=ANY($1)`, [["anon", "catalog_admin", "catalog_import", "catalog_public_reader", "rfq_api"]])).rows;
  check(memberships.length === 0, "no catalog/RFQ role inheritance paths");

  await asRole("anon", "SELECT count(*) FROM catalog_private.products", false);
  await asRole("anon", "INSERT INTO catalog_private.products(product_code,slug,product_type) VALUES ('SYN-BLOCKED','syn-blocked','press_on_nails')", false);
  await asRole("anon", "UPDATE catalog_private.products SET featured=true WHERE false", false);
  await asRole("anon", "DELETE FROM catalog_private.products WHERE false", false);
  await asRole("anon", "SELECT count(*) FROM catalog_public.products", true);
  const publicCount = (await sql("SELECT count(*)::integer n FROM catalog_public.products")).rows[0].n;
  check(publicCount === 1, "public views exclude draft and retired fixtures");
  const exposedVariants = (await sql("SELECT count(*)::integer n FROM catalog_public.product_variants")).rows[0].n;
  const publishedVariants = (await sql("SELECT count(*)::integer n FROM catalog_private.product_variants WHERE status='published'")).rows[0].n;
  check(exposedVariants <= publishedVariants, "public view excludes unpublished SKUs");
  await asRole("catalog_import", "INSERT INTO catalog_private.products(product_code,slug,product_type) VALUES ('SYN-IMPORT-CHECK','syn-import-check','press_on_nails')", true);
  await asRole("catalog_import", "UPDATE catalog_private.products SET featured=featured WHERE status='draft'", true);
  await asRole("catalog_import", "DELETE FROM catalog_private.products WHERE false", false);
  await asRole("rfq_api", "SELECT count(*) FROM catalog_private.products", false);
  await asRole("rfq_api", "INSERT INTO catalog_private.products(product_code,slug,product_type) VALUES ('SYN-RFQ-BLOCKED','syn-rfq-blocked','press_on_nails')", false);
  check((await sql("SELECT count(*)::integer n FROM catalog_private.products")).rows[0].n === 3, "role tests rolled back without business writes");

  const mapping = { variants: "product_variants", images: "product_images", translations: "product_translations", products: "products", categories: "categories", product_categories: "product_categories" };
  const reader = { async readRows() {
    const rows = {};
    for (const [key, table] of Object.entries(mapping)) rows[key] = (await sql(`SELECT * FROM catalog_private.${table}`)).rows;
    return rows;
  } };
  const snapshot = await readCatalogSnapshot(reader, "catalog-attributes-v1");
  check(snapshot.products.length === 3 && snapshot.variants.length >= 1 && snapshot.categories.length >= 1, "six-table snapshot maps real PostgreSQL rows");
  check(snapshot.translations.some((row) => row.locale === "en") && snapshot.translations.some((row) => row.locale === "zh"), "bilingual translations map");
  check(snapshot.version.digest === (await readCatalogSnapshot(reader, "catalog-attributes-v1")).version.digest, "stable snapshot digest");
  check(snapshot.variants.every((row) => Number.isSafeInteger(row.moq_quantity) && (row.reference_price === null || typeof row.reference_price === "string")), "bigint and numeric mapping");
  console.log(`Catalog local isolation: ${checks} post-migration checks passed`);
} finally { await db.end(); }
