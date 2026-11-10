import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nodeRequire = createRequire(import.meta.url);
const cache = new Map();
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

const { PostgreSQLRFQRepository, RFQDatabaseError, mapRFQDatabaseError, rfqPoolConfiguration,
  serializeRFQProductSnapshot } =
  load("src/lib/rfq/postgres-repository");
const { verifiedLocalPool } = load("src/lib/rfq/local-postgres-repository");
const { createRFQHandler } = load("src/lib/rfq/api");
const { mockProducts } = load("src/lib/catalog/mock-products");

const key = "0199e4df-b0ab-7000-8000-9e1a4cc0ac01";
const draft = {
  contact: { fullName: "Jane Buyer", email: "jane@example.com", companyName: "Nail Studio", country: "US" },
  requirements: "Please quote this product for our stores.",
  items: [{ productId: mockProducts[0].id, sku: mockProducts[0].variants[0].sku, quantity: 100 }],
};
const snapshots = [{ ...draft.items[0], productName: mockProducts[0].name,
  productSlug: mockProducts[0].slug, selectedVariant: { id: mockProducts[0].variants[0].id,
    attributes: mockProducts[0].variants[0].attributes } }];
const trustedSnapshot = (quantity, moq = 100) => ({ ...snapshots[0],
  productId: "00000001-0000-4000-8000-000000000000",
  sku: "PUBLIC-SKU", quantity,
  selectedVariant: { id: "00000101-0000-4000-8000-000000000000", attributes: { color: "red" } },
  moqAtSubmission: moq, moqUnitAtSubmission: "pieces", belowMoq: quantity < moq });
const without = (value, key) => Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
const write = (overrides = {}) => ({ key, fingerprint: "a".repeat(64),
  rfqNumber: "RFQ-20261012-012345ABCDEF", draft, items: snapshots, ...overrides });
const row = (w) => ({ id: "0199e4df-b0ab-7000-8000-9e1a4cc0ac02", rfq_number: w.rfqNumber,
  request_fingerprint: w.fingerprint, status: "received", created_at: new Date("2026-10-12T00:00:00.000Z"),
  idempotency_key: w.key });

// A SQL-call mock, not PostgreSQL. Pool checkout is serialized in this test
// double; live cross-process concurrency still needs integration testing.
class MockPool {
  rows = new Map();
  items = [];
  jobs = [];
  clients = [];
  queries = [];
  failAt = "";
  tail = Promise.resolve();

  async connect() {
    if (this.failAt === "CONNECT") throw Object.assign(new Error("private connection details"), { code: "ECONNREFUSED" });
    const previous = this.tail;
    let unlock;
    this.tail = new Promise((resolve) => { unlock = resolve; });
    await previous;
    // The query method below has its own `this` for client transaction state.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const pool = this;
    const client = {
      released: undefined,
      pending: null,
      release(destroy) { this.released = destroy; unlock(); },
      async query(sql, values = []) {
        pool.queries.push({ sql, values, client });
        const command = sql.trim().split(/\s+/)[0].toUpperCase();
        const stage = command === "INSERT" ? sql.includes("rfq_requests") ? "REQUEST"
          : sql.includes("rfq_items") ? "ITEMS" : "NOTIFICATION" : command;
        if (pool.failAt === stage && stage !== "ROLLBACK") {
          throw Object.assign(new Error("private SQL and customer detail"), {
            code: stage === "COMMIT" ? "ECONNRESET" : "23514", constraint: "private_constraint",
          });
        }
        if (command === "BEGIN") {
          this.pending = { rows: new Map(pool.rows), items: [...pool.items], jobs: [...pool.jobs] };
          return { rows: [], rowCount: null };
        }
        if (command === "SET") return { rows: [], rowCount: null };
        if (command === "ROLLBACK") {
          if (pool.failAt === "ROLLBACK") throw new Error("private rollback details");
          this.pending = null;
          return { rows: [], rowCount: null };
        }
        if (command === "COMMIT") {
          pool.rows = this.pending.rows; pool.items = this.pending.items; pool.jobs = this.pending.jobs;
          this.pending = null;
          if (pool.failAt === "COMMIT_AFTER") throw Object.assign(new Error("lost commit acknowledgement"), { code: "ECONNRESET" });
          return { rows: [], rowCount: null };
        }
        if (command === "SELECT") {
          const found = this.pending.rows.get(values[0]);
          return { rows: found ? [found] : [], rowCount: found ? 1 : 0 };
        }
        if (stage === "REQUEST") {
          const w = { rfqNumber: values[0], key: values[1], fingerprint: values[2] };
          if (this.pending.rows.has(w.key)) return { rows: [], rowCount: 0 };
          if ([...this.pending.rows.values()].some((existing) => existing.rfq_number === w.rfqNumber))
            throw Object.assign(new Error("unique RFQ number"), { code: "23505", constraint: "rfq_requests_rfq_number_key" });
          const inserted = row(w);
          this.pending.rows.set(w.key, inserted);
          return { rows: [inserted], rowCount: 1 };
        }
        if (stage === "ITEMS") {
          this.pending.items.push(values);
          return { rows: [], rowCount: 1 };
        }
        if (stage === "NOTIFICATION") {
          this.pending.jobs.push(values[0]);
          return { rows: [], rowCount: 1 };
        }
        throw new Error("Unexpected SQL in mock");
      },
    };
    this.clients.push(client);
    return client;
  }
}

