import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
    if (specifier.startsWith("node:")) return requireBuiltin(specifier);
    const target = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(filePath), specifier);
    return load(path.relative(root, target));
  };
  new Function("require", "exports", compiled)(requireLocal, record.exports);
  return record.exports;
}
function requireBuiltin(name) {
  if (name === "node:crypto") return cryptoModule;
  throw new Error(`Unexpected builtin: ${name}`);
}
const cryptoModule = await import("node:crypto");
const { mockProducts } = load("src/lib/catalog/mock-products");
const { createRFQHandler, fingerprintRFQ, RFQ_MAX_BODY_BYTES } = load("src/lib/rfq/api");
const { createLocalRFQRoute } = load("src/lib/rfq/local-route");
const { localTestConnection } = load("src/lib/rfq/local-connection");
const { validateRFQDraft } = load("src/lib/rfq/validation");
const { CatalogReadError } = load("src/lib/catalog-read/errors");

const product = mockProducts[0];
const other = mockProducts[1];
const base = {
  contact: { fullName: "Jane Buyer", email: "jane@example.com", companyName: "Nail Studio", country: "US" },
  requirements: "Please quote our selected products.", customization: ["oem", "odm"],
  items: [
    { productId: product.id, sku: product.variants[0].sku, quantity: 100 },
    { productId: other.id, sku: other.variants[0].sku, quantity: 200 },
  ],
};
const key = "0199e4df-b0ab-7000-8000-9e1a4cc0ac01";

// This fake exists only in this test. Its serial transaction and private draft
// state model the rollback and uniqueness requirements of a database adapter.
class FakeRepository {
  rows = new Map();
  items = [];
  jobs = [];
  failAt = "";
  tail = Promise.resolve();
  transaction(work) {
    const run = async () => {
      const rows = new Map(this.rows);
      const items = [...this.items];
      const jobs = [...this.jobs];
      const tx = {
        insertRequestIfAbsent: async (write) => {
          if (this.failAt === "request") throw new Error("secret SQL details");
          if (rows.has(write.key)) return null;
          const record = { id: "0199e4df-b0ab-7000-8000-9e1a4cc0ac02", rfqNumber: write.rfqNumber,
            fingerprint: write.fingerprint, status: "received", createdAt: "2026-10-12T00:00:00.000Z" };
          rows.set(write.key, record);
          return record;
        },
        findByKey: async (idempotencyKey) => rows.get(idempotencyKey) ?? null,
        insertItems: async (id, snapshots) => { if (this.failAt === "items") throw new Error("secret SQL details"); items.push(...snapshots); },
        insertNotificationJob: async (id) => { if (this.failAt === "job") throw new Error("secret SQL details"); jobs.push(id); },
      };
      const result = await work(tx);
      this.rows = rows; this.items = items; this.jobs = jobs;
      return result;
    };
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }
}

const repo = new FakeRepository();
const guards = { trustedOrigin: (r) => r.headers.get("origin") === "https://trusted.example", allowRequest: () => true };
const handler = createRFQHandler({ catalog: mockProducts, catalogVerified: true, repository: repo, guards,
  number: () => "RFQ-20261012-012345ABCDEF" });
function request(body = base, overrides = {}) {
  return new Request("https://trusted.example/api/rfq", { method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, Origin: "https://trusted.example", ...overrides } });
}
async function expect(status, body = base, headers = {}) {
  const response = await handler(request(body, headers));
  assert.equal(response.status, status);
  return response.json();
}
let passed = 0;
async function test(name, work) { await work(); passed++; }

