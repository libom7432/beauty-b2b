import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";
import { createPostgresCatalogReadSource } from "../src/lib/catalog-read/postgres-core.ts";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createAdminCursorCodec } from "../src/lib/catalog-read/admin-cursor.ts";
import { requireLocalCatalogReadUrl } from "../src/lib/catalog-read/postgres-local-config.ts";

const enabled = process.env.RUN_LOCAL_CATALOG_READ_TESTS === "1";
const connectionString = process.env.CATALOG_READ_LOCAL_DATABASE_URL;
if (enabled) requireLocalCatalogReadUrl(connectionString, process.env.NODE_ENV);

test("local-only reader privilege and catalog smoke checks", { skip: !enabled }, async () => {
  const pool = new pg.Pool({ connectionString, max: 2, ssl: false,
    connectionTimeoutMillis: 2_000, query_timeout: 5_000, statement_timeout: 5_000 });
  try {
    const target = (await pool.query(`SELECT current_database() AS db,
      current_setting('port') AS port,
      current_setting('listen_addresses') AS listen`)).rows[0];
    assert.deepEqual(target, { db: "beauty_b2b_catalog_test",
      port: "55432", listen: "127.0.0.1" });
    const identity = (await pool.query(`SELECT current_user AS name, r.rolsuper, r.rolbypassrls,
      r.rolinherit, pg_has_role(current_user, 'catalog_admin', 'member') AS admin_member,
      pg_has_role(current_user, 'catalog_import', 'member') AS import_member
      FROM pg_roles r WHERE r.rolname = current_user`)).rows[0];
    assert.equal(identity.name, "catalog_read_local");
    assert.equal(identity.rolsuper, false);
    assert.equal(identity.rolbypassrls, false);
    assert.equal(identity.rolinherit, false);
    assert.equal(identity.admin_member, false);
    assert.equal(identity.import_member, false);
    const rfqSchemas = (await pool.query(`SELECT nspname,
      has_schema_privilege(current_user, oid, 'USAGE') AS can_use
      FROM pg_namespace WHERE nspname LIKE 'rfq%'`)).rows;
    assert.ok(rfqSchemas.every((schema) => !schema.can_use));
    const schemaGrants = (await pool.query(`SELECT
      has_schema_privilege(current_user, 'catalog_private', 'USAGE') AS private_usage,
      has_schema_privilege(current_user, 'catalog_public', 'USAGE') AS public_usage`)).rows[0];
    assert.equal(schemaGrants.private_usage, true);
    assert.equal(schemaGrants.public_usage, true);
    const importFunctions = (await pool.query(`SELECT
      has_function_privilege(current_user, p.oid, 'EXECUTE') AS can_execute
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'catalog_private' AND p.proname ILIKE '%import%'`)).rows;
    assert.ok(importFunctions.every((fn) => !fn.can_execute));
    for (const table of ["products", "product_variants", "categories", "product_categories",
      "product_images", "product_translations"]) {
      const relation = `catalog_private.${table}`;
      const grants = (await pool.query(`SELECT
        has_table_privilege(current_user, $1, 'SELECT') AS can_select,
        has_table_privilege(current_user, $1, 'INSERT') AS can_insert,
        has_table_privilege(current_user, $1, 'UPDATE') AS can_update,
        has_table_privilege(current_user, $1, 'DELETE') AS can_delete,
        has_table_privilege(current_user, $1, 'TRUNCATE') AS can_truncate`, [relation])).rows[0];
      assert.equal(grants.can_select, true);
      for (const key of ["can_insert", "can_update", "can_delete", "can_truncate"])
        assert.equal(grants[key], false);
      const rls = (await pool.query(`SELECT relrowsecurity,
        relowner::regrole::text AS owner FROM pg_class WHERE oid = $1::regclass`,
        [relation])).rows[0];
      assert.equal(rls.relrowsecurity, true);
      assert.notEqual(rls.owner, "catalog_read_local");
    }
    const snapshot = async (work) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const result = await work({ select: async (sql, values) => {
          assert.match(sql, /^\s*(?:SELECT|WITH RECURSIVE)\b/i);
          return (await client.query(sql, [...values])).rows;
        } });
        await client.query("COMMIT");
        return result;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    };
    const source = createPostgresCatalogReadSource(snapshot);
    const dependencies = { provider: { async verifySession() {
      return { identity_provider: "test", provider_subject: "local-reader" };
    } }, directory: { async findByProviderIdentity() {
      return { admin_id: "00000001-0000-4000-8000-000000000000", identity_provider: "test",
        provider_subject: "local-reader", status: "active", created_at: new Date().toISOString(),
        disabled_at: null, permissions: ["catalog.read"] };
    } } };
    const repository = createCatalogReadRepository(source, { session: "local", dependencies },
      createAdminCursorCodec(randomBytes(32).toString("base64url")));
    const admin = await repository.listAdminProducts({ limit: 2 });
    await repository.listAdminPrimaryCategoryOptions();
    if (admin.items[0]) await repository.getAdminProductByCode(admin.items[0].productCode);
    const publicPage = await repository.listPublishedProducts({ limit: 2 });
    assert.equal(JSON.stringify(publicPage).includes("storageKey"), false);
  } finally { await pool.end(); }
});

