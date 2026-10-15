import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import pg from "pg";
import { parseCatalogCsvBundle } from "../src/lib/catalog-import/csv.ts";
import { PostgresCatalogImportTransaction, PostgresCatalogSnapshotReader, safeCatalogBigint,
  verifyLocalCatalogTestConnection } from "../src/lib/catalog-import/postgres.ts";
import { verifyCatalogActorContext } from "../src/lib/catalog-import/transaction.ts";

const url = process.env.CATALOG_IMPORT_TEST_DATABASE_URL;
const dataDir = process.env.CATALOG_IMPORT_TEST_DATA_DIR;
if (process.env.CATALOG_IMPORT_TEST_ENABLE !== "1" || !url || !dataDir) throw new Error("Explicit isolated catalog import test opt-in required");
const target = new URL(url);
if (target.protocol !== "postgresql:" || target.hostname !== "127.0.0.1" || target.port !== "55440"
  || target.pathname !== "/catalog_receipts_d2b_test" || target.username !== "catalog_d2b_owner"
  || target.password || target.search || target.hash)
  throw new Error("Refusing non-isolated test target");
const config = { connection_string: url, data_directory: dataDir, template_version: "catalog-attributes-v1", receipt_access_mode: "restricted_v1", lock_timeout_ms: 500, statement_timeout_ms: 5000 };
const owner = new pg.Client({ connectionString: url });
await owner.connect();
await verifyLocalCatalogTestConnection(owner, config);
const row = (await owner.query(`SELECT current_database() db, session_user username, host(inet_server_addr()) host,
  inet_server_port() port, current_setting('data_directory') data_dir, current_setting('listen_addresses') listens,
  to_regnamespace('rfq_private') rfq_schema`)).rows[0];
console.log(`LOCAL PREFLIGHT host=${row.host} port=${row.port} database=${row.db} user=${row.username} data_dir=${row.data_dir} listens=${row.listens}`);
if (row.db !== "catalog_receipts_d2b_test" || row.username !== "catalog_d2b_owner" || row.host !== "127.0.0.1"
  || row.port !== 55440 || row.listens !== "127.0.0.1" || fs.realpathSync(row.data_dir) !== fs.realpathSync(dataDir) || row.rfq_schema !== null)
  throw new Error("Isolated local database identity mismatch");
if ((await owner.query("SELECT to_regclass('catalog_private.catalog_import_receipts')::text AS receipt_table")).rows[0]?.receipt_table
  !== "catalog_private.catalog_import_receipts") {
  await owner.end();
  throw new Error("D2-B fresh isolated receipt fixture is required; no database cleanup or migration was executed");
}
const receiptAccess = (await owner.query(`SELECT
  to_regprocedure('catalog_private.lookup_catalog_import_receipt(text,text)')::text AS lookup_function,
  has_any_column_privilege('catalog_import','catalog_private.catalog_import_receipts','SELECT') AS import_direct_select,
  has_any_column_privilege('catalog_admin','catalog_private.catalog_import_receipts','SELECT') AS admin_direct_select`)).rows[0];
if (receiptAccess.lookup_function !== "catalog_private.lookup_catalog_import_receipt(text,text)"
  || receiptAccess.import_direct_select !== false || receiptAccess.admin_direct_select !== false)
  throw new Error("Restricted receipt access migration is required before isolated import tests");

const HEAD = {
  "products.csv": ["operation", "product_code", "slug", "product_type", "status", "oem", "odm", "attributes"],
  "product_variants.csv": ["operation", "product_code", "sku", "status", "attributes", "moq_quantity", "moq_unit", "order_multiple", "reference_price", "reference_currency"],
  "product_translations.csv": ["operation", "product_code", "locale", "name", "short_description", "description", "seo_title", "seo_description"],
  "product_categories.csv": ["operation", "product_code", "category_id", "is_primary", "sort_order"],
  "product_images.csv": ["operation", "product_code", "image_id", "sku", "storage_key", "public_url", "role", "status", "alt_en", "alt_zh"],
};
const cell = (value) => `"${(value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")).replaceAll('"', '""')}"`;
function parse(records, snapshot) {
  const files = Object.fromEntries(Object.entries(records).map(([name, values]) => [name,
    `${HEAD[name].join(",")}\n${values.map((value) => HEAD[name].map((key) => cell(value[key])).join(",")).join("\n")}\n`]));
  const result = parseCatalogCsvBundle(files, { knownProductCodes: new Set(snapshot.products.map((entry) => entry.product_code)) });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  return result;
}
const actor = await verifyCatalogActorContext("synthetic-test-session", async (session) => session === "synthetic-test-session"
  ? { actor_id: "synthetic-importer", role: "catalog_import" } : null);
