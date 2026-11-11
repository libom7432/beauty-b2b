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
const productId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const sku = "SYN-F4-SET-001";

// The runner imports the real RFQ API, B2 row mapper, and PostgreSQL writer.
// This loader does not initialize a database connection.
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
    const target = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2))
      : path.resolve(path.dirname(filePath), specifier);
    return load(path.relative(root, target));
  };
  new Function("require", "exports", compiled)(requireLocal, record.exports);
  return record.exports;
}

const { localTestConnection } = load("src/lib/rfq/local-connection");
const { createRFQHandler } = load("src/lib/rfq/api");
const { PostgreSQLRFQRepository, serializeRFQProductSnapshot } = load("src/lib/rfq/postgres-repository");
const { createRFQPublicCatalogReader, RFQ_PUBLIC_PRODUCTS_SQL, RFQ_PUBLIC_VARIANTS_SQL,
  RFQ_PUBLIC_TRANSLATIONS_SQL } = load("src/lib/rfq/catalog-public-postgres");

function syntheticCatalog() {
  const state = { available: true, selects: 0 };
  const source = createRFQPublicCatalogReader(async (work) => work({
    async select(sql, values) {
      state.selects++;
      assert.deepEqual(values[0], [productId]);
      if (sql === RFQ_PUBLIC_PRODUCTS_SQL)
        return state.available ? [{ id: productId, slug: "synthetic-nail-set" }] : [];
      if (sql === RFQ_PUBLIC_VARIANTS_SQL)
        return [{ id: variantId, product_id: productId, sku,
          attributes: { color: "synthetic-blue" }, moq_quantity: "100", moq_unit: "sets" }];
      if (sql === RFQ_PUBLIC_TRANSLATIONS_SQL)
        return [{ product_id: productId, locale: "en", name: "Synthetic Nail Set" },
          { product_id: productId, locale: "zh", name: "合成甲片套装" }];
      throw new Error("UNEXPECTED_SYNTHETIC_CATALOG_QUERY");
    },
  }));
  return { state, source };
}

function draft(quantity) {
  return { contact: { fullName: "Synthetic Buyer", email: "buyer@example.invalid",
    companyName: "Synthetic Company", country: "US" },
    requirements: "Synthetic PostgreSQL MOQ persistence test only.",
    items: [{ productId, sku, quantity }] };
}

function request(body, key) {
  return new Request("https://synthetic.invalid/api/rfq", { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key,
      Origin: "https://synthetic.invalid" }, body: JSON.stringify(body) });
}

async function readPersisted(audit, key) {
  return (await audit.query(`SELECT r.id AS request_id, r.rfq_number, r.idempotency_key,
    i.rfq_request_id AS item_request_id, i.product_id, i.sku, i.quantity,
    i.product_snapshot, j.rfq_request_id AS job_request_id
    FROM rfq_private.rfq_requests r
    JOIN rfq_private.rfq_items i ON i.rfq_request_id = r.id
    JOIN rfq_private.rfq_notification_jobs j ON j.rfq_request_id = r.id
    WHERE r.idempotency_key = $1`, [key])).rows;
}

async function countRequests(audit, key) {
  return Number((await audit.query(
    "SELECT count(*) AS total FROM rfq_private.rfq_requests WHERE idempotency_key = $1", [key]
  )).rows[0].total);
}