const id = (number) => `${String(number).padStart(8, "0")}-0000-4000-8000-000000000000`;
const publishedCodes = ["FAMILY-01", "FAMILY-04", "FAMILY-05", "FAMILY-06", "FAMILY-07", "FAMILY-08"];
const readerPool = () => new pg.Pool({ connectionString, max: 2, ssl: false,
  connectionTimeoutMillis: 2_000, query_timeout: 5_000, statement_timeout: 5_000 });
const auth = { session: "isolated-test", dependencies: {
  provider: { async verifySession() { return { identity_provider: "test", provider_subject: "isolated-reader" }; } },
  directory: { async findByProviderIdentity() { return {
    admin_id: id(900), identity_provider: "test", provider_subject: "isolated-reader",
    status: "active", created_at: "2026-10-01T00:00:00Z", disabled_at: null,
    permissions: ["catalog.read"],
  }; } },
} };
const sourceFor = (pool) => createPostgresCatalogReadSource(async (work) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const result = await work({ select: async (sql, values) =>
      (await client.query(sql, [...values])).rows });
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
});
const repositoryFor = (pool) => createCatalogReadRepository(sourceFor(pool), auth,
  createAdminCursorCodec(randomBytes(32).toString("base64url")));
const codes = (page) => page.items.map((item) => item.productCode);
const checkDenied = async (task) => assert.rejects(task, (error) => error.code === "42501");

test("real schema has six private tables, six public views, indexes, constraints and RLS", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const relations = (await pool.query(`SELECT n.nspname, c.relname, c.relkind, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('catalog_private','catalog_public') AND c.relkind IN ('r','v')`)).rows;
    const privateTables = relations.filter((row) => row.nspname === "catalog_private");
    const publicViews = relations.filter((row) => row.nspname === "catalog_public");
    assert.equal(privateTables.length, 6);
    assert.equal(publicViews.length, 6);
    assert.ok(privateTables.every((row) => row.relkind === "r" && row.relrowsecurity));
    assert.ok(publicViews.every((row) => row.relkind === "v"));
    const indexes = (await pool.query(`SELECT indexname FROM pg_indexes
      WHERE schemaname='catalog_private'`)).rows.map((row) => row.indexname);
    for (const name of ["product_categories_one_primary_uq", "product_variants_combination_uq",
      "product_images_primary_uq", "products_public_listing_idx"]) assert.ok(indexes.includes(name));
    const constraints = (await pool.query(`SELECT conname FROM pg_constraint
      WHERE conrelid='catalog_private.products'::regclass`)).rows;
    assert.ok(constraints.some((row) => row.conname === "products_product_code_key"));
  } finally { await pool.end(); }
});

