import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const cache = new Map();
const published = "11111111-1111-4111-8111-111111111111";
const variant = "22222222-2222-4222-8222-222222222222";
const draftProduct = "33333333-3333-4333-8333-333333333333";
const sku = "SYN-C4-SET-001";

// Import the actual B2 SQL/transaction adapter, P3 API, and PostgreSQL writer.
function load(relativePath) {
  const file = path.resolve(root, relativePath.endsWith(".ts") ? relativePath : `${relativePath}.ts`);
  if (cache.has(file)) return cache.get(file).exports;
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  cache.set(file, record);
  const requireLocal = (specifier) => {
    if (specifier.startsWith("node:") || specifier === "pg") return nodeRequire(specifier);
    const target = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2))
      : path.resolve(path.dirname(file), specifier);
    return load(path.relative(root, target));
  };
  new Function("require", "exports", source)(requireLocal, record.exports);
  return record.exports;
}

const { createRFQHandler } = load("src/lib/rfq/api");
const { PostgreSQLRFQRepository } = load("src/lib/rfq/postgres-repository");
const { createRFQPublicCatalogReader, createRFQPublicReadSnapshot,
  RFQ_PUBLIC_PRODUCTS_SQL, RFQ_PUBLIC_VARIANTS_SQL, RFQ_PUBLIC_TRANSLATIONS_SQL
} = load("src/lib/rfq/catalog-public-postgres");

