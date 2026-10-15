import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import pg from "pg";
import { parseCatalogCsvBundle } from "../src/lib/catalog-import/csv.ts";
import { PostgresCatalogImportTransaction, verifyLocalCatalogTestConnection } from "../src/lib/catalog-import/postgres.ts";
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
  throw new Error("Restricted receipt access migration is required before isolated concurrency tests");

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

const receiptCount = async () => (await owner.query("SELECT count(*)::integer n FROM catalog_private.catalog_import_receipts")).rows[0].n;
const productCount = async () => (await owner.query("SELECT count(*)::integer n FROM catalog_private.products")).rows[0].n;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function concurrent(first, second, expectedRejection = "SNAPSHOT_STALE") {
  const outcomes = await Promise.allSettled([first(), second()]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1, JSON.stringify(outcomes));
  assert.equal(outcomes.filter((item) => item.status === "rejected").length, 1);
  assert.equal(outcomes.find((item) => item.status === "rejected").reason.code, expectedRejection);
  return outcomes;
}
async function assertNoOrphans() {
  for (const [table, condition] of [
    ["product_variants", "v.product_id=p.id"],
    ["product_translations", "v.product_id=p.id"],
    ["product_categories", "v.product_id=p.id"],
    ["product_images", "v.product_id=p.id"],
  ]) {
    if (!new Set(["product_variants", "product_translations", "product_categories", "product_images"]).has(table)) throw new Error("Invalid fixture table");
    const row = (await owner.query(`SELECT count(*)::integer n FROM catalog_private.${table} v
      LEFT JOIN catalog_private.products p ON ${condition} WHERE p.id IS NULL`)).rows[0];
    assert.equal(row.n, 0, `${table} has orphan products`);
  }
  const wrongImageVariant = (await owner.query(`SELECT count(*)::integer n FROM catalog_private.product_images i
    JOIN catalog_private.product_variants v ON v.id=i.variant_id WHERE i.product_id<>v.product_id`)).rows[0].n;
  assert.equal(wrongImageVariant, 0);
}