test("real login has minimum rights; writes, RFQ and test import execution are denied", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const role = (await pool.query(`SELECT current_user AS name, rolsuper, rolbypassrls,
      rolinherit, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname=current_user`)).rows[0];
    assert.equal(role.name, "catalog_read_local");
    for (const key of ["rolsuper", "rolbypassrls", "rolinherit", "rolcreatedb", "rolcreaterole"])
      assert.equal(role[key], false);
    const createRights = (await pool.query(`SELECT
      has_database_privilege(current_user, current_database(), 'CREATE') AS database_create,
      has_schema_privilege(current_user, 'catalog_private', 'CREATE') AS private_create,
      has_schema_privilege(current_user, 'catalog_public', 'CREATE') AS public_create`)).rows[0];
    assert.deepEqual(createRights, { database_create: false, private_create: false, public_create: false });
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM catalog_private.products")).rows[0].n, 9);
    await checkDenied(pool.query(`INSERT INTO catalog_private.products
      (product_code,slug,product_type) VALUES ('DENIED','denied','press-on')`));
    await checkDenied(pool.query("UPDATE catalog_private.products SET featured=false WHERE false"));
    await checkDenied(pool.query("DELETE FROM catalog_private.products WHERE false"));
    await checkDenied(pool.query("TRUNCATE catalog_private.products"));
    await checkDenied(pool.query("SELECT * FROM rfq_private.sentinel"));
    await checkDenied(pool.query("SELECT catalog_private.local_import_probe()"));
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM catalog_private.products")).rows[0].n, 9);
  } finally { await pool.end(); }
});

test("separate login without an applicable policy sees zero private rows", { skip: !enabled }, async () => {
  const deniedSecret = process.env.CATALOG_READ_LOCAL_DENIED_PASSWORD;
  assert.ok(deniedSecret, "Isolated no-policy password must be provided");
  const url = new URL(connectionString);
  url.username = "catalog_no_policy_test";
  url.password = deniedSecret;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 1, ssl: false,
    connectionTimeoutMillis: 2_000 });
  try {
    const role = (await pool.query("SELECT current_user AS name")).rows[0].name;
    assert.equal(role, "catalog_no_policy_test");
    assert.equal((await pool.query("SELECT count(*)::integer AS n FROM catalog_private.products")).rows[0].n, 0);
  } finally { await pool.end(); }
});

test("real SQL detail uses Product Code and maps variant, category, translation, image and decimals", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const repository = repositoryFor(pool);
    const detail = await repository.getAdminProductByCode("FAMILY-01");
    assert.equal(detail.basic.product_code, "FAMILY-01");
    assert.equal(detail.basic.status, "published");
    assert.equal(detail.translations.en.state, "available");
    assert.equal(detail.translations.zh.state, "available");
    assert.equal(detail.translations.zh.value.name, "玫瑰甲片");
    assert.equal(detail.categories.primary.id, id(702));
    assert.deepEqual(detail.categories.path, ["nails", "press-on"]);
    assert.deepEqual(detail.categories.additional.map((row) => row.id), [id(703), id(704)]);
    assert.deepEqual(detail.variants.map((row) => [row.sku, row.status]),
      [["SKU-01", "published"], ["SKU-01-DRAFT", "draft"]]);
    assert.equal(detail.variants[0].referencePrice.amount, "12.3400");
    assert.equal(detail.variants[0].moq.quantity, 100);
    assert.ok(detail.images.some((image) => image.storageKey === "private/synthetic/1/primary.webp"));
    assert.equal(detail.images.length, 3);
    await assert.rejects(repository.getAdminProductByCode("SKU-01"), { code: "NOT_FOUND" });
    await assert.rejects(repository.getAdminProductByCode("DOES-NOT-EXIST"), { code: "NOT_FOUND" });
    const draft = await repository.getAdminProductByCode("FAMILY-02");
    assert.equal(draft.translations.zh.state, "unavailable");
    assert.equal((await repository.getAdminProductByCode("FAMILY-03")).basic.status, "retired");
  } finally { await pool.end(); }
});

test("real SQL search handles Product Code, English, Chinese, case and LIKE metacharacters", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const repository = repositoryFor(pool);
    for (const term of ["  family-01  ", "  ROSE%_SET  ", "玫瑰", "%", "_"]) {
      assert.deepEqual(codes(await repository.listAdminProducts({ search: term })), ["FAMILY-01"], term);
    }
    assert.deepEqual(codes(await repository.listAdminProducts({ search: "Back\\Slash" })), ["FAMILY-04"]);
    assert.deepEqual(codes(await repository.listAdminProducts({ search: "   ", status: "retired" })),
      ["FAMILY-03"]);
    assert.deepEqual(codes(await repository.listAdminProducts({ search: "' OR 1=1 --" })), []);
  } finally { await pool.end(); }
});