const request = (snapshot, normalized_batch, key, other = {}) => ({ import_batch_id: `synthetic-${key}`, idempotency_key: key,
  expected_snapshot_version: snapshot.version, import_source: "csv", normalized_batch, actor_context: actor, ...other });
const draft = (code) => ({ operation: "create", product_code: code, slug: code.toLowerCase(), product_type: "press_on_nails" });
const sku = (code, key, status = "draft") => ({ operation: "create", product_code: code, sku: key, status,
  attributes: { nail_shape: "oval" }, moq_quantity: 50, moq_unit: "sets" });
const errorCode = (expected) => (error) => { assert.equal(error?.code, expected); return true; };
const adapter = new PostgresCatalogImportTransaction(config);
const reset = async (client = owner) => {
  await verifyLocalCatalogTestConnection(client, config);
  return client.query(`TRUNCATE catalog_private.catalog_import_receipts,
    catalog_private.product_images,catalog_private.product_translations,catalog_private.product_categories,
    catalog_private.product_variants,catalog_private.products,catalog_private.categories`);
};
const publishedRecords = (code, categoryId) => ({
  "products.csv": [{ ...draft(code), status: "published" }],
  "product_variants.csv": [sku(code, `${code}-1`, "published")],
  "product_translations.csv": ["en", "zh"].map((locale) => ({ operation: "create", product_code: code, locale,
    name: `Synthetic ${locale}`, short_description: "Short", description: "Detail", seo_title: "SEO", seo_description: "SEO detail" })),
  "product_categories.csv": [{ operation: "create", product_code: code, category_id: categoryId, is_primary: true }],
  "product_images.csv": [{ operation: "create", product_code: code, storage_key: `${code.toLowerCase()}.webp`,
    public_url: `/${code.toLowerCase()}.webp`, role: "primary", status: "published", alt_en: "Synthetic", alt_zh: "合成图" }],
});
const syntheticCategory = async (slug) => (await owner.query(`INSERT INTO catalog_private.categories(slug,status,name_en,name_zh)
  VALUES ($1,'published','Nails','美甲') RETURNING id`, [slug])).rows[0].id;
const failureTables = new Set(["products", "product_variants", "product_translations", "product_categories", "product_images", "catalog_import_receipts"]);
const failureBodies = { raise: "RAISE EXCEPTION 'synthetic failure';", duplicate_sku: "NEW.sku := 'SYN-EXISTING-SKU';", sleep: "PERFORM pg_sleep(1);" };
async function withFailTrigger(table, mode) {
  if (!failureTables.has(table) || !Object.hasOwn(failureBodies, mode)) throw new Error("Invalid local failure fixture");
  await owner.query(`CREATE OR REPLACE FUNCTION catalog_private.catalog_receipts_d2b_test_failure() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN ${failureBodies[mode]} RETURN NEW; END $$`);
  await owner.query(`CREATE TRIGGER catalog_receipts_d2b_test_failure BEFORE INSERT OR UPDATE ON catalog_private.${table}
    FOR EACH ROW EXECUTE FUNCTION catalog_private.catalog_receipts_d2b_test_failure()`);
}
async function dropFailTrigger(table) {
  if (!failureTables.has(table)) throw new Error("Invalid local failure fixture");
  await owner.query(`DROP TRIGGER IF EXISTS catalog_receipts_d2b_test_failure ON catalog_private.${table}`);
  await owner.query("DROP FUNCTION IF EXISTS catalog_private.catalog_receipts_d2b_test_failure()");
}