await test("production configuration fails closed", async () => {
  const closed = createRFQHandler({ catalog: mockProducts, catalogVerified: false, repository: null, guards: null });
  assert.equal((await closed(request())).status, 503);
});
await test("origin, media type and UUID are checked", async () => {
  assert.equal((await handler(request(base, { Origin: "https://evil.example" }))).status, 403);
  assert.equal((await handler(request(base, { "Content-Type": "text/plain" }))).status, 415);
  assert.equal((await handler(request(base, { "Idempotency-Key": "bad" }))).status, 400);
});
await test("shared limiter denial and failure are safe", async () => {
  const denied = createRFQHandler({ catalog: mockProducts, catalogVerified: true, repository: repo,
    guards: { ...guards, allowRequest: () => false } });
  assert.equal((await denied(request())).status, 429);
  const broken = createRFQHandler({ catalog: mockProducts, catalogVerified: true, repository: repo,
    guards: { ...guards, allowRequest: () => { throw new Error("private"); } } });
  assert.equal((await broken(request())).status, 503);
});
await test("actual body bytes and malformed JSON are bounded", async () => {
  const huge = new Request("https://trusted.example/api/rfq", { method: "POST", body: "界".repeat(RFQ_MAX_BODY_BYTES / 2),
    headers: { "Content-Type": "application/json", "Idempotency-Key": key, Origin: "https://trusted.example" } });
  assert.equal((await handler(huge)).status, 413);
  const malformed = new Request("https://trusted.example/api/rfq", { method: "POST", body: "{", headers: request().headers });
  assert.equal((await handler(malformed)).status, 400);
});
await test("exactly 32 KiB is accepted and one extra UTF-8 byte is rejected", async () => {
  const boundaryRepo = new FakeRepository();
  const boundary = createRFQHandler({ catalog: mockProducts, catalogVerified: true, repository: boundaryRepo, guards });
  const multibyte = { ...base, requirements: "界".repeat(1000) };
  const json = JSON.stringify(multibyte);
  const exact = json + " ".repeat(RFQ_MAX_BODY_BYTES - Buffer.byteLength(json, "utf8"));
  assert.equal(Buffer.byteLength(exact, "utf8"), RFQ_MAX_BODY_BYTES);
  assert.ok(exact.length < RFQ_MAX_BODY_BYTES);
  const headers = { "Content-Type": "application/json", "Idempotency-Key": key, Origin: "https://trusted.example" };
  const atLimit = new Request("https://trusted.example/api/rfq", { method: "POST", body: exact, headers });
  assert.equal((await boundary(atLimit)).status, 201);
  const over = new Request("https://trusted.example/api/rfq", { method: "POST", body: `${exact} `, headers });
  assert.equal((await boundary(over)).status, 413);
  assert.equal(boundaryRepo.rows.size, 1);
});
await test("unknown and privileged fields are rejected at every object level", async () => {
  for (const body of [ { ...base, status: "received" }, { ...base, contact: { ...base.contact, createdAt: "now" } },
    { ...base, items: [{ ...base.items[0], productSnapshot: {} }] }, { ...base, rfqNumber: "RFQ-X" } ]) {
    assert.equal((await expect(422, body)).error, "VALIDATION_FAILED");
  }
});
await test("field boundaries and product ID/SKU are validated", async () => {
  for (const body of [{ ...base, requirements: "short" }, { ...base, items: [{ ...base.items[0], sku: "wrong" }] },
    { ...base, items: [{ ...base.items[0], productId: "wrong" }] }, { ...base, items: [{ ...base.items[0], quantity: 0 }] }]) {
    assert.equal((await expect(422, body)).error, "VALIDATION_FAILED");
  }
});
await test("fingerprint normalizes fields and item order", async () => {
  const a = validateRFQDraft(base, mockProducts).value;
  const b = validateRFQDraft({ ...base, contact: { ...base.contact, fullName: " Jane Buyer ", country: "us" },
    customization: ["odm", "oem"], items: [...base.items].reverse() }, mockProducts).value;
  assert.equal(fingerprintRFQ(a), fingerprintRFQ(b));
  assert.notEqual(fingerprintRFQ(a), fingerprintRFQ({ ...a, requirements: "Different requirements" }));
});
await test("create, replay and conflict never expose contact data", async () => {
  const created = await expect(201);
  assert.equal(created.replayed, false);
  assert.equal(created.rfqNumber, "RFQ-20261012-012345ABCDEF");
  assert.equal(JSON.stringify(created).includes("jane@example.com"), false);
  assert.equal(repo.items.length, 2); assert.equal(repo.jobs.length, 1);
  assert.equal(repo.items[0].productName.en, product.name.en);
  const replay = await expect(200, { ...base, items: [...base.items].reverse() });
  assert.deepEqual(replay, { ...created, replayed: true });
  assert.equal((await expect(409, { ...base, requirements: "A different business request." })).error, "IDEMPOTENCY_CONFLICT");
  assert.equal(repo.jobs.length, 1);
});
await test("UUID case variants share one durable idempotency key", async () => {
  const caseRepo = new FakeRepository();
  const caseHandler = createRFQHandler({ catalog: mockProducts, catalogVerified: true, repository: caseRepo, guards });
  const first = await caseHandler(request(base, { "Idempotency-Key": key.toUpperCase() }));
  const second = await caseHandler(request(base, { "Idempotency-Key": key.toLowerCase() }));
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).replayed, true);
  assert.deepEqual([...caseRepo.rows.keys()], [key]);
  assert.equal(caseRepo.items.length, 2);
  assert.equal(caseRepo.jobs.length, 1);
});
await test("retired product and SKU replay, while new keys still need live catalog", async () => {
  for (const retire of ["product", "sku"]) {
    const catalog = mockProducts.map((entry) => ({ ...entry, variants: [...entry.variants] }));
    const changingRepo = new FakeRepository();
    const changing = createRFQHandler({ catalog, catalogVerified: true, repository: changingRepo, guards });
    assert.equal((await changing(request())).status, 201);
    if (retire === "product") catalog.splice(catalog.findIndex((entry) => entry.id === product.id), 1);
    else catalog.find((entry) => entry.id === product.id).variants.splice(0, 1);
    const replay = await changing(request());
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).replayed, true);
    assert.equal((await changing(request({ ...base, requirements: "Changed request for the same key." }))).status, 409);
    assert.equal((await changing(request(base, { "Idempotency-Key": "0199e4df-b0ab-7000-8000-9e1a4cc0ac03" }))).status, 422);
    assert.equal((await changing(request({ ...base, contact: { ...base.contact, fullName: "" } }))).status, 422);
    assert.equal((await changing(request({ ...base, items: [{ ...base.items[0], productSnapshot: {} }] }))).status, 422);
    assert.equal(changingRepo.rows.size, 1);
    assert.equal(changingRepo.jobs.length, 1);
  }
});
await test("variantless SKU may be absent or empty but cannot be a non-string", async () => {
  const variantless = { ...product, id: "variantless", slug: "variantless", variants: [] };
  const variantlessRepo = new FakeRepository();
  const variantlessHandler = createRFQHandler({ catalog: [variantless], catalogVerified: true, repository: variantlessRepo, guards });
  const item = { productId: variantless.id, quantity: 2 };
  const draft = { ...base, items: [item] };
  assert.equal((await variantlessHandler(request(draft))).status, 201);
  assert.equal((await variantlessHandler(request({ ...draft, items: [{ ...item, sku: "" }] }))).status, 200);
  for (const bad of [0, true, false, null, {}, []]) {
    const response = await variantlessHandler(request({ ...draft, items: [{ ...item, sku: bad }] }));
    assert.equal(response.status, 422);
  }
  assert.equal((await variantlessHandler(request({ ...draft, items: [{ ...item, sku: "WRONG" }] }))).status, 409);
});
await test("concurrent duplicate requests create only one transaction", async () => {
  const concurrentRepo = new FakeRepository();
  const concurrent = createRFQHandler({ catalog: mockProducts, catalogVerified: true, repository: concurrentRepo, guards });
  const responses = await Promise.all(Array.from({ length: 12 }, () => concurrent(request())));
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, ...Array(11).fill(200)].sort());
  assert.equal(concurrentRepo.rows.size, 1); assert.equal(concurrentRepo.jobs.length, 1); assert.equal(concurrentRepo.items.length, 2);
});
await test("failure at each write rolls back and hides database details", async () => {
  for (const stage of ["request", "items", "job"]) {
    const failing = new FakeRepository(); failing.failAt = stage;
    const h = createRFQHandler({ catalog: mockProducts, catalogVerified: true, repository: failing, guards });
    const response = await h(request());
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: "RFQ_UNAVAILABLE" });
    assert.equal(failing.rows.size, 0); assert.equal(failing.items.length, 0); assert.equal(failing.jobs.length, 0);
  }
});
await test("local route remains closed by default and cannot be enabled in production", async () => {
  const env = { NODE_ENV: "development", RFQ_DATABASE_URL: "postgresql://postgres:cloud-secret@db.example/postgres" };
  let constructed = 0;
  const local = createLocalRFQRoute({ environment: () => env, catalog: mockProducts,
    repository: () => { constructed++; return new FakeRepository(); } });
  const localRequest = new Request("http://127.0.0.1:3109/api/rfq", { method: "POST", body: JSON.stringify(base),
    headers: { Host: "127.0.0.1:3109", Origin: "http://127.0.0.1:3109",
      "Content-Type": "application/json", "Idempotency-Key": key } });
  assert.deepEqual(await (await local(localRequest.clone())).json(), { error: "RFQ_UNAVAILABLE" });
  env.RFQ_LOCAL_DATABASE_URL = "postgresql://rfq_api:local-test-secret@127.0.0.1:5432/rfq_integration_test";
  assert.equal((await local(localRequest.clone())).status, 503);
  env.RFQ_ENABLE_LOCAL_POSTGRES = "1";
  env.NODE_ENV = "production";
  assert.equal((await local(localRequest.clone())).status, 503);
  assert.equal(constructed, 0);
});
await test("local route rejects absent, remote, alternate database and administrator URLs", async () => {
  const env = { NODE_ENV: "development", RFQ_ENABLE_LOCAL_POSTGRES: "1" };
  let constructed = 0;
  const local = createLocalRFQRoute({ environment: () => env, catalog: mockProducts,
    repository: () => { constructed++; return new FakeRepository(); } });
  const request = () => new Request("http://127.0.0.1:3109/api/rfq", { method: "POST", body: JSON.stringify(base),
    headers: { Host: "127.0.0.1:3109", Origin: "http://127.0.0.1:3109",
      "Content-Type": "application/json", "Idempotency-Key": key } });
  for (const url of [undefined,
    "postgresql://rfq_api:fake@db.example/rfq_integration_test",
    "postgresql://rfq_api:fake@localhost:5432/rfq_integration_test",
    "postgresql://rfq_api:fake@127.0.0.1:5433/rfq_integration_test",
    "postgresql://rfq_api:fake@127.0.0.1:5432/postgres",
    "postgresql://postgres:fake@127.0.0.1:5432/rfq_integration_test",
    "postgresql://rfq_api:fake@127.0.0.1:5432/rfq_integration_test?sslmode=disable"])
  {
    env.RFQ_LOCAL_DATABASE_URL = url;
    assert.equal((await local(request())).status, 503);
  }
  assert.equal(constructed, 0);
  assert.equal(localTestConnection("postgresql://rfq_api:fake@127.0.0.1:5432/rfq_integration_test",
    "rfq_api", true).user, "rfq_api");
});
const localOriginCases = [
  ["exact Host and Origin reach missing-key validation", { Host: "127.0.0.1:3109",
    Origin: "http://127.0.0.1:3109" }, 400],
  ["missing Origin", { Host: "127.0.0.1:3109" }, 403],
  ["localhost Origin", { Host: "127.0.0.1:3109", Origin: "http://localhost:3109" }, 403],
  ["wrong Origin port", { Host: "127.0.0.1:3109", Origin: "http://127.0.0.1:3110" }, 403],
  ["wrong Host", { Host: "evil.example", Origin: "http://127.0.0.1:3109" }, 403],
  ["missing Host", { Origin: "http://127.0.0.1:3109" }, 403],
  ["localhost Host and Origin", { Host: "localhost:3109", Origin: "http://localhost:3109" }, 403],
  ["forged forwarded Host cannot replace a wrong Host", { Host: "evil.example",
    Origin: "http://127.0.0.1:3109", "X-Forwarded-Host": "127.0.0.1:3109" }, 403],
  ["forged forwarded Proto cannot replace a wrong Origin", { Host: "127.0.0.1:3109",
    Origin: "http://evil.example", "X-Forwarded-Proto": "http" }, 403],
  ["forwarded Host does not change a valid decision", { Host: "127.0.0.1:3109",
    Origin: "http://127.0.0.1:3109", "X-Forwarded-Host": "evil.example" }, 400],
  ["forwarded Proto does not change a valid decision", { Host: "127.0.0.1:3109",
    Origin: "http://127.0.0.1:3109", "X-Forwarded-Proto": "https" }, 400],
];
for (const [name, headers, expected] of localOriginCases) {
  await test(`local origin: ${name}`, async () => {
    const local = createLocalRFQRoute({ environment: () => ({ NODE_ENV: "development",
      RFQ_ENABLE_LOCAL_POSTGRES: "1",
      RFQ_LOCAL_DATABASE_URL: "postgresql://rfq_api:fake@127.0.0.1:5432/rfq_integration_test" }),
      catalog: mockProducts, repository: () => { throw new Error("DATABASE_CALL_FORBIDDEN"); } });
    // Next.js 16 may give the route a localhost request URL even for a
    // 127.0.0.1 HTTP connection. The authorization must use the real headers.
    const response = await local(new Request("http://localhost:3109/api/rfq", {
      method: "POST", body: "{}", headers: { "Content-Type": "application/json", ...headers },
    }));
    assert.equal(response.status, expected);
  });
}
await test("local route preserves 201, 200, 409 and protects credentials and contact data", async () => {
  const env = { NODE_ENV: "development", RFQ_ENABLE_LOCAL_POSTGRES: "1",
    RFQ_LOCAL_DATABASE_URL: "postgresql://rfq_api:local-test-secret@127.0.0.1:5432/rfq_integration_test" };
  const localRepo = new FakeRepository();
  let constructed = 0;
  const local = createLocalRFQRoute({ environment: () => env, catalog: mockProducts,
    repository: (connection) => { constructed++; assert.equal(connection.host, "127.0.0.1"); return localRepo; } });
  const request = (body = base, origin = "http://127.0.0.1:3109") => new Request("http://127.0.0.1:3109/api/rfq", {
    method: "POST", body: JSON.stringify(body), headers: { Host: "127.0.0.1:3109", Origin: origin,
      "Content-Type": "application/json", "Idempotency-Key": key },
  });
  assert.equal((await local(request(base, "http://evil.example"))).status, 403);
  assert.equal(constructed, 0);
  const statuses = [];
  for (const body of [base, base, { ...base, requirements: "Different local synthetic request." }]) {
    const response = await local(request(body));
    statuses.push(response.status);
    const output = JSON.stringify(await response.json());
    for (const sensitive of ["local-test-secret", "jane@example.com", "Jane Buyer", "Nail Studio"])
      assert.equal(output.includes(sensitive), false);
  }
  assert.deepEqual(statuses, [201, 200, 409]);
  assert.equal(localRepo.rows.size, 1);
  assert.equal(localRepo.jobs.length, 1);
});
await test("local repository failure returns a fixed safe error", async () => {
  const local = createLocalRFQRoute({ environment: () => ({ NODE_ENV: "development",
    RFQ_ENABLE_LOCAL_POSTGRES: "1",
    RFQ_LOCAL_DATABASE_URL: "postgresql://rfq_api:local-test-secret@127.0.0.1:5432/rfq_integration_test" }),
    catalog: mockProducts, repository: () => { throw new Error("private SQL and local-test-secret"); } });
  const response = await local(new Request("http://127.0.0.1:3109/api/rfq", { method: "POST", body: JSON.stringify(base),
    headers: { Host: "127.0.0.1:3109", Origin: "http://127.0.0.1:3109",
      "Content-Type": "application/json", "Idempotency-Key": key } }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "RFQ_UNAVAILABLE" });
});