test("real SQL status, primary category and combined filters exclude additional links", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const repository = repositoryFor(pool);
    assert.deepEqual(codes(await repository.listAdminProducts({ status: "published" })), publishedCodes);
    assert.deepEqual(codes(await repository.listAdminProducts({ status: "draft" })), ["FAMILY-02", "CN-甲"]);
    assert.deepEqual(codes(await repository.listAdminProducts({ status: "retired" })), ["FAMILY-03"]);
    assert.deepEqual(codes(await repository.listAdminProducts({ primaryCategoryId: id(703) })), []);
    assert.deepEqual(codes(await repository.listAdminProducts({ primaryCategoryId: id(704) })), []);
    assert.deepEqual(codes(await repository.listAdminProducts({ primaryCategoryId: id(702),
      status: "published", search: "family" })), publishedCodes);
    const options = await repository.listAdminPrimaryCategoryOptions();
    assert.deepEqual(options.items.map((row) => row.id), [id(702)]);
  } finally { await pool.end(); }
});

test("real SQL four sorts and bidirectional keyset preserve order across equal timestamps", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const repository = repositoryFor(pool);
    const equalTime = (await pool.query(`SELECT count(DISTINCT updated_at)::integer AS n
      FROM catalog_private.products WHERE status='published'`)).rows[0].n;
    assert.equal(equalTime, 1);
    for (const sort of ["updated_desc", "updated_asc", "product_code_asc", "product_code_desc"]) {
      const expected = sort === "product_code_desc" ? [...publishedCodes].reverse() : publishedCodes;
      const first = await repository.listAdminProducts({ status: "published", sort, limit: 2 });
      assert.deepEqual(codes(first), expected.slice(0, 2), sort);
      assert.equal(first.previousCursor, undefined);
      assert.ok(first.nextCursor);
      const second = await repository.listAdminProducts({ status: "published", sort, limit: 2,
        cursor: first.nextCursor });
      assert.deepEqual(codes(second), expected.slice(2, 4), sort);
      const third = await repository.listAdminProducts({ status: "published", sort, limit: 2,
        cursor: second.nextCursor });
      assert.deepEqual(codes(third), expected.slice(4, 6), sort);
      assert.equal(third.nextCursor, null);
      assert.deepEqual([...codes(first), ...codes(second), ...codes(third)], expected);
      const backwards = await repository.listAdminProducts({ status: "published", sort, limit: 2,
        cursor: third.previousCursor, direction: "before" });
      assert.deepEqual(codes(backwards), codes(second), sort);
      const backToFirst = await repository.listAdminProducts({ status: "published", sort, limit: 2,
        cursor: backwards.previousCursor, direction: "before" });
      assert.deepEqual(codes(backToFirst), codes(first), sort);
      assert.equal(backToFirst.previousCursor, undefined);
    }
  } finally { await pool.end(); }
});

test("real SQL empty, singleton, bad cursor and unauthorized access stay distinct", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const source = sourceFor(pool);
    const codec = createAdminCursorCodec(randomBytes(32).toString("base64url"));
    const repository = createCatalogReadRepository(source, auth, codec);
    assert.deepEqual(codes(await repository.listAdminProducts({ search: "nothing-matches" })), []);
    const single = await repository.listAdminProducts({ search: "FAMILY-05", limit: 2 });
    assert.deepEqual(codes(single), ["FAMILY-05"]);
    assert.equal(single.nextCursor, null);
    await assert.rejects(repository.listAdminProducts({ cursor: "forged" }), { code: "INVALID_INPUT" });
    let calls = 0;
    const guarded = { ...source, async listAdmin(query) { calls++; return source.listAdmin(query); } };
    const anonymous = createCatalogReadRepository(guarded, null, codec);
    await assert.rejects(anonymous.listAdminProducts(), { code: "FORBIDDEN" });
    assert.equal(calls, 0);
  } finally { await pool.end(); }
});

