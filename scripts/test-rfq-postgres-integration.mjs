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
const databaseName = "rfq_integration_test";
const appRole = "rfq_api";
const auditRole = "rfq_test_auditor";

// Share URL validation with the local HTTP route; importing this runner never
// creates a Pool. The route requests the stricter exact-endpoint mode.
export function localTestConnection(raw, expectedRole) {
  return load("src/lib/rfq/local-connection").localTestConnection(raw, expectedRole);
}

function load(relativePath) {
  const filePath = path.resolve(root, relativePath.endsWith(".ts") ? relativePath : `${relativePath}.ts`);
  if (cache.has(filePath)) return cache.get(filePath).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    fileName: filePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  cache.set(filePath, record);
  const requireLocal = (specifier) => {
    if (specifier.startsWith("node:") || specifier === "pg") return nodeRequire(specifier);
    const target = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(filePath), specifier);
    return load(path.relative(root, target));
  };
  new Function("require", "exports", compiled)(requireLocal, record.exports);
  return record.exports;
}

function fixture(runId, index, product) {
  const variant = product.variants[0];
  const key = randomUUID();
  const number = `RFQ-B2C2-${runId}-${String(index).padStart(3, "0")}`;
  const draft = {
    contact: { fullName: "Integration Fixture", email: "buyer@example.invalid",
      companyName: "Fixture Company", country: "US" },
    requirements: "Synthetic integration test request only.",
    items: [{ productId: product.id, sku: variant.sku, quantity: 100 }],
  };
  const items = [{ ...draft.items[0], productName: product.name,
    productSlug: product.slug,
    selectedVariant: { id: variant.id, attributes: variant.attributes } }];
  return { key, number, draft, items };
}

function request(testCase, body = testCase.draft, key = testCase.key) {
  return new Request("http://127.0.0.1/api/rfq", { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body) });
}

async function counts(audit, key) {
  const result = await audit.query(`SELECT
    (SELECT count(*)::int FROM rfq_private.rfq_requests WHERE idempotency_key = $1) AS requests,
    (SELECT count(*)::int FROM rfq_private.rfq_items i
      JOIN rfq_private.rfq_requests r ON r.id = i.rfq_request_id
      WHERE r.idempotency_key = $1) AS items,
    (SELECT count(*)::int FROM rfq_private.rfq_notification_jobs j
      JOIN rfq_private.rfq_requests r ON r.id = j.rfq_request_id
      WHERE r.idempotency_key = $1) AS jobs`, [key]);
  return [result.rows[0].requests, result.rows[0].items, result.rows[0].jobs];
}

async function assertCounts(audit, key, expected) {
  assert.deepEqual(await counts(audit, key), expected);
}

async function expectKind(work, kind) {
  await assert.rejects(work, (error) => error?.kind === kind);
}

async function expectDenied(pool, sql) {
  await assert.rejects(() => pool.query(sql), (error) => error?.code === "42501");
}

async function save(repository, testCase, overrides = {}) {
  const write = { key: testCase.key, rfqNumber: testCase.number,
    fingerprint: "a".repeat(64), draft: testCase.draft, items: testCase.items, ...overrides };
  return repository.transaction(async (tx) => {
    const existing = await tx.findByKey(write.key);
    if (existing) return existing;
    const record = await tx.insertRequestIfAbsent(write);
    if (!record) return tx.findByKey(write.key);
    await tx.insertItems(record.id, write.items);
    await tx.insertNotificationJob(record.id);
    return record;
  });
}