try {
  await test("isolated PostgreSQL transactional catalog import", async (t) => {
    await t.test("identity mismatch and cleanup target mismatch refuse writes", async () => {
      assert.throws(() => new PostgresCatalogImportTransaction({ ...config, data_directory: "/tmp/catalog-receipts-d2b-55440/data" }),
        errorCode("INVALID_REQUEST"));
      assert.throws(() => new PostgresCatalogImportTransaction({ ...config,
        connection_string: "postgresql://catalog_d2b_owner@127.0.0.1:55440/not_catalog_receipts_d2b_test" }), errorCode("INVALID_REQUEST"));
      let queries = 0;
      const wrong = { query: async () => { queries++; return { rows: [{ db: "catalog_receipts_d2b_test", username: "catalog_d2b_owner",
        host: "127.0.0.1", port: 55440, listens: "127.0.0.1", data_dir: dataDir,
        system_id: "wrong-cluster", rfq_schema: null }] }; } };
      await assert.rejects(reset(wrong), errorCode("PERMISSION_DENIED"));
      assert.equal(queries, 1, "TRUNCATE must not run after identity failure");
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.products")).rows[0].n, 0);
    });
    await t.test("field-level bigint conversion rejects overflow and precision loss", () => {
      assert.equal(safeCatalogBigint("9007199254740991", "moq"), Number.MAX_SAFE_INTEGER);
      assert.equal(safeCatalogBigint(null, "package"), null);
      assert.throws(() => safeCatalogBigint("9007199254740992", "moq"), errorCode("INVALID_REQUEST"));
      assert.throws(() => safeCatalogBigint("1.5", "moq"), errorCode("INVALID_REQUEST"));
    });
    await t.test("reader rejects a connection that bypassed the physical identity preflight", () => {
      assert.throws(() => new PostgresCatalogSnapshotReader(owner), errorCode("PERMISSION_DENIED"));
    });
    await t.test("draft create, SKU UUID, update, replay, conflict, no-op and stale version", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const batch = parse({ "products.csv": [draft("SYN-B2-A")], "product_variants.csv": [sku("SYN-B2-A", "SYN-B2-A-1")] }, before);
      const req = request(before, batch, "create-a");
      const result = await adapter.execute(req);
      assert.equal(result.status, "committed");
      assert.equal(result.product_count, 1);
      assert.equal(Object.keys(result.identity_map).length, 2);
      assert.ok(Object.values(result.identity_map).every((id) => /^[0-9a-f-]{36}$/.test(id)));
      const created = await adapter.readSnapshot();
      assert.equal(created.products.length, 1);
      assert.equal(created.variants[0].product_id, created.products[0].id);
      assert.equal(created.variants[0].moq_quantity, 50);
      assert.equal((await adapter.execute(req)).replayed, true);
      await assert.rejects(adapter.execute(request(before, parse({ "products.csv": [draft("SYN-B2-X")] }, before), "create-a")), errorCode("IDEMPOTENCY_CONFLICT"));
      await assert.rejects(adapter.execute(request(before, batch, "stale-a")), errorCode("SNAPSHOT_STALE"));
      const update = parse({ "products.csv": [{ operation: "update", product_code: "SYN-B2-A", oem: true }],
        "product_variants.csv": [{ operation: "update", product_code: "SYN-B2-A", sku: "SYN-B2-A-1", moq_quantity: 75,
          reference_price: "12.3400", reference_currency: "USD" }] }, created);
      await adapter.execute(request(created, update, "update-a"));
      const updated = await adapter.readSnapshot();
      assert.equal(updated.products[0].oem, true);
      assert.equal(updated.variants[0].moq_quantity, 75);
      assert.equal(updated.variants[0].reference_price, "12.3400");
      assert.equal(updated.variants[0].reference_currency, "USD");
      assert.match(updated.products[0].created_at, /^20\d\d-\d\d-\d\dT/);
      assert.equal(updated.products[0].id, created.products[0].id);
      const noOp = parse({ "products.csv": [{ operation: "update", product_code: "SYN-B2-A", oem: true }] }, updated);
      const noOpResult = await adapter.execute(request(updated, noOp, "noop-a"));
      assert.equal(noOpResult.status, "no_changes");
      assert.deepEqual(noOpResult.identity_map, {});
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 3);
    });
    await t.test("published create writes bilingual content, category and primary image", async () => {
      await reset();
      const categoryId = await syntheticCategory("synthetic-nails");
      const before = await adapter.readSnapshot();
      const records = publishedRecords("SYN-B2-P", categoryId);
      const result = await adapter.execute(request(before, parse(records, before), "publish-p"));
      assert.equal(result.status, "committed");
      assert.equal(Object.keys(result.identity_map).length, 3);
      const after = await adapter.readSnapshot();
      assert.equal(after.products[0].status, "published");
      assert.ok(after.products[0].published_at);
      assert.equal(after.variants[0].status, "published");
      assert.equal(after.translations.length, 2);
      assert.equal(after.product_categories[0].category_id, categoryId);
      assert.equal(after.images[0].product_id, after.products[0].id);
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_public.products")).rows[0].n, 1);
      const secondCategory = await syntheticCategory("synthetic-accessories");
      const withCategory = await adapter.readSnapshot();
      const associations = parse({
        "product_variants.csv": [{ ...sku("SYN-B2-P", "SYN-B2-P-2", "published"), attributes: { nail_shape: "almond" } }],
        "product_translations.csv": [{ operation: "update", product_code: "SYN-B2-P", locale: "zh", name: "合成产品新名称" }],
        "product_categories.csv": [{ operation: "create", product_code: "SYN-B2-P", category_id: secondCategory, is_primary: false }],
        "product_images.csv": [{ operation: "create", product_code: "SYN-B2-P", storage_key: "synthetic-detail.webp",
          public_url: "/synthetic-detail.webp", role: "detail", status: "published", alt_en: "Detail", alt_zh: "细节" }],
      }, withCategory);
      await adapter.execute(request(withCategory, associations, "associations-p"));
      const expanded = await adapter.readSnapshot();
      assert.equal(expanded.variants.length, 2);
      assert.equal(expanded.product_categories.length, 2);
      assert.equal(expanded.images.length, 2);
      assert.equal(expanded.translations.find((item) => item.locale === "zh").name, "合成产品新名称");
      assert.equal(expanded.products[0].status, "published");
    });
    await t.test("incomplete publication and forged actor cannot write", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await assert.rejects(adapter.execute(request(before, parse({ "products.csv": [{ ...draft("SYN-INCOMPLETE"), status: "published" }] }, before), "incomplete")), errorCode("BATCH_INVALID"));
      const forged = request(before, parse({ "products.csv": [draft("SYN-FORGED")] }, before), "forged",
        { actor_context: { actor_id: "synthetic-importer", role: "catalog_import" } });
      await assert.rejects(adapter.execute(forged), errorCode("PERMISSION_DENIED"));
      assert.equal((await adapter.readSnapshot()).products.length, 0);
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 0);
    });
    await t.test("SQL-like translation text is stored as data; receipt tokens reject raw content", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const suspicious = "Synthetic'); DROP TABLE catalog_private.products; --";
      const batch = parse({ "products.csv": [draft("SYN-SQL-TEXT")],
        "product_translations.csv": [{ operation: "create", product_code: "SYN-SQL-TEXT", locale: "en", name: suspicious }] }, before);
      await adapter.execute(request(before, batch, "safe-text"));
      const after = await adapter.readSnapshot();
      assert.equal(after.translations[0].name, suspicious);
      assert.equal(after.products.length, 1);
      await assert.rejects(adapter.execute(request(after, batch, "bad key; DROP TABLE products")), errorCode("INVALID_REQUEST"));
      const receipt = (await owner.query("SELECT result::text text FROM catalog_private.catalog_import_receipts")).rows[0].text;
      assert.equal(receipt.includes(suspicious), false);
    });
    await t.test("two connections serialize identical retry and stale distinct request", async () => {
      await reset();
      const second = new PostgresCatalogImportTransaction(config);
      try {
        const before = await adapter.readSnapshot();
        const batch = parse({ "products.csv": [draft("SYN-CONCURRENT")] }, before);
        const req = request(before, batch, "concurrent-same");
        const identical = await Promise.all([adapter.execute(req), second.execute(req)]);
        assert.deepEqual(identical.map((item) => item.replayed).sort(), [false, true]);
        assert.equal((await adapter.readSnapshot()).products.length, 1);
        const stale = request(before, batch, "concurrent-different");
        await assert.rejects(second.execute(stale), errorCode("SNAPSHOT_STALE"));
      } finally { await second.close(); }
    });
    await t.test("lost COMMIT acknowledgement returns unknown; same-key retry replays the committed receipt", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const batch = parse({ "products.csv": [draft("SYN-LOST-RESPONSE")] }, before);
      const req = request(before, batch, "lost-response");
      const unreliable = new PostgresCatalogImportTransaction(config);
      const originalConnect = unreliable.pool.connect.bind(unreliable.pool);
      unreliable.pool.connect = async () => {
        const client = await originalConnect();
        const originalQuery = client.query.bind(client);
        client.query = (...args) => {
          if (args[0] === "COMMIT") return originalQuery(...args).then(() => { throw new Error("synthetic lost acknowledgement"); });
          return originalQuery(...args);
        };
        return client;
      };
      try { await assert.rejects(unreliable.execute(req), errorCode("COMMIT_UNKNOWN")); }
      finally { await unreliable.close(); }
      assert.equal((await adapter.readSnapshot()).products.length, 1);
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 1);
      const replay = await adapter.execute(req);
      assert.equal(replay.replayed, true);
      assert.equal((await adapter.readSnapshot()).products.length, 1);
    });
    await t.test("category tree and translation changes invalidate the old snapshot", async () => {
      await reset();
      const categoryId = await syntheticCategory("concurrent-category");
      const initial = await adapter.readSnapshot();
      const records = publishedRecords("SYN-CATEGORY", categoryId);
      await adapter.execute(request(initial, parse(records, initial), "category-seed"));
      const beforeCategory = await adapter.readSnapshot();
      await owner.query("UPDATE catalog_private.categories SET name_en='Changed category' WHERE id=$1", [categoryId]);
      const batch = parse({ "products.csv": [{ operation: "update", product_code: "SYN-CATEGORY", oem: true }] }, beforeCategory);
      await assert.rejects(adapter.execute(request(beforeCategory, batch, "category-stale")), errorCode("SNAPSHOT_STALE"));
      const beforeTranslation = await adapter.readSnapshot();
      await owner.query("UPDATE catalog_private.product_translations SET name='Externally changed' WHERE locale='en'");
      const next = parse({ "products.csv": [{ operation: "update", product_code: "SYN-CATEGORY", odm: true }] }, beforeTranslation);
      await assert.rejects(adapter.execute(request(beforeTranslation, next, "translation-stale")), errorCode("SNAPSHOT_STALE"));
    });
    await t.test("SQL unique SKU conflict rolls back catalog and receipt", async () => {
      await reset();
      const first = await adapter.readSnapshot();
      await adapter.execute(request(first, parse({ "products.csv": [draft("SYN-EXISTING")],
        "product_variants.csv": [sku("SYN-EXISTING", "SYN-EXISTING-SKU")] }, first), "unique-seed"));
      const before = await adapter.readSnapshot();
      await withFailTrigger("product_variants", "duplicate_sku");
      try {
        const batch = parse({ "products.csv": [draft("SYN-UNIQUE")],
          "product_variants.csv": [sku("SYN-UNIQUE", "SYN-UNIQUE-SKU")] }, before);
        await assert.rejects(adapter.execute(request(before, batch, "unique-conflict")), errorCode("BATCH_INVALID"));
      } finally { await dropFailTrigger("product_variants"); }
      assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest);
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 1);
    });
    await t.test("RLS prevents anon and any existing RFQ role from catalog and receipt access", async () => {
      await reset();
      const rfqRoleExists = (await owner.query("SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rfq_api') AS exists")).rows[0].exists;
      if (!rfqRoleExists) console.log("rfq_api absent in isolated catalog cluster; RFQ table-level permissions are not tested");
      for (const role of rfqRoleExists ? ["anon", "rfq_api"] : ["anon"]) {
        if (role !== "anon" && role !== "rfq_api") throw new Error("Invalid local test role");
        await owner.query("BEGIN");
        try {
          await owner.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(owner.query("INSERT INTO catalog_private.products(product_code,slug,product_type) VALUES ('SYN-DENY','syn-deny','press_on_nails')"));
        } finally { await owner.query("ROLLBACK"); }
        await owner.query("BEGIN");
        try {
          await owner.query(`SET LOCAL ROLE ${role}`);
          await assert.rejects(owner.query("SELECT count(*) FROM catalog_private.catalog_import_receipts"));
        } finally { await owner.query("ROLLBACK"); }
      }
    });
    await t.test("catalog lock wait timeout rolls back without receipt", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const batch = parse({ "products.csv": [draft("SYN-LOCKED")] }, before);
      await owner.query("BEGIN");
      try {
        await owner.query("SELECT pg_advisory_xact_lock($1::bigint)", ["725604510131"]);
        await assert.rejects(adapter.execute(request(before, batch, "locked")), errorCode("TRANSACTION_TIMEOUT"));
      } finally { await owner.query("ROLLBACK"); }
      assert.equal((await adapter.readSnapshot()).products.length, 0);
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 0);
    });
    await t.test("each business write stage and receipt failure roll back atomically", async () => {
      const stages = ["products", "product_variants", "product_translations", "product_categories", "product_images", "catalog_import_receipts"];
      for (const [index, stage] of stages.entries()) {
        await reset();
        const categoryId = await syntheticCategory(`failure-category-${index}`);
        const before = await adapter.readSnapshot();
        await withFailTrigger(stage, "raise");
        try {
          const batch = parse(publishedRecords(`SYN-FAIL-${index}`, categoryId), before);
          await assert.rejects(adapter.execute(request(before, batch, `fail-${index}`)), errorCode("BATCH_INVALID"));
        } finally { await dropFailTrigger(stage); }
        const after = await adapter.readSnapshot();
        assert.equal(after.version.digest, before.version.digest, `${stage} changed state after rollback`);
        assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 0);
      }
    });
    await t.test("failed ROLLBACK discards the connection and leaves no partial data", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await withFailTrigger("products", "raise");
      const unreliable = new PostgresCatalogImportTransaction(config);
      const originalConnect = unreliable.pool.connect.bind(unreliable.pool);
      unreliable.pool.connect = async () => {
        const client = await originalConnect();
        const originalQuery = client.query.bind(client);
        client.query = (...args) => args[0] === "ROLLBACK"
          ? Promise.reject(new Error("synthetic rollback transport failure")) : originalQuery(...args);
        return client;
      };
      try {
        const batch = parse({ "products.csv": [draft("SYN-ROLLBACK-FAIL")] }, before);
        await assert.rejects(unreliable.execute(request(before, batch, "rollback-fail")), errorCode("BATCH_INVALID"));
        assert.equal(unreliable.pool.totalCount, 0, "failed connection must not return to the pool");
      } finally { await unreliable.close(); await dropFailTrigger("products"); }
      assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest);
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 0);
    });
    await t.test("bounded statement timeout rolls back and releases lock", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await withFailTrigger("products", "sleep");
      const short = new PostgresCatalogImportTransaction({ ...config, statement_timeout_ms: 100 });
      try {
        const batch = parse({ "products.csv": [draft("SYN-SLOW")] }, before);
        await assert.rejects(short.execute(request(before, batch, "slow")), errorCode("TRANSACTION_TIMEOUT"));
      } finally { await short.close(); await dropFailTrigger("products"); }
      assert.equal((await adapter.readSnapshot()).products.length, 0);
      const batch = parse({ "products.csv": [draft("SYN-RECOVER")] }, before);
      assert.equal((await adapter.execute(request(before, batch, "recover"))).status, "committed");
    });
    await t.test("overall transaction deadline prevents a slow write", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await withFailTrigger("products", "sleep");
      const short = new PostgresCatalogImportTransaction({ ...config, statement_timeout_ms: 1000, transaction_timeout_ms: 100 });
      try {
        const batch = parse({ "products.csv": [draft("SYN-DEADLINE")] }, before);
        await assert.rejects(short.execute(request(before, batch, "deadline")), errorCode("TRANSACTION_TIMEOUT"));
      } finally { await short.close(); await dropFailTrigger("products"); }
      assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest);
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n, 0);
    });
  });
} finally { await adapter.close(); await reset(); await owner.end(); }