async function main() {
  if (process.env.RFQ_RUN_PG_MOQ_INTEGRATION !== "1") {
    console.log("RFQ trusted MOQ PostgreSQL integration: disabled; no database operations");
    return;
  }
  const appConfig = localTestConnection(process.env.RFQ_TEST_DATABASE_URL, "rfq_api");
  const auditConfig = localTestConnection(process.env.RFQ_TEST_AUDIT_DATABASE_URL, "rfq_test_auditor");
  if (appConfig.host !== "127.0.0.1" || appConfig.host !== auditConfig.host ||
      appConfig.port !== auditConfig.port || appConfig.database !== auditConfig.database)
    throw new Error("TEST_CONFIGURATION_REJECTED");
  const app = new Pool(appConfig);
  const audit = new Pool(auditConfig);
  for (const pool of [app, audit]) pool.on("error", () => {});
  const repository = new PostgreSQLRFQRepository(app);
  const catalog = syntheticCatalog();
  const runId = randomBytes(5).toString("hex").toUpperCase();
  let number = 0;
  const handler = createRFQHandler({ catalog: [], trustedCatalog: catalog.source,
    catalogVerified: true, repository,
    guards: { trustedOrigin: () => true, allowRequest: () => true },
    number: () => `RFQ-F4-${runId}-${String(++number).padStart(3, "0")}` });
  let caseName = "preflight";
  let passed = 0;
  async function test(name, work) {
    caseName = name;
    await work();
    passed++;
    console.log(`PASS ${name}`);
  }
  console.log(`RFQ trusted MOQ PostgreSQL run ${runId}; dedicated local database`);
  try {
    await test("role identity and denied contact reads", async () => {
      for (const [pool, role] of [[app, "rfq_api"], [audit, "rfq_test_auditor"]]) {
        const identity = (await pool.query("SELECT current_user, current_database(), host(inet_server_addr()) AS host, inet_server_port() AS port")).rows[0];
        assert.deepEqual(identity, { current_user: role, current_database: "rfq_integration_test",
          host: "127.0.0.1", port: appConfig.port });
      }
      await assert.rejects(() => audit.query("SELECT email FROM rfq_private.rfq_requests LIMIT 0"),
        (error) => error?.code === "42501");
      await assert.rejects(() => app.query("SELECT email FROM rfq_private.rfq_requests LIMIT 0"),
        (error) => error?.code === "42501");
    });

    const submitted = [];
    await test("below, equal and above MOQ persist trusted JSONB snapshots", async () => {
      for (const quantity of [50, 100, 150]) {
        const key = randomUUID();
        const body = draft(quantity);
        const response = await handler(request(body, key));
        assert.equal(response.status, 201);
        const receipt = await response.json();
        const rows = await readPersisted(audit, key);
        assert.equal(rows.length, 1);
        const row = rows[0];
        assert.equal(row.request_id, receipt.id);
        assert.equal(row.rfq_number, receipt.rfqNumber);
        assert.equal(row.idempotency_key, key);
        assert.equal(row.item_request_id, receipt.id);
        assert.equal(row.job_request_id, receipt.id);
        assert.equal(row.product_id, productId);
        assert.equal(row.sku, sku);
        assert.equal(Number(row.quantity), quantity);
        assert.deepEqual(row.product_snapshot, {
          productName: { en: "Synthetic Nail Set", zh: "合成甲片套装" },
          productSlug: "synthetic-nail-set",
          selectedVariant: { id: variantId, attributes: { color: "synthetic-blue" } },
          moqAtSubmission: 100, moqUnitAtSubmission: "sets", belowMoq: quantity < 100,
        });
        submitted.push({ key, body, receipt });
      }
    });

    await test("replay and changed-content conflict skip the current catalog", async () => {
      const { key, body, receipt } = submitted[0];
      catalog.state.available = false;
      const priorSelects = catalog.state.selects;
      const replay = await handler(request(body, key));
      assert.equal(replay.status, 200);
      assert.equal((await replay.json()).id, receipt.id);
      const conflict = await handler(request({ ...body, requirements: "Different synthetic requirements." }, key));
      assert.equal(conflict.status, 409);
      assert.equal(catalog.state.selects, priorSelects);
      assert.equal(await countRequests(audit, key), 1);
      catalog.state.available = true;
    });

    await test("unavailable product, wrong SKU and invalid UUID cannot write", async () => {
      const scenarios = [
        { body: draft(50), unavailable: true },
        { body: { ...draft(50), items: [{ productId, sku: "WRONG", quantity: 50 }] } },
        { body: { ...draft(50), items: [{ productId: "not-a-uuid", sku, quantity: 50 }] } },
      ];
      for (const scenario of scenarios) {
        const key = randomUUID();
        // An unpublished product is represented by an empty public view result.
        catalog.state.available = !scenario.unavailable;
        const response = await handler(request(scenario.body, key));
        assert.equal(response.status, 422);
        assert.equal(await countRequests(audit, key), 0);
        catalog.state.available = true;
      }
    });

    await test("client-supplied MOQ fields cannot override the server", async () => {
      const body = draft(50);
      body.items[0] = { ...body.items[0], moqAtSubmission: 1,
        moqUnitAtSubmission: "fake", belowMoq: false };
      const key = randomUUID();
      assert.equal((await handler(request(body, key))).status, 422);
      assert.equal(await countRequests(audit, key), 0);
    });

    await test("notification-stage database transaction failure rolls back all rows", async () => {
      const failingRepository = { transaction: (work) => repository.transaction((tx) => work({
        findByKey: (key) => tx.findByKey(key),
        insertRequestIfAbsent: (write) => tx.insertRequestIfAbsent(write),
        insertItems: (id, items) => tx.insertItems(id, items),
        insertNotificationJob: async (id) => {
          await tx.insertNotificationJob(id);
          throw new Error("SYNTHETIC_ABORT_AFTER_REAL_INSERT");
        },
      })) };
      const failing = createRFQHandler({ catalog: [], trustedCatalog: catalog.source,
        catalogVerified: true, repository: failingRepository,
        guards: { trustedOrigin: () => true, allowRequest: () => true },
        number: () => `RFQ-F4-${runId}-FAIL` });
      const key = randomUUID();
      assert.equal((await failing(request(draft(50), key))).status, 503);
      assert.equal(await countRequests(audit, key), 0);
      assert.deepEqual(await readPersisted(audit, key), []);
    });

    await test("legacy snapshot remains distinct from required UUID MOQ shape", async () => {
      const historical = JSON.parse(serializeRFQProductSnapshot({
        productId: "legacy-product", sku, quantity: 50,
        productName: { en: "Legacy", zh: "历史" }, productSlug: "legacy",
        selectedVariant: { id: "legacy-variant", attributes: {} },
      }));
      assert.equal(Object.hasOwn(historical, "moqAtSubmission"), false);
      assert.throws(() => serializeRFQProductSnapshot({ productId, sku, quantity: 50,
        productName: { en: "Synthetic", zh: "合成" }, productSlug: "synthetic",
        selectedVariant: { id: variantId, attributes: {} } }), { kind: "UNEXPECTED_DATABASE_ERROR" });
    });

    console.log(`RFQ trusted MOQ PostgreSQL integration: ${passed} passed; run ${runId}; 3 committed synthetic requests`);
  } catch (error) {
    console.error(`RFQ trusted MOQ PostgreSQL run ${runId} failed at ${caseName}; ${error?.kind ?? error?.code ?? error?.name ?? "ERROR"}`);
    process.exitCode = 1;
  } finally {
    await Promise.allSettled([app.end(), audit.end()]);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error("RFQ trusted MOQ PostgreSQL integration configuration rejected");
    process.exitCode = 1;
  });
}