async function main() {
  if (process.env.RFQ_RUN_PG_INTEGRATION !== "1") {
    console.log("RFQ PostgreSQL integration: disabled; no database operations");
    return;
  }
  // Both URLs are mandatory. Validation precedes Pool construction or DNS.
  const appConfig = localTestConnection(process.env.RFQ_TEST_DATABASE_URL, appRole);
  const auditConfig = localTestConnection(process.env.RFQ_TEST_AUDIT_DATABASE_URL, auditRole);
  if (appConfig.port !== auditConfig.port || appConfig.host !== auditConfig.host)
    throw new Error("TEST_CONFIGURATION_REJECTED");

  const { PostgreSQLRFQRepository } = load("src/lib/rfq/postgres-repository");
  const { createRFQHandler } = load("src/lib/rfq/api");
  const { mockProducts } = load("src/lib/catalog/mock-products");
  const runId = randomBytes(5).toString("hex").toUpperCase();
  const appA = new Pool(appConfig);
  const appB = new Pool(appConfig);
  const audit = new Pool(auditConfig);
  // An idle-pool error must not reach Node's default handler, which may print
  // driver details. Active-query failures are caught by the case runner.
  for (const pool of [appA, appB, audit]) pool.on("error", () => {});
  const repoA = new PostgreSQLRFQRepository(appA);
  const repoB = new PostgreSQLRFQRepository(appB);
  const guards = { trustedOrigin: () => true, allowRequest: () => true };
  const product = mockProducts[0];
  let caseName = "preflight";
  let passed = 0;
  console.log(`RFQ PostgreSQL integration run ${runId}; dedicated local database`);
  async function test(name, work) {
    caseName = name;
    await work();
    passed++;
    console.log(`PASS ${name}`);
  }

  try {
    await test("local role, database and effective grants", async () => {
      const appIdentity = (await appA.query("SELECT current_user AS user, current_database() AS database")).rows[0];
      const auditIdentity = (await audit.query("SELECT current_user AS user, current_database() AS database")).rows[0];
      assert.deepEqual(appIdentity, { user: appRole, database: databaseName });
      assert.deepEqual(auditIdentity, { user: auditRole, database: databaseName });
      const allowed = ["id", "rfq_number", "idempotency_key", "request_fingerprint", "status", "created_at"];
      const denied = ["full_name", "email", "company_name", "whatsapp", "website", "requirements"];
      for (const column of allowed) {
        const result = await appA.query("SELECT has_column_privilege(current_user, 'rfq_private.rfq_requests', $1, 'SELECT') AS yes", [column]);
        assert.equal(result.rows[0].yes, true);
      }
      for (const column of denied) {
        const result = await appA.query("SELECT has_column_privilege(current_user, 'rfq_private.rfq_requests', $1, 'SELECT') AS yes", [column]);
        assert.equal(result.rows[0].yes, false);
      }
      for (const column of ["id", "status", "created_at", "updated_at"]) {
        const result = await appA.query("SELECT has_column_privilege(current_user, 'rfq_private.rfq_requests', $1, 'INSERT') AS yes", [column]);
        assert.equal(result.rows[0].yes, false);
      }
      for (const column of ["rfq_number", "idempotency_key", "request_fingerprint", "full_name",
        "email", "company_name", "country", "whatsapp", "website", "buyer_type",
        "requirements", "customization", "purchase_timeline"]) {
        const result = await appA.query("SELECT has_column_privilege(current_user, 'rfq_private.rfq_requests', $1, 'INSERT') AS yes", [column]);
        assert.equal(result.rows[0].yes, true);
      }
      for (const [table, columns] of [["rfq_items", ["rfq_request_id", "product_id", "sku", "quantity", "product_snapshot"]],
        ["rfq_notification_jobs", ["rfq_request_id"]]]) {
        for (const column of columns) {
          const result = await appA.query("SELECT has_column_privilege(current_user, $1, $2, 'INSERT') AS yes",
            [`rfq_private.${table}`, column]);
          assert.equal(result.rows[0].yes, true);
        }
      }
      for (const table of ["rfq_requests", "rfq_items", "rfq_notification_jobs"]) {
        for (const privilege of ["UPDATE", "DELETE"]) {
          const result = await appA.query("SELECT has_table_privilege(current_user, $1, $2) AS yes",
            [`rfq_private.${table}`, privilege]);
          assert.equal(result.rows[0].yes, false);
        }
      }
      for (const [table, column] of [["rfq_items", "id"], ["rfq_items", "created_at"],
        ["rfq_notification_jobs", "id"], ["rfq_notification_jobs", "status"]]) {
        const result = await appA.query("SELECT has_column_privilege(current_user, $1, $2, 'INSERT') AS yes",
          [`rfq_private.${table}`, column]);
        assert.equal(result.rows[0].yes, false);
      }
      const schemaGrants = (await appA.query(`SELECT
        has_schema_privilege(current_user, 'rfq_private', 'USAGE') AS has_usage,
        has_schema_privilege(current_user, 'rfq_private', 'CREATE') AS has_create`)).rows[0];
      assert.deepEqual(schemaGrants, { has_usage: true, has_create: false });
      const role = (await audit.query(`SELECT r.rolsuper, r.rolbypassrls,
        (SELECT bool_and(c.relrowsecurity) FROM pg_class c
         WHERE c.oid IN ('rfq_private.rfq_requests'::regclass,
           'rfq_private.rfq_items'::regclass,
           'rfq_private.rfq_notification_jobs'::regclass)) AS rls
        FROM pg_roles r WHERE r.rolname = $1`, [appRole])).rows[0];
      assert.deepEqual(role, { rolsuper: false, rolbypassrls: false, rls: true });
      const auditorRole = (await audit.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1",
        [auditRole])).rows[0];
      assert.deepEqual(auditorRole, { rolsuper: false, rolbypassrls: false });
      await expectDenied(appA, "SELECT full_name FROM rfq_private.rfq_requests LIMIT 0");
      await expectDenied(appA, "SELECT email FROM rfq_private.rfq_requests LIMIT 0");
      await expectDenied(appA, "SELECT requirements FROM rfq_private.rfq_requests LIMIT 0");
      await expectDenied(appA, "SELECT id FROM rfq_private.rfq_items LIMIT 0");
      await expectDenied(appA, "SELECT id FROM rfq_private.rfq_notification_jobs LIMIT 0");
    });

    await test("three-table success", async () => {
      const f = fixture(runId, 1, product);
      const record = await save(repoA, f);
      assert.equal(record.rfqNumber, f.number);
      await assertCounts(audit, f.key, [1, 1, 1]);
    });

    await test("request failure rolls back", async () => {
      const f = fixture(runId, 2, product);
      await expectKind(() => save(repoA, f, { rfqNumber: "invalid" }), "UNEXPECTED_DATABASE_ERROR");
      await assertCounts(audit, f.key, [0, 0, 0]);
    });

    await test("item failure rolls back", async () => {
      const f = fixture(runId, 3, product);
      await expectKind(() => save(repoA, f, { items: [{ ...f.items[0], quantity: 0 }] }), "UNEXPECTED_DATABASE_ERROR");
      await assertCounts(audit, f.key, [0, 0, 0]);
    });

    await test("notification failure rolls back", async () => {
      const f = fixture(runId, 4, product);
      await expectKind(() => repoA.transaction(async (tx) => {
        const record = await tx.insertRequestIfAbsent({ key: f.key, rfqNumber: f.number,
          fingerprint: "a".repeat(64), draft: f.draft, items: f.items });
        await tx.insertItems(record.id, f.items);
        await tx.insertNotificationJob(record.id);
        await tx.insertNotificationJob(record.id);
      }), "UNEXPECTED_DATABASE_ERROR");
      await assertCounts(audit, f.key, [0, 0, 0]);
    });

    await test("idempotent replay, changed request and one job", async () => {
      const f = fixture(runId, 5, product);
      const handler = createRFQHandler({ catalog: [product], repository: repoA, guards,
        catalogVerified: true, number: () => f.number });
      const first = await handler(request(f));
      const replay = await handler(request(f));
      const conflict = await handler(request(f, { ...f.draft, requirements: "Different synthetic requirements." }));
      assert.deepEqual([first.status, replay.status, conflict.status], [201, 200, 409]);
      assert.equal((await replay.json()).replayed, true);
      await assertCounts(audit, f.key, [1, 1, 1]);
    });

    await test("two independent connections arbitrate the same key", async () => {
      const f = fixture(runId, 6, product);
      let arrivals = 0;
      let release;
      const gate = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("CONCURRENCY_BARRIER_TIMEOUT")), 5_000);
        release = () => { clearTimeout(timer); resolve(); };
      });
      function align(repository) {
        return { transaction: (work) => repository.transaction((tx) => {
          let first = true;
          return work({
            insertRequestIfAbsent: (write) => tx.insertRequestIfAbsent(write),
            insertItems: (id, items) => tx.insertItems(id, items),
            insertNotificationJob: (id) => tx.insertNotificationJob(id),
            findByKey: async (key) => {
              const result = await tx.findByKey(key);
              if (first) {
                first = false;
                if (++arrivals === 2) release();
                await gate;
              }
              return result;
            },
          });
        }) };
      }
      const a = createRFQHandler({ catalog: [product], repository: align(repoA), guards,
        catalogVerified: true, number: () => f.number });
      const b = createRFQHandler({ catalog: [product], repository: align(repoB), guards,
        catalogVerified: true, number: () => f.number });
      const [left, right] = await Promise.all([a(request(f)), b(request(f))]);
      assert.deepEqual([left.status, right.status].sort(), [200, 201]);
      const leftBody = await left.json();
      const rightBody = await right.json();
      assert.equal(leftBody.id, rightBody.id);
      await assertCounts(audit, f.key, [1, 1, 1]);
    });

    await test("RFQ number unique constraint remains independent", async () => {
      const first = fixture(runId, 7, product);
      const second = fixture(runId, 8, product);
      await save(repoA, first);
      await expectKind(() => save(repoB, second, { rfqNumber: first.number }), "RFQ_NUMBER_CONFLICT");
      await assertCounts(audit, first.key, [1, 1, 1]);
      await assertCounts(audit, second.key, [0, 0, 0]);
    });

    await test("retired product and SKU allow historical replay", async () => {
      const retiredProduct = fixture(runId, 9, product);
      const catalog = [product];
      const handler = createRFQHandler({ catalog, repository: repoA, guards,
        catalogVerified: true, number: () => retiredProduct.number });
      assert.equal((await handler(request(retiredProduct))).status, 201);
      catalog.length = 0;
      assert.equal((await handler(request(retiredProduct))).status, 200);
      const newProductKey = randomUUID();
      assert.equal((await handler(request(retiredProduct, retiredProduct.draft, newProductKey))).status, 422);
      await assertCounts(audit, retiredProduct.key, [1, 1, 1]);
      await assertCounts(audit, newProductKey, [0, 0, 0]);

      const retiredSku = fixture(runId, 10, product);
      const skuCatalog = [product];
      const skuHandler = createRFQHandler({ catalog: skuCatalog, repository: repoA, guards,
        catalogVerified: true, number: () => retiredSku.number });
      assert.equal((await skuHandler(request(retiredSku))).status, 201);
      skuCatalog[0] = { ...product, variants: product.variants.filter((v) => v.sku !== retiredSku.draft.items[0].sku) };
      assert.equal((await skuHandler(request(retiredSku))).status, 200);
      const newSkuKey = randomUUID();
      assert.equal((await skuHandler(request(retiredSku, retiredSku.draft, newSkuKey))).status, 422);
      await assertCounts(audit, retiredSku.key, [1, 1, 1]);
      await assertCounts(audit, newSkuKey, [0, 0, 0]);
    });

    await test("local connection fault safely fails", async () => {
      const unavailable = new Pool({ ...appConfig, port: 1, connectionTimeoutMillis: 500 });
      unavailable.on("error", () => {});
      try {
        const repo = new PostgreSQLRFQRepository(unavailable);
        await expectKind(() => repo.transaction(async (tx) => tx.findByKey(randomUUID())), "DATABASE_UNAVAILABLE");
      } finally { await unavailable.end(); }
    });

    console.log(`RFQ PostgreSQL integration: ${passed} passed; run ${runId}; dedicated local database only`);
  } catch {
    console.error(`RFQ PostgreSQL integration run ${runId} failed at ${caseName}; no connection details or buyer data printed`);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([appA.end(), appB.end(), audit.end()]);
  }
}

// Importing the module for static guard tests cannot open a connection.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("RFQ PostgreSQL integration configuration rejected; no connection details printed");
    process.exitCode = 1;
  });
}