try {
  await test("isolated PostgreSQL concurrency, idempotency and recovery", async (t) => {
    await t.test("two connections creating the same global SKU commit exactly once", async () => {
      await reset();
      const second = new PostgresCatalogImportTransaction(config);
      try {
        const before = await adapter.readSnapshot();
        const reqA = request(before, parse({ "products.csv": [draft("SYN-RACE-A")],
          "product_variants.csv": [sku("SYN-RACE-A", "SYN-GLOBAL-RACE")] }, before), "race-sku-a");
        const reqB = request(before, parse({ "products.csv": [draft("SYN-RACE-B")],
          "product_variants.csv": [sku("SYN-RACE-B", "SYN-GLOBAL-RACE")] }, before), "race-sku-b");
        await concurrent(() => adapter.execute(reqA), () => second.execute(reqB));
        const snapshot = await adapter.readSnapshot();
        assert.equal(snapshot.products.length, 1);
        assert.equal(snapshot.variants.filter((v) => v.sku === "SYN-GLOBAL-RACE").length, 1);
        assert.equal(await receiptCount(), 1);
        await assertNoOrphans();
      } finally { await second.close(); }
    });

    await t.test("competing product changes preserve the first committed UUID and reject stale update", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await adapter.execute(request(before, parse({ "products.csv": [draft("SYN-RACE-P")] }, before), "seed-product"));
      const seeded = await adapter.readSnapshot();
      const originalId = seeded.products[0].id;
      const second = new PostgresCatalogImportTransaction(config);
      try {
        const a = request(seeded, parse({ "products.csv": [{ operation: "update", product_code: "SYN-RACE-P", oem: true }] }, seeded), "product-oem");
        const b = request(seeded, parse({ "products.csv": [{ operation: "update", product_code: "SYN-RACE-P", odm: true }] }, seeded), "product-odm");
        await concurrent(() => adapter.execute(a), () => second.execute(b));
        const after = await adapter.readSnapshot();
        assert.equal(after.products[0].id, originalId);
        assert.notEqual(after.products[0].oem, after.products[0].odm);
        assert.equal(await receiptCount(), 2);
      } finally { await second.close(); }
    });

    await t.test("competing bilingual translation changes do not lose an update", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await adapter.execute(request(before, parse({ "products.csv": [draft("SYN-RACE-T")],
        "product_translations.csv": [{ operation: "create", product_code: "SYN-RACE-T", locale: "en", name: "Original" }] }, before), "seed-translation"));
      const seeded = await adapter.readSnapshot();
      const second = new PostgresCatalogImportTransaction(config);
      try {
        const make = (name, key) => request(seeded, parse({ "product_translations.csv": [
          { operation: "update", product_code: "SYN-RACE-T", locale: "en", name }] }, seeded), key);
        await concurrent(() => adapter.execute(make("First", "translation-a")), () => second.execute(make("Second", "translation-b")));
        const after = await adapter.readSnapshot();
        assert.ok(["First", "Second"].includes(after.translations[0].name));
        assert.equal(after.translations.length, 1);
        assert.equal(await receiptCount(), 2);
      } finally { await second.close(); }
    });

    await t.test("competing category associations preserve one primary and reject stale relation", async () => {
      await reset();
      const primary = await syntheticCategory("synthetic-primary");
      const extraA = await syntheticCategory("synthetic-extra-a");
      const extraB = await syntheticCategory("synthetic-extra-b");
      const before = await adapter.readSnapshot();
      await adapter.execute(request(before, parse(publishedRecords("SYN-RACE-C", primary), before), "seed-category"));
      const seeded = await adapter.readSnapshot();
      const second = new PostgresCatalogImportTransaction(config);
      try {
        const make = (category_id, key) => request(seeded, parse({ "product_categories.csv": [
          { operation: "create", product_code: "SYN-RACE-C", category_id, is_primary: false }] }, seeded), key);
        await concurrent(() => adapter.execute(make(extraA, "category-a")), () => second.execute(make(extraB, "category-b")));
        const after = await adapter.readSnapshot();
        assert.equal(after.product_categories.length, 2);
        assert.equal(after.product_categories.filter((x) => x.is_primary).length, 1);
        assert.equal(after.product_categories.find((x) => x.is_primary).category_id, primary);
        assert.equal(await receiptCount(), 2);
      } finally { await second.close(); }
    });

    await t.test("same actor and key across connections replay one result", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const req = request(before, parse({ "products.csv": [draft("SYN-REPLAY")] }, before), "same-key");
      const second = new PostgresCatalogImportTransaction(config);
      try {
        const results = await Promise.all([adapter.execute(req), second.execute(req)]);
        assert.deepEqual(results.map((x) => x.replayed).sort(), [false, true]);
        assert.equal(results[0].identity_map[Object.keys(results[0].identity_map)[0]],
          results[1].identity_map[Object.keys(results[1].identity_map)[0]]);
        assert.equal(await productCount(), 1);
        assert.equal(await receiptCount(), 1);
      } finally { await second.close(); }
    });

    await t.test("same actor and key with different content conflicts under concurrency", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const a = request(before, parse({ "products.csv": [draft("SYN-KEY-A")] }, before), "conflicting-key");
      const b = request(before, parse({ "products.csv": [draft("SYN-KEY-B")] }, before), "conflicting-key");
      const second = new PostgresCatalogImportTransaction(config);
      try {
        await concurrent(() => adapter.execute(a), () => second.execute(b), "IDEMPOTENCY_CONFLICT");
        assert.equal(await productCount(), 1);
        assert.equal(await receiptCount(), 1);
      } finally { await second.close(); }
    });

    await t.test("held advisory lock blocks import then releases for one commit", async () => {
      await reset();
      const holder = new pg.Client({ connectionString: url });
      await holder.connect();
      await verifyLocalCatalogTestConnection(holder, config);
      const before = await adapter.readSnapshot();
      const req = request(before, parse({ "products.csv": [draft("SYN-WAIT")] }, before), "wait-release");
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1::bigint)", ["725604510131"]);
      try {
        const attempt = adapter.execute(req);
        let settled = false;
        void attempt.finally(() => { settled = true; }).catch(() => {});
        await pause(100);
        assert.equal(settled, false);
        assert.equal(await productCount(), 0);
        await holder.query("COMMIT");
        assert.equal((await attempt).status, "committed");
        assert.equal(await productCount(), 1);
      } finally { await holder.query("ROLLBACK").catch(() => {}); await holder.end(); }
    });

    await t.test("lock wait timeout creates no receipt and the same key can retry", async () => {
      await reset();
      const holder = new pg.Client({ connectionString: url });
      await holder.connect();
      await verifyLocalCatalogTestConnection(holder, config);
      const before = await adapter.readSnapshot();
      const req = request(before, parse({ "products.csv": [draft("SYN-RETRY-WAIT")] }, before), "retry-wait");
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1::bigint)", ["725604510131"]);
      try {
        await assert.rejects(adapter.execute(req), errorCode("TRANSACTION_TIMEOUT"));
        assert.equal(await productCount(), 0);
        assert.equal(await receiptCount(), 0);
      } finally { await holder.query("ROLLBACK"); await holder.end(); }
      assert.equal((await adapter.execute(req)).status, "committed");
      assert.equal(await receiptCount(), 1);
    });

    await t.test("disconnecting the lock holder releases the lock without partial writes", async () => {
      await reset();
      const holder = new pg.Client({ connectionString: url });
      await holder.connect();
      await verifyLocalCatalogTestConnection(holder, config);
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1::bigint)", ["725604510131"]);
      const before = await adapter.readSnapshot();
      const req = request(before, parse({ "products.csv": [draft("SYN-ABORT-LOCK")] }, before), "abort-lock");
      const attempt = adapter.execute(req);
      try {
        await pause(100);
        assert.equal(await productCount(), 0);
        await holder.end();
        assert.equal((await attempt).status, "committed");
        assert.equal(await productCount(), 1);
        assert.equal(await receiptCount(), 1);
      } finally { await holder.end().catch(() => {}); }
    });

    await t.test("client response deadline does not license a new key; same-key retry replays", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const req = request(before, parse({ "products.csv": [draft("SYN-CLIENT-TIMEOUT")] }, before), "client-timeout");
      const attempt = adapter.execute(req);
      const first = await Promise.race([attempt.then(() => "committed"), pause(1).then(() => "client-timeout")]);
      assert.ok(["committed", "client-timeout"].includes(first));
      const completed = await attempt;
      assert.equal(completed.status, "committed");
      const replay = await adapter.execute(req);
      assert.equal(replay.replayed, true);
      assert.equal(await productCount(), 1);
      assert.equal(await receiptCount(), 1);
    });

    await t.test("committed receipt replays after a later product update", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const original = request(before, parse({ "products.csv": [draft("SYN-LATER")] }, before), "original-create");
      const first = await adapter.execute(original);
      const afterCreate = await adapter.readSnapshot();
      await adapter.execute(request(afterCreate, parse({ "products.csv": [
        { operation: "update", product_code: "SYN-LATER", oem: true }] }, afterCreate), "later-update"));
      const afterUpdate = await adapter.readSnapshot();
      assert.notEqual(afterUpdate.version.digest, first.snapshot_version.digest);
      const replay = await adapter.execute(original);
      assert.equal(replay.replayed, true);
      assert.equal(replay.snapshot_version.digest, first.snapshot_version.digest);
      assert.equal((await adapter.readSnapshot()).version.digest, afterUpdate.version.digest);
      assert.equal(await receiptCount(), 2);
    });

    await t.test("failure at each write stage, including receipt, rolls back all changes", async () => {
      const stages = ["products", "product_variants", "product_translations", "product_categories", "product_images", "catalog_import_receipts"];
      for (const [index, stage] of stages.entries()) {
        await reset();
        const categoryId = await syntheticCategory(`b3-failure-${index}`);
        const before = await adapter.readSnapshot();
        await withFailTrigger(stage, "raise");
        try {
          const batch = parse(publishedRecords(`SYN-B3-FAIL-${index}`, categoryId), before);
          await assert.rejects(adapter.execute(request(before, batch, `b3-fail-${index}`)), errorCode("BATCH_INVALID"));
        } finally { await dropFailTrigger(stage); }
        assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest);
        assert.equal(await receiptCount(), 0);
        await assertNoOrphans();
      }
    });

    await t.test("transaction timeout rolls back, then a retry with the original key succeeds", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await withFailTrigger("products", "sleep");
      const short = new PostgresCatalogImportTransaction({ ...config, statement_timeout_ms: 1000, transaction_timeout_ms: 100 });
      const req = request(before, parse({ "products.csv": [draft("SYN-TIMEOUT-RETRY")] }, before), "timeout-retry");
      try { await assert.rejects(short.execute(req), errorCode("TRANSACTION_TIMEOUT")); }
      finally { await short.close(); await dropFailTrigger("products"); }
      assert.equal(await productCount(), 0);
      assert.equal(await receiptCount(), 0);
      assert.equal((await adapter.execute(req)).status, "committed");
    });

    await t.test("terminated writer connection rolls back and releases the catalog lock", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      const req = request(before, parse({ "products.csv": [draft("SYN-KILLED-WRITER")] }, before), "killed-writer");
      await withFailTrigger("products", "sleep");
      const attempt = adapter.execute(req);
      let backendPid;
      try {
        for (let i = 0; i < 40 && !backendPid; i++) {
          const active = (await owner.query(`SELECT pid FROM pg_stat_activity
            WHERE datname='catalog_receipts_d2b_test' AND pid<>pg_backend_pid()
              AND state='active' AND query LIKE 'INSERT INTO catalog_private.products%'
            ORDER BY pid`)).rows;
          backendPid = active[0]?.pid;
          if (!backendPid) await pause(10);
        }
        assert.ok(backendPid, "expected the synthetic writer to be active");
        assert.equal((await owner.query("SELECT pg_terminate_backend($1) terminated", [backendPid])).rows[0].terminated, true);
        await assert.rejects(attempt, (error) => ["WRITE_FAILED", "TRANSACTION_TIMEOUT"].includes(error.code));
      } finally { await dropFailTrigger("products"); }
      assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest);
      assert.equal(await receiptCount(), 0);
      assert.equal((await adapter.execute(req)).status, "committed");
      assert.equal(await receiptCount(), 1);
    });

    await t.test("database uniqueness rejects reused product code and SKU", async () => {
      await reset();
      const before = await adapter.readSnapshot();
      await adapter.execute(request(before, parse({ "products.csv": [draft("SYN-UNIQUE-ONE")],
        "product_variants.csv": [sku("SYN-UNIQUE-ONE", "SYN-UNIQUE-SKU")] }, before), "unique-one"));
      await assert.rejects(owner.query(`INSERT INTO catalog_private.products(product_code,slug,product_type)
        VALUES ($1,$2,'press_on_nails')`, ["SYN-UNIQUE-ONE", "synthetic-other-slug"]), (error) => error.code === "23505");
      const other = (await owner.query(`INSERT INTO catalog_private.products(product_code,slug,product_type)
        VALUES ($1,$2,'press_on_nails') RETURNING id`, ["SYN-UNIQUE-TWO", "synthetic-unique-two"])).rows[0].id;
      await assert.rejects(owner.query(`INSERT INTO catalog_private.product_variants(product_id,sku,moq_quantity,moq_unit)
        VALUES ($1,$2,50,'sets')`, [other, "SYN-UNIQUE-SKU"]), (error) => error.code === "23505");
      assert.equal((await owner.query("SELECT count(*)::integer n FROM catalog_private.product_variants")).rows[0].n, 1);
      assert.equal(await receiptCount(), 1);
      await assertNoOrphans();
    });

    await t.test("published content is complete and retired import cannot reactivate", async () => {
      await reset();
      const categoryId = await syntheticCategory("synthetic-integrity");
      const before = await adapter.readSnapshot();
      await adapter.execute(request(before, parse(publishedRecords("SYN-INTEGRITY", categoryId), before), "integrity-published"));
      const published = await adapter.readSnapshot();
      assert.equal(published.products[0].status, "published");
      assert.equal(published.variants.filter((v) => v.status === "published").length, 1);
      assert.equal(published.translations.length, 2);
      assert.equal(published.images.filter((i) => i.role === "primary" && i.status === "published" && i.alt_en && i.alt_zh).length, 1);
      assert.equal(published.product_categories.filter((c) => c.is_primary).length, 1);
      const originalId = published.products[0].id;
      const originalSkuId = published.variants[0].id;
      const imageBatch = parse({ "product_images.csv": [{ operation: "create", product_code: "SYN-INTEGRITY",
        sku: "SYN-INTEGRITY-1", storage_key: "synthetic-sku-detail.webp", public_url: "/synthetic-sku-detail.webp",
        role: "detail", status: "published", alt_en: "SKU detail", alt_zh: "规格详情" }] }, published);
      await adapter.execute(request(published, imageBatch, "sku-image"));
      const withImage = await adapter.readSnapshot();
      assert.equal(withImage.products[0].id, originalId);
      assert.equal(withImage.variants[0].id, originalSkuId);
      assert.equal(withImage.images.find((i) => i.storage_key === "synthetic-sku-detail.webp").variant_id, originalSkuId);
      await assertNoOrphans();
      const retiredBatch = parse({ "products.csv": [{ operation: "update", product_code: "SYN-INTEGRITY", status: "retired" }],
        "product_variants.csv": [{ operation: "update", product_code: "SYN-INTEGRITY", sku: "SYN-INTEGRITY-1", status: "retired" }] }, withImage);
      await adapter.execute(request(withImage, retiredBatch, "retire"));
      const retired = await adapter.readSnapshot();
      assert.equal(retired.products[0].status, "retired");
      const reactivate = parse({ "products.csv": [{ operation: "update", product_code: "SYN-INTEGRITY", status: "draft" }] }, retired);
      await assert.rejects(adapter.execute(request(retired, reactivate, "reactivate")), errorCode("BATCH_INVALID"));
      assert.equal((await adapter.readSnapshot()).products[0].status, "retired");
    });
  });
} finally { await adapter.close(); await reset(); await owner.end(); }