test("real public views and Repository hide drafts, retired, unpublished relations and storage keys", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    const repository = repositoryFor(pool);
    const publicRows = await repository.listPublishedProducts({ limit: 20 });
    assert.equal(publicRows.items.length, 6);
    assert.ok(publicRows.items.every((item) => publishedCodes.includes(item.productCode)));
    assert.equal(JSON.stringify(publicRows).includes("private/synthetic"), false);
    assert.equal(JSON.stringify(publicRows).includes("storageKey"), false);
    const detail = await repository.getPublishedProductBySlug("family-1");
    assert.deepEqual(detail.variants.map((row) => row.sku), ["SKU-01"]);
    assert.equal(detail.images.length, 2);
    assert.deepEqual(detail.categories.additional, []);
    assert.equal(JSON.stringify(detail).includes("storage"), false);
    await assert.rejects(repository.getPublishedProductBySlug("family-2"), { code: "NOT_FOUND" });
    await assert.rejects(repository.getPublishedProductBySlug("family-3"), { code: "NOT_FOUND" });
    const columns = (await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='catalog_public' AND table_name='product_images'`)).rows.map((row) => row.column_name);
    assert.equal(columns.includes("storage_key"), false);
    const viewRows = (await pool.query("SELECT count(*)::integer AS n FROM catalog_public.products")).rows[0].n;
    assert.equal(viewRows, 6);
  } finally { await pool.end(); }
});

test("real connection failure becomes sanitized SOURCE_UNAVAILABLE", { skip: !enabled }, async () => {
  const source = createPostgresCatalogReadSource(async (work) => {
    const client = new pg.Client({ host: "127.0.0.1", port: 55433, user: "catalog_read_local",
      database: "beauty_b2b_catalog_test", connectionTimeoutMillis: 200 });
    try {
      await client.connect();
      return await work({ select: async (sql, values) => (await client.query(sql, [...values])).rows });
    } finally {
      await client.end().catch(() => {});
    }
  });
  const repository = createCatalogReadRepository(source, auth,
    createAdminCursorCodec(randomBytes(32).toString("base64url")));
  await assert.rejects(repository.listAdminProducts(), (error) =>
    error.code === "SOURCE_UNAVAILABLE" && !String(error).includes("55433") &&
    !String(error).includes("postgres://"));
});

test("SQL, detail and signed keyset agree on the existing Unicode Product Code", { skip: !enabled }, async () => {
  const pool = readerPool();
  try {
    assert.equal((await pool.query("SELECT product_code FROM catalog_private.products WHERE product_code=$1",
      ["CN-甲"])).rows[0].product_code, "CN-甲");
    const repository = repositoryFor(pool);
    assert.equal((await repository.getAdminProductByCode("CN-甲")).basic.product_code, "CN-甲");
    const first = await repository.listAdminProducts({ sort: "product_code_asc", limit: 1 });
    assert.deepEqual(codes(first), ["CN-甲"]);
    assert.ok(first.nextCursor);
    const second = await repository.listAdminProducts({ sort: "product_code_asc", limit: 1,
      cursor: first.nextCursor });
    assert.deepEqual(codes(second), ["FAMILY-01"]);
    const previous = await repository.listAdminProducts({ sort: "product_code_asc", limit: 1,
      cursor: second.previousCursor, direction: "before" });
    assert.deepEqual(codes(previous), ["CN-甲"]);
    const descending = await repository.listAdminProducts({ sort: "product_code_desc", limit: 1 });
    assert.deepEqual(codes(descending), ["FAMILY-08"]);
    let cursor = descending.nextCursor;
    const seen = [...codes(descending)];
    while (cursor) {
      const page = await repository.listAdminProducts({ sort: "product_code_desc", limit: 1, cursor });
      seen.push(...codes(page));
      cursor = page.nextCursor;
    }
    assert.deepEqual(seen, ["FAMILY-08", "FAMILY-07", "FAMILY-06", "FAMILY-05",
      "FAMILY-04", "FAMILY-03", "FAMILY-02", "FAMILY-01", "CN-甲"]);
    assert.equal(decodeURIComponent(encodeURIComponent("CN-甲")), "CN-甲");
  } finally { await pool.end(); }
});

test("real PostgreSQL preserves a 32768-character Chinese keyset without persistent fixture changes", { skip: !enabled }, async () => {
  const root = join(homedir(), "Library/Application Support/BeautyB2B/pg17-b4-test");
  const owner = new pg.Client({ host: join(root, "socket"), port: 55432,
    user: userInfo().username, database: "beauty_b2b_catalog_test", connectionTimeoutMillis: 2_000 });
  const pool = readerPool();
  const firstCode = `${"甲".repeat(32_767)}A`;
  const secondCode = `${"甲".repeat(32_767)}B`;
  const ids = [id(9001), id(9002)];
  let inserted = false;
  let stage = "connect";
  try {
    await owner.connect();
    stage = "verify target";
    const target = (await owner.query(`SELECT current_database() AS db,
      current_setting('data_directory') AS data, current_setting('port') AS port`)).rows[0];
    assert.deepEqual(target, { db: "beauty_b2b_catalog_test", data: join(root, "data"), port: "55432" });
    assert.equal((await owner.query("SELECT count(*)::integer AS n FROM catalog_private.products WHERE id = ANY($1::uuid[])",
      [ids])).rows[0].n, 0);
    await owner.query(`INSERT INTO catalog_private.products (id, product_code, slug, product_type, status)
      VALUES ($1,$2,'f7-length-a','press-on','draft'), ($3,$4,'f7-length-b','press-on','draft')`,
    [ids[0], firstCode, ids[1], secondCode]);
    inserted = true;
    stage = "detail";
    const repository = repositoryFor(pool);
    assert.equal((await repository.getAdminProductByCode(firstCode)).basic.product_code, firstCode);
    assert.equal((await repository.getAdminProductById(ids[0])).basic.product_code, firstCode);
    stage = "first page";
    const query = { search: "甲".repeat(100), sort: "product_code_asc", limit: 1 };
    const first = await repository.listAdminProducts(query);
    assert.deepEqual(codes(first), [firstCode]);
    assert.ok(first.nextCursor && first.nextCursor.length < 1024);
    stage = "next page";
    const second = await repository.listAdminProducts({ ...query, cursor: first.nextCursor });
    assert.deepEqual(codes(second), [secondCode]);
    assert.equal(second.nextCursor, null);
    stage = "previous page";
    assert.deepEqual(codes(await repository.listAdminProducts({ ...query,
      cursor: second.previousCursor, direction: "before" })), [firstCode]);
    stage = "changed boundary";
    await owner.query("UPDATE catalog_private.products SET status='retired' WHERE id=$1::uuid", [ids[0]]);
    await assert.rejects(repository.listAdminProducts({ ...query, cursor: first.nextCursor }),
      { code: "INVALID_INPUT" });
    stage = "removed boundary";
    await owner.query("BEGIN");
    await owner.query("SET LOCAL session_replication_role = replica");
    await owner.query("DELETE FROM catalog_private.products WHERE id=$1::uuid", [ids[1]]);
    await owner.query("COMMIT");
    await assert.rejects(repository.listAdminProducts({ ...query,
      cursor: second.previousCursor, direction: "before" }), { code: "INVALID_INPUT" });
  } catch (error) {
    process.stderr.write(`Long Product Code PostgreSQL test failed at: ${stage}\n`);
    throw error;
  } finally {
    try {
      if (inserted) {
        await owner.query("BEGIN");
        // The foundation's soft-delete guard is bypassed only for these two
        // isolated synthetic rows in this dedicated test cluster.
        await owner.query("SET LOCAL session_replication_role = replica");
        await owner.query("DELETE FROM catalog_private.products WHERE id = ANY($1::uuid[])", [ids]);
        await owner.query("COMMIT");
      }
    } catch (cleanupError) {
      await owner.query("ROLLBACK").catch(() => {});
      throw cleanupError;
    } finally {
      await pool.end();
      await owner.end().catch(() => {});
    }
  }
});