function draft(quantity, productId = published, productSku = sku) {
  return { contact: { fullName: "Synthetic Buyer", email: "buyer@example.invalid",
    companyName: "Synthetic Company", country: "US" },
    requirements: "Synthetic C4 PostgreSQL integration request only.",
    items: [{ productId, sku: productSku, quantity }] };
}
function request(body, key) {
  return new Request("https://synthetic.invalid/api/rfq", { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key,
      Origin: "https://synthetic.invalid" }, body: JSON.stringify(body) });
}
function clientPool(role, password, port) {
  const pool = new Pool({ host: "127.0.0.1", port, database: "rfq_integration_test",
    user: role, password, ssl: false, max: 2, connectionTimeoutMillis: 3000,
    query_timeout: 5000, idleTimeoutMillis: 5000, application_name: "rfq_c4_local_test" });
  pool.on("error", () => {});
  return pool;
}
function realCatalog(pool, trace) {
  const snapshot = createRFQPublicReadSnapshot(async () => {
    const client = await pool.connect();
    return { query: async (sql, values = []) => {
      trace.push(sql);
      return client.query(sql, [...values]);
    }, release: (destroy) => client.release(destroy) };
  });
  return createRFQPublicCatalogReader(snapshot);
}
async function denied(pool, sql) {
  await assert.rejects(() => pool.query(sql), (error) => error?.code === "42501");
}
async function persisted(audit, key) {
  return (await audit.query(`SELECT r.id AS request_id, r.rfq_number, r.idempotency_key,
    i.rfq_request_id AS item_request_id, i.product_id, i.sku, i.quantity,
    i.product_snapshot, j.rfq_request_id AS job_request_id
    FROM rfq_private.rfq_requests r
    JOIN rfq_private.rfq_items i ON i.rfq_request_id = r.id
    JOIN rfq_private.rfq_notification_jobs j ON j.rfq_request_id = r.id
    WHERE r.idempotency_key = $1`, [key])).rows;
}
async function count(audit, table) {
  const allowed = new Set(["rfq_requests", "rfq_items", "rfq_notification_jobs"]);
  assert(allowed.has(table));
  return Number((await audit.query(`SELECT count(*) AS total FROM rfq_private.${table}`)).rows[0].total);
}
async function main() {
  if (process.env.RFQ_C4_RUN !== "1") {
    console.log("RFQ C4 PostgreSQL integration: disabled; no database operations");
    return;
  }
  const testRoot = process.env.RFQ_C4_TEST_ROOT;
  const port = Number(process.env.RFQ_C4_PORT);
  if (!testRoot || !path.isAbsolute(testRoot) || testRoot.startsWith(root + path.sep)
    || !Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("LOCAL_TEST_CONFIGURATION_REJECTED");
  const credentials = JSON.parse(fs.readFileSync(path.join(testRoot, "credentials.json"), "utf8"));
  const catalogPool = clientPool("rfq_catalog_public_reader_runtime", credentials.catalog, port);
  const writerPool = clientPool("rfq_api", credentials.writer, port);
  const auditPool = clientPool("rfq_test_auditor", credentials.auditor, port);
  const pools = [catalogPool, writerPool, auditPool];
  const trace = [];
  const catalog = realCatalog(catalogPool, trace);
  const repository = new PostgreSQLRFQRepository(writerPool);
  const runId = randomBytes(5).toString("hex").toUpperCase();
  let number = 0;
  const handler = createRFQHandler({ catalog: [], trustedCatalog: catalog,
    catalogVerified: true, repository,
    guards: { trustedOrigin: () => true, allowRequest: () => true },
    number: () => `RFQ-C4-${runId}-${String(++number).padStart(3, "0")}` });
  let passed = 0;
  let caseName = "preflight";
  async function test(name, work) {
    caseName = name;
    await work();
    passed++;
    console.log(`PASS ${name}`);
  }
  console.log(`RFQ C4 run ${runId}; local PostgreSQL ${port}; synthetic records only`);
  try {
    await test("verified cluster identity and three distinct roles", async () => {
      for (const [pool, role] of [[catalogPool, "rfq_catalog_public_reader_runtime"],
        [writerPool, "rfq_api"], [auditPool, "rfq_test_auditor"]]) {
        const row = (await pool.query(`SELECT current_user, current_database(),
          host(inet_server_addr()) AS host, inet_server_port() AS port,
          current_setting('server_version') AS version`)).rows[0];
        assert.equal(row.current_user, role);
        assert.equal(row.current_database, "rfq_integration_test");
        assert.equal(row.host, "127.0.0.1");
        assert.equal(row.port, port);
        assert.match(row.version, /^17\.11/);
      }
    });
    await test("effective grants, RLS and forbidden data access", async () => {
      const privileges = (await catalogPool.query(`SELECT
        has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
        has_database_privilege(current_user,current_database(),'TEMPORARY') AS db_temp,
        has_schema_privilege(current_user,'catalog_private','USAGE') AS private_usage,
        has_schema_privilege(current_user,'rfq_private','USAGE') AS rfq_usage`)).rows[0];
      assert.deepEqual(privileges, { db_create: false, db_temp: false,
        private_usage: false, rfq_usage: false });
      for (const pool of pools) {
        const rights = (await pool.query(`SELECT
          has_database_privilege(current_user,current_database(),'CREATE') AS db_create,
          has_database_privilege(current_user,current_database(),'TEMPORARY') AS db_temp`)).rows[0];
        assert.deepEqual(rights, { db_create: false, db_temp: false });
      }
      const rls = (await auditPool.query(`SELECT count(*)::integer AS n FROM pg_class c
        JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rfq_private'
        AND c.relkind='r' AND c.relrowsecurity`)).rows[0].n;
      assert.equal(rls, 3);
      await denied(catalogPool, "SELECT * FROM catalog_private.products LIMIT 0");
      await denied(catalogPool, "SELECT * FROM rfq_private.rfq_requests LIMIT 0");
      await denied(catalogPool, "SELECT product_code FROM catalog_public.products LIMIT 0");
      await denied(writerPool, "SELECT * FROM catalog_private.products LIMIT 0");
      await denied(writerPool, "SELECT * FROM catalog_public.products LIMIT 0");
      await denied(writerPool, "SELECT email FROM rfq_private.rfq_requests LIMIT 0");
      await denied(auditPool, "SELECT email FROM rfq_private.rfq_requests LIMIT 0");
      await denied(auditPool, "SELECT requirements FROM rfq_private.rfq_requests LIMIT 0");
      await denied(auditPool, "SELECT * FROM catalog_private.products LIMIT 0");
      await denied(auditPool, "UPDATE rfq_private.rfq_requests SET status='reviewed' WHERE false");
    });
    await test("real B2 read sees published product and three-view transaction", async () => {
      const products = await catalog.getPublishedProductsByIds([published]);
      assert.equal(products.length, 1);
      assert.equal(products[0].id, published);
      assert.equal(products[0].variants.length, 1);
      assert.deepEqual(products[0].variants[0], { id: variant, sku,
        attributes: { color: "synthetic-blue" }, moq: { quantity: 100, unit: "sets" } });
      assert.equal(products[0].translations.en.value.name, "Synthetic Nail Set");
      assert.equal(products[0].translations.zh.value.name, "合成甲片套装");
      assert.deepEqual(trace.slice(-6), [
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
        "SET LOCAL statement_timeout = 5000",
        RFQ_PUBLIC_PRODUCTS_SQL, RFQ_PUBLIC_VARIANTS_SQL,
        RFQ_PUBLIC_TRANSLATIONS_SQL, "COMMIT",
      ]);
      assert(!trace.some((sql) => /catalog_private|catalog_admin/i.test(sql)));
      const visible = (await catalogPool.query("SELECT id FROM catalog_public.products ORDER BY id")).rows;
      assert.deepEqual(visible, [{ id: published }]);
      const visibleVariants = (await catalogPool.query("SELECT id FROM catalog_public.product_variants ORDER BY id")).rows;
      assert.deepEqual(visibleVariants, [{ id: variant }]);
      await assert.rejects(() => catalog.getPublishedProductsByIds([draftProduct]),
        (error) => error?.code === "NOT_FOUND");
      await assert.rejects(() => catalog.getPublishedProductsByIds(Array(21).fill(published)),
        (error) => error?.code === "INVALID_INPUT");
    });
    const submitted = [];
    await test("below, equal and above MOQ persist actual public-view snapshots", async () => {
      for (const quantity of [50, 100, 150]) {
        const key = randomUUID();
        const body = draft(quantity);
        const response = await handler(request(body, key));
        assert.equal(response.status, 201);
        const receipt = await response.json();
        const rows = await persisted(auditPool, key);
        assert.equal(rows.length, 1);
        const row = rows[0];
        assert.equal(row.request_id, receipt.id);
        assert.equal(row.rfq_number, receipt.rfqNumber);
        assert.equal(row.item_request_id, receipt.id);
        assert.equal(row.job_request_id, receipt.id);
        assert.equal(row.product_id, published);
        assert.equal(row.sku, sku);
        assert.equal(Number(row.quantity), quantity);
        assert.deepEqual(row.product_snapshot, {
          productName: { en: "Synthetic Nail Set", zh: "合成甲片套装" },
          productSlug: "synthetic-nail-set",
          selectedVariant: { id: variant, attributes: { color: "synthetic-blue" } },
          moqAtSubmission: 100, moqUnitAtSubmission: "sets", belowMoq: quantity < 100,
        });
        submitted.push({ key, body, receipt });
        console.log(`PERSISTED quantity=${quantity} moq=100 belowMoq=${quantity < 100} request=${receipt.rfqNumber}`);
      }
    });
    await test("replay skips current Catalog; changed content conflicts", async () => {
      const { key, body, receipt } = submitted[0];
      const priorQueries = trace.length;
      const replay = await handler(request(body, key));
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).id, receipt.id);
      const conflict = await handler(request({ ...body, requirements: "Changed synthetic text." }, key));
      assert.equal(conflict.status, 409);
      assert.equal(trace.length, priorQueries);
      assert.equal((await persisted(auditPool, key)).length, 1);
    });
    await test("draft, unpublished variant, wrong SKU and forged MOQ cannot write", async () => {
      for (const body of [draft(50, draftProduct, "SYN-C4-DRAFT-001"),
        draft(50, published, "SYN-C4-DRAFT-VAR"), draft(50, published, "WRONG"),
        { ...draft(50), items: [{ productId: published, sku, quantity: 50,
          moqAtSubmission: 1, belowMoq: false }] }]) {
        const key = randomUUID();
        assert.equal((await handler(request(body, key))).status, 422);
        assert.deepEqual(await persisted(auditPool, key), []);
      }
    });
    await test("real Catalog connection failure closes without writes", async () => {
      const unavailablePool = clientPool("rfq_catalog_public_reader_runtime", credentials.catalog, 1);
      try {
        const failing = createRFQHandler({ catalog: [], trustedCatalog: realCatalog(unavailablePool, []),
          catalogVerified: true, repository,
          guards: { trustedOrigin: () => true, allowRequest: () => true },
          number: () => `RFQ-C4-${runId}-UNAVAILABLE` });
        const key = randomUUID();
        assert.equal((await failing(request(draft(50), key))).status, 503);
        assert.deepEqual(await persisted(auditPool, key), []);
      } finally { await unavailablePool.end(); }
    });
    await test("notification-stage failure rolls back request, item and job", async () => {
      const failingRepository = { transaction: (work) => repository.transaction((tx) => work({
        findByKey: (key) => tx.findByKey(key),
        insertRequestIfAbsent: (write) => tx.insertRequestIfAbsent(write),
        insertItems: (id, items) => tx.insertItems(id, items),
        insertNotificationJob: async (id) => {
          await tx.insertNotificationJob(id);
          throw new Error("SYNTHETIC_ABORT_AFTER_REAL_INSERT");
        },
      })) };
      const failing = createRFQHandler({ catalog: [], trustedCatalog: catalog,
        catalogVerified: true, repository: failingRepository,
        guards: { trustedOrigin: () => true, allowRequest: () => true },
        number: () => `RFQ-C4-${runId}-FAIL` });
      const key = randomUUID();
      assert.equal((await failing(request(draft(50), key))).status, 503);
      assert.deepEqual(await persisted(auditPool, key), []);
    });
    await test("final request, item and notification counts match", async () => {
      assert.deepEqual(await Promise.all(["rfq_requests", "rfq_items", "rfq_notification_jobs"]
        .map((table) => count(auditPool, table))), [3, 3, 3]);
    });
    console.log(`RFQ C4 integration: ${passed} passed; run ${runId}; 3 committed synthetic requests`);
  } catch (error) {
    console.error(`RFQ C4 failed at ${caseName}: ${error?.code ?? error?.name ?? "ERROR"}`);
    process.exitCode = 1;
  } finally { await Promise.allSettled(pools.map((pool) => pool.end())); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`RFQ C4 configuration rejected: ${error?.code ?? error?.name ?? "ERROR"}`);
    process.exitCode = 1;
  });
}