const publicId = "00000001-0000-4000-8000-000000000000";
const variantId = "00000101-0000-4000-8000-000000000000";
const publicBase = { ...base, items: [{ productId: publicId, sku: "PUBLIC-SKU", quantity: 50 }] };
const published = (moq = 100) => ({ id: publicId, slug: "published-product",
  translations: { en: { state: "available", value: { name: "Published product" } },
    zh: { state: "available", value: { name: "已发布商品" } } },
  variants: [{ id: variantId, sku: "PUBLIC-SKU", attributes: { color: "red" },
    moq: { quantity: moq, unit: "pieces" }, referencePrice: { kind: "usd_reference", amount: "12.00", currency: "USD" } }],
});
function trustedFixture(initial = published()) {
  const repository = new FakeRepository();
  const state = { product: initial, error: null, calls: 0 };
  const trustedCatalog = { async getPublishedProductsByIds(ids) {
    state.calls++;
    assert.deepEqual(ids, [publicId]);
    if (state.error) throw state.error;
    if (!state.product) throw new CatalogReadError("NOT_FOUND");
    return [state.product];
  } };
  const handler = createRFQHandler({ catalog: mockProducts, trustedCatalog, catalogVerified: true,
    repository, guards, number: () => "RFQ-20261012-012345ABCDEF" });
  return { repository, state, handler };
}
await test("trusted Catalog new request passes complete low-MOQ snapshot to Repository", async () => {
  const fixture = trustedFixture();
  const response = await fixture.handler(request(publicBase));
  assert.equal(response.status, 201);
  assert.equal(fixture.state.calls, 1);
  assert.equal(fixture.repository.rows.size, 1);
  assert.equal(fixture.repository.items.length, 1);
  assert.equal(fixture.repository.jobs.length, 1);
  const item = fixture.repository.items[0];
  assert.deepEqual(item, { productId: publicId, sku: "PUBLIC-SKU", quantity: 50,
    productName: { en: "Published product", zh: "已发布商品" }, productSlug: "published-product",
    selectedVariant: { id: variantId, attributes: { color: "red" } },
    moqAtSubmission: 100, moqUnitAtSubmission: "pieces", belowMoq: true });
  assert.equal(JSON.stringify(item).includes("12.00"), false);
});
await test("trusted Catalog allows equal and above MOQ with false marker", async () => {
  for (const quantity of [100, 150]) {
    const fixture = trustedFixture();
    assert.equal((await fixture.handler(request({ ...publicBase,
      items: [{ ...publicBase.items[0], quantity }] }))).status, 201);
    assert.equal(fixture.repository.items[0].belowMoq, false);
    assert.equal(fixture.repository.items[0].moqAtSubmission, 100);
  }
});
await test("client MOQ, unit, marker and price cannot become a trusted snapshot", async () => {
  for (const extra of [{ moqAtSubmission: 1 }, { moqUnitAtSubmission: "fake" },
    { belowMoq: false }, { referencePrice: "1.00" }]) {
    const fixture = trustedFixture();
    const body = { ...publicBase, items: [{ ...publicBase.items[0], ...extra }] };
    assert.equal((await fixture.handler(request(body))).status, 422);
    assert.equal(fixture.state.calls, 0);
    assert.equal(fixture.repository.rows.size, 0);
  }
});
await test("missing product, retired variant, wrong SKU and invalid MOQ fail before write", async () => {
  for (const product of [null, { ...published(), variants: [] }, published(0)]) {
    const fixture = trustedFixture(product);
    assert.equal((await fixture.handler(request(publicBase))).status, 422);
    assert.equal(fixture.repository.rows.size, 0);
    assert.equal(fixture.repository.items.length, 0);
  }
  const fixture = trustedFixture();
  assert.equal((await fixture.handler(request({ ...publicBase,
    items: [{ ...publicBase.items[0], sku: "WRONG" }] }))).status, 422);
  assert.equal(fixture.repository.rows.size, 0);
});
await test("trusted Catalog failure does not fall back to Mock or write", async () => {
  const fixture = trustedFixture();
  fixture.state.error = new CatalogReadError("SOURCE_UNAVAILABLE");
  const response = await fixture.handler(request(publicBase));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "RFQ_UNAVAILABLE" });
  assert.equal(fixture.repository.rows.size, 0);
  assert.equal(fixture.repository.jobs.length, 0);
});
await test("trusted request write failure rolls back all three records", async () => {
  for (const stage of ["request", "items", "job"]) {
    const fixture = trustedFixture();
    fixture.repository.failAt = stage;
    assert.equal((await fixture.handler(request(publicBase))).status, 503);
    assert.equal(fixture.repository.rows.size, 0);
    assert.equal(fixture.repository.items.length, 0);
    assert.equal(fixture.repository.jobs.length, 0);
  }
});
await test("trusted historical key replays without new lookup or MOQ recalculation", async () => {
  const fixture = trustedFixture();
  assert.equal((await fixture.handler(request(publicBase))).status, 201);
  fixture.state.product = published(40);
  assert.equal((await fixture.handler(request(publicBase))).status, 200);
  assert.equal(fixture.state.calls, 1);
  assert.equal(fixture.repository.items[0].moqAtSubmission, 100);
  assert.equal(fixture.repository.items[0].belowMoq, true);
  fixture.state.product = null;
  assert.equal((await fixture.handler(request(publicBase))).status, 200);
  assert.equal((await fixture.handler(request({ ...publicBase,
    requirements: "A changed business requirement." }))).status, 409);
  assert.equal((await fixture.handler(request(publicBase,
    { "Idempotency-Key": "0199e4df-b0ab-7000-8000-9e1a4cc0ac03" }))).status, 422);
  assert.equal(fixture.repository.rows.size, 1);
  assert.equal(fixture.repository.jobs.length, 1);
});
await test("concurrent trusted submissions retain one request and one snapshot", async () => {
  const fixture = trustedFixture();
  const responses = await Promise.all(Array.from({ length: 8 }, () => fixture.handler(request(publicBase))));
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, ...Array(7).fill(200)].sort());
  assert.equal(fixture.repository.rows.size, 1);
  assert.equal(fixture.repository.items.length, 1);
  assert.equal(fixture.repository.jobs.length, 1);
});
await test("closed configuration rejects trusted lookup before database work", async () => {
  const fixture = trustedFixture();
  const closed = createRFQHandler({ catalog: mockProducts,
    trustedCatalog: { async getPublishedProductsByIds() { fixture.state.calls++; return [published()]; } },
    catalogVerified: false, repository: fixture.repository, guards });
  assert.equal((await closed(request(publicBase))).status, 503);
  assert.equal(fixture.state.calls, 0);
  assert.equal(fixture.repository.rows.size, 0);
});
console.log(`RFQ API: ${passed} passed, 0 failed, 0 skipped`);