async function save(repository, w = write()) {
  return repository.transaction(async (tx) => {
    const existing = await tx.findByKey(w.key);
    if (existing) return existing;
    const record = await tx.insertRequestIfAbsent(w);
    if (!record) return tx.findByKey(w.key);
    await tx.insertItems(record.id, w.items);
    await tx.insertNotificationJob(record.id);
    return record;
  });
}
const guards = { trustedOrigin: () => true, allowRequest: () => true };
function request(body = draft, idempotencyKey = key) {
  return new Request("https://trusted.example/api/rfq", { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey } });
}

let passed = 0;
async function test(name, run) { await run(); passed++; }
async function expectError(run, kind) {
  await assert.rejects(run, (error) => error instanceof RFQDatabaseError && error.kind === kind &&
    !error.message.includes("private"));
}

await test("pool config is lazy, small, verified TLS, and rejects absent/admin URLs", async () => {
  for (const url of [undefined, "postgres://postgres:secret@db.example/postgres",
    "postgres://rfq_api:secret@db.example/postgres?sslmode=disable"])
    assert.throws(() => rfqPoolConfiguration(url), (error) => error.kind === "CONFIGURATION");
  const config = rfqPoolConfiguration("postgres://rfq_api.project-ref:fake@pooler.example:6543/postgres");
  assert.equal(config.max, 1); assert.equal(config.port, 6543);
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.pipeline, false);
  assert.ok(config.connectionTimeoutMillis > 0 && config.query_timeout > 0 && config.idleTimeoutMillis > 0);
});
await test("three table transaction writes allowed columns and commits on one client", async () => {
  const pool = new MockPool();
  const result = await save(new PostgreSQLRFQRepository(pool));
  assert.equal(result.rfqNumber, write().rfqNumber);
  assert.equal(result.createdAt, "2026-10-12T00:00:00.000Z");
  assert.equal(pool.rows.size, 1); assert.equal(pool.items.length, 1); assert.equal(pool.jobs.length, 1);
  assert.deepEqual(pool.queries.map(({ sql }) => sql.trim().split(/\s+/)[0].toUpperCase()),
    ["BEGIN", "SET", "SELECT", "INSERT", "INSERT", "INSERT", "COMMIT"]);
  assert.equal(pool.queries[1].sql, "SET LOCAL statement_timeout = 8000");
  assert.ok(pool.queries.every(({ client }) => client === pool.clients[0]));
  assert.equal(pool.clients[0].released, false);
});
await test("trusted MOQ JSONB payload round-trips without losing old snapshot fields", async () => {
  for (const [quantity, expected] of [[50, true], [100, false]]) {
    const pool = new MockPool();
    const item = trustedSnapshot(quantity);
    await save(new PostgreSQLRFQRepository(pool), write({ items: [item] }));
    const stored = JSON.parse(pool.items[0][4]);
    assert.deepEqual(stored, { productName: item.productName, productSlug: item.productSlug,
      selectedVariant: item.selectedVariant, moqAtSubmission: 100,
      moqUnitAtSubmission: "pieces", belowMoq: expected });
    assert.equal(pool.items[0][1], item.productId);
    assert.equal(pool.items[0][2], item.sku);
    assert.equal(pool.items[0][3], quantity);
    assert.equal(pool.jobs.length, 1);
  }
});
await test("missing or malformed trusted MOQ fails before item insert and rolls back request", async () => {
  const valid = trustedSnapshot(50);
  const malformed = [
    without(without(without(valid, "moqAtSubmission"), "moqUnitAtSubmission"), "belowMoq"),
    without(valid, "moqAtSubmission"), without(valid, "moqUnitAtSubmission"), without(valid, "belowMoq"),
    { ...valid, moqAtSubmission: 0 }, { ...valid, moqAtSubmission: 1.5 },
    { ...valid, moqUnitAtSubmission: "" }, { ...valid, moqUnitAtSubmission: " pieces" },
    { ...valid, belowMoq: false }, { ...valid, referencePrice: "12.00" },
  ];
  for (const item of malformed) {
    const pool = new MockPool();
    await expectError(() => save(new PostgreSQLRFQRepository(pool), write({ items: [item] })),
      "UNEXPECTED_DATABASE_ERROR");
    assert.equal(pool.rows.size, 0); assert.equal(pool.items.length, 0); assert.equal(pool.jobs.length, 0);
    assert.ok(pool.queries.some(({ sql }) => sql === "ROLLBACK"));
  }
});
await test("historical local snapshot remains legacy-shaped and is never assigned invented MOQ", async () => {
  const pool = new MockPool();
  await save(new PostgreSQLRFQRepository(pool));
  const stored = JSON.parse(pool.items[0][4]);
  assert.deepEqual(Object.keys(stored).sort(), ["productName", "productSlug", "selectedVariant"].sort());
  assert.equal(Object.hasOwn(stored, "belowMoq"), false);
  assert.equal(Object.hasOwn(stored, "moqAtSubmission"), false);
  assert.equal(Object.hasOwn(stored, "moqUnitAtSubmission"), false);
  assert.equal(serializeRFQProductSnapshot(snapshots[0]), pool.items[0][4]);
});
await test("request, items, and notification failures roll back and discard", async () => {
  for (const failAt of ["REQUEST", "ITEMS", "NOTIFICATION"]) {
    const pool = new MockPool(); pool.failAt = failAt;
    await expectError(() => save(new PostgreSQLRFQRepository(pool)), "UNEXPECTED_DATABASE_ERROR");
    assert.equal(pool.rows.size, 0); assert.equal(pool.items.length, 0); assert.equal(pool.jobs.length, 0);
    assert.ok(pool.queries.some(({ sql }) => sql === "ROLLBACK"));
    assert.equal(pool.clients[0].released, true);
  }
});
await test("commit failure rolls back; lost acknowledgement remains safely retryable", async () => {
  const pool = new MockPool(); pool.failAt = "COMMIT";
  await expectError(() => save(new PostgreSQLRFQRepository(pool)), "DATABASE_UNAVAILABLE");
  assert.equal(pool.rows.size, 0);
  assert.ok(pool.queries.some(({ sql }) => sql === "ROLLBACK"));
  assert.equal(pool.clients[0].released, true);
  const uncertain = new MockPool(); uncertain.failAt = "COMMIT_AFTER";
  await expectError(() => save(new PostgreSQLRFQRepository(uncertain)), "DATABASE_UNAVAILABLE");
  assert.equal(uncertain.rows.size, 1);
  uncertain.failAt = "";
  const replay = await save(new PostgreSQLRFQRepository(uncertain));
  assert.equal(replay.rfqNumber, write().rfqNumber);
  assert.equal(uncertain.jobs.length, 1);
});
await test("rollback failure preserves primary error and discards client", async () => {
  const pool = new MockPool(); pool.failAt = "ROLLBACK";
  await expectError(() => new PostgreSQLRFQRepository(pool).transaction(async () => {
    throw new RFQDatabaseError("RFQ_NUMBER_CONFLICT");
  }), "RFQ_NUMBER_CONFLICT");
  assert.equal(pool.clients[0].released, true);
});
await test("connection refusal and interruption are safely classified", async () => {
  const refused = new MockPool(); refused.failAt = "CONNECT";
  await expectError(() => save(new PostgreSQLRFQRepository(refused)), "DATABASE_UNAVAILABLE");
  const interrupted = new MockPool(); interrupted.failAt = "COMMIT";
  await expectError(() => save(new PostgreSQLRFQRepository(interrupted)), "DATABASE_UNAVAILABLE");
});
await test("same key replays and changed fingerprint conflicts via API", async () => {
  const pool = new MockPool();
  const handler = createRFQHandler({ catalog: mockProducts, repository: new PostgreSQLRFQRepository(pool),
    guards, catalogVerified: true, number: () => write().rfqNumber });
  const first = await handler(request());
  const replay = await handler(request());
  const conflict = await handler(request({ ...draft, requirements: "Different buyer requirements." }));
  assert.deepEqual([first.status, replay.status, conflict.status], [201, 200, 409]);
  assert.equal((await replay.json()).replayed, true);
  assert.equal(pool.rows.size, 1); assert.equal(pool.jobs.length, 1);
});
await test("concurrent same key creates one request and one notification", async () => {
  const pool = new MockPool();
  const handler = createRFQHandler({ catalog: mockProducts, repository: new PostgreSQLRFQRepository(pool),
    guards, catalogVerified: true });
  const responses = await Promise.all(Array.from({ length: 8 }, () => handler(request())));
  assert.deepEqual(responses.map(({ status }) => status).sort(), [201, ...Array(7).fill(200)].sort());
  assert.equal(pool.rows.size, 1); assert.equal(pool.jobs.length, 1);
});
await test("RFQ number uniqueness is separate from idempotency conflict", async () => {
  const pool = new MockPool();
  const repo = new PostgreSQLRFQRepository(pool);
  await save(repo);
  await expectError(() => save(repo, write({ key: "0199e4df-b0ab-7000-8000-9e1a4cc0ac03" })), "RFQ_NUMBER_CONFLICT");
  assert.equal(pool.rows.size, 1); assert.equal(pool.jobs.length, 1);
  assert.equal(mapRFQDatabaseError({ code: "23505", constraint: "rfq_requests_idempotency_key_key" }).kind,
    "IDEMPOTENCY_CONFLICT");
});
await test("SQL never reads contact columns or uses wildcard results", async () => {
  const pool = new MockPool(); await save(new PostgreSQLRFQRepository(pool));
  const sql = pool.queries.map((entry) => entry.sql).join("\n");
  assert.ok(sql.includes("ON CONFLICT (idempotency_key) DO NOTHING"));
  assert.ok(!/SELECT\s+\*|RETURNING\s+\*/i.test(sql));
  const select = pool.queries.find(({ sql }) => sql.trim().startsWith("SELECT")).sql;
  const returning = pool.queries.find(({ sql }) => sql.includes("RETURNING")).sql.split("RETURNING")[1];
  for (const sensitive of ["full_name", "email", "company_name", "whatsapp", "website", "requirements"])
    assert.ok(!select.includes(sensitive) && !returning.includes(sensitive));
  assert.ok(pool.queries.every(({ sql }) => !/\bname\s*:/i.test(sql)));
});
await test("local backend identity is checked before BEGIN and rejects a forwarded endpoint", async () => {
  const identity = { role: "rfq_api", database: "rfq_integration_test", address: "127.0.0.1",
    port: 5432, version: "17.11 (Postgres.app)", superuser: false, bypassrls: false };
  for (const [reported, accepted] of [[identity, true], [{ ...identity, address: "10.0.0.8" }, false],
    [{ ...identity, role: "postgres" }, false], [{ ...identity, bypassrls: true }, false]]) {
    const commands = [];
    let discarded;
    const client = { release: (destroy) => { discarded = destroy; },
      query: async (sql) => {
        commands.push(sql);
        if (sql.includes("current_user AS role")) return { rows: [reported] };
        return { rows: [] };
      } };
    const repository = new PostgreSQLRFQRepository(verifiedLocalPool({ connect: async () => client }));
    if (accepted) {
      await repository.transaction(async () => undefined);
      assert.equal(discarded, false);
      assert.ok(commands.some((sql) => sql.startsWith("BEGIN")));
    } else {
      await expectError(() => repository.transaction(async () => undefined), "DATABASE_UNAVAILABLE");
      assert.equal(discarded, true);
      assert.equal(commands.length, 1);
      assert.ok(!commands.some((sql) => sql.startsWith("BEGIN")));
    }
  }
});

console.log(`RFQ PostgreSQL adapter mock tests: ${passed} passed, 0 failed, 0 skipped; live PostgreSQL not tested`);
