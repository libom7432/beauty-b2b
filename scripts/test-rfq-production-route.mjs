import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cryptoModule = await import("node:crypto");
const cache = new Map();
let poolConstructions = 0;
let activeState;
function load(relative) {
  const file = path.resolve(root, relative.endsWith(".ts") ? relative : `${relative}.ts`);
  if (cache.has(file)) return cache.get(file).exports;
  const output = ts.transpileModule(fs.readFileSync(file, "utf8"), { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const record = { exports: {} };
  cache.set(file, record);
  new Function("require", "exports", output)((specifier) => {
    if (specifier === "server-only") return {};
    if (specifier === "node:crypto") return cryptoModule;
    if (specifier === "pg") return { Pool: class { constructor(config) {
      poolConstructions++; assert.match(config.user, /^rfq_api(?:\.[a-z0-9]{20})?$/); this.config = config;
    } on() {} connect() { throw Error("network forbidden"); } } };
    if (specifier === "@/lib/catalog/inquiry") return { validQuantity: (n) => Number.isSafeInteger(n) && n > 0 };
    if (specifier === "@/lib/catalog/products") throw Error("Mock fallback forbidden");
    const target = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) :
      path.resolve(path.dirname(file), specifier);
    if (target === path.join(root, "src/lib/rfq/catalog-public-server")) return {
      createServerRFQPublicCatalogReader(config) {
        assert.equal(config.user, "rfq_catalog_public_reader_runtime");
        activeState.catalogCalls++;
        return { async getPublishedProductsByIds(ids) {
          assert.deepEqual(ids, [productId]);
          if (activeState.failCatalog) throw new CatalogReadError("SOURCE_UNAVAILABLE");
          if (!activeState.product) throw new CatalogReadError("NOT_FOUND");
          return [activeState.product];
        } };
      },
    };
    if (target === path.join(root, "src/lib/rfq/postgres-repository")) return {
      ...load(path.relative(root, target)),
      PostgreSQLRFQRepository: class { constructor(pool) {
        activeState.writerCalls++; assert.match(pool.config.user, /^rfq_api(?:\.[a-z0-9]{20})?$/);
      }
        async transaction(work) { return syntheticTransaction(activeState, work); } },
    };
    return load(path.relative(root, target));
  }, record.exports);
  return record.exports;
}
const { createProductionRFQRoute } = load("src/lib/rfq/production-route");
const { CatalogReadError } = load("src/lib/catalog-read/errors");
assert.equal(poolConstructions, 0, "module import must not create a connection pool");

const productId = "00000001-0000-4000-8000-000000000000";
const variantId = "00000002-0000-4000-8000-000000000000";
const key = "0199e4df-b0ab-7000-8000-9e1a4cc0ac01";
const body = { contact: { fullName: "Jane Buyer", email: "jane@example.com",
  companyName: "Nail Studio", country: "US" }, requirements: "Please quote our selected products.",
items: [{ productId, sku: "PUBLIC-SKU", quantity: 50 }] };
const product = { id: productId, slug: "published-product", translations: {
  en: { state: "available", value: { name: "Published product" } },
  zh: { state: "available", value: { name: "已发布商品" } },
}, variants: [{ id: variantId, sku: "PUBLIC-SKU", attributes: { color: "red" },
  moq: { quantity: 100, unit: "pieces" } }] };
const catalogEnvironment = { RFQ_CATALOG_PUBLIC_PROJECT_REF: "abcdefghijklmnopqrst",
  RFQ_CATALOG_PUBLIC_MODE: "direct", RFQ_CATALOG_PUBLIC_HOST: "db.abcdefghijklmnopqrst.supabase.co",
  RFQ_CATALOG_PUBLIC_PORT: "5432", RFQ_CATALOG_PUBLIC_DATABASE: "postgres",
  RFQ_CATALOG_PUBLIC_USER: "rfq_catalog_public_reader_runtime",
  RFQ_CATALOG_PUBLIC_PASSWORD: "synthetic-password-12345678901234567890",
  RFQ_CATALOG_PUBLIC_CA_PEM: "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----" };
const writerDatabaseUrl = "postgresql://rfq_api:synthetic-password@db.abcdefghijklmnopqrst.supabase.co:5432/postgres";
const origin = "https://buyer.example";
const request = (input = body, headers = {}) => new Request(`${origin}/api/rfq`, { method: "POST",
  headers: { "content-type": "application/json", "idempotency-key": key, origin, ...headers },
  body: JSON.stringify(input) });

function fixture() {
  const state = { rows: new Map(), items: [], jobs: [], catalogCalls: 0, writerCalls: 0,
    events: [], rateCalls: 0, spamCalls: 0, failCatalog: false, failWrite: false,
    failRate: false, failSpam: false, failAudit: false, product };
  const controls = {
    async sharedRateLimit() { state.rateCalls++; if (state.failRate) throw Error("secret rate service"); return true; },
    async antiSpam() { state.spamCalls++; if (state.failSpam) throw Error("secret spam service"); return true; },
    async audit(event) { state.events.push(event); if (state.failAudit) throw Error("secret audit service"); },
  };
  activeState = state;
  const options = { enabled: true, publicOrigin: origin, catalogEnvironment, writerDatabaseUrl, controls };
  return { state, options, controls };
}

async function syntheticTransaction(state, work) {
        const rows = new Map(state.rows), items = [...state.items], jobs = [...state.jobs];
        const tx = {
          async findByKey(k) { return rows.get(k) ?? null; },
          async insertRequestIfAbsent(write) {
            if (rows.has(write.key)) return null;
            const record = { id: variantId, rfqNumber: write.rfqNumber,
              fingerprint: write.fingerprint, status: "received", createdAt: "2026-10-12T00:00:00.000Z" };
            rows.set(write.key, record); return record;
          },
          async insertItems(_id, snapshots) { if (state.failWrite) throw Error("secret SQL buyer data"); items.push(...snapshots); },
          async insertNotificationJob(id) { jobs.push(id); },
        };
        const result = await work(tx);
        state.rows = rows; state.items = items; state.jobs = jobs;
        return result;
}
const response = async (route, input = request()) => {
  const result = await route(input);
  assert.equal(result.headers.get("cache-control"), "no-store");
  return [result.status, await result.json()];
};

test("default-off and disabled path never initialize dependencies", async () => {
  const f = fixture();
  assert.deepEqual(await response(createProductionRFQRoute(), request()), [503, { error: "RFQ_UNAVAILABLE" }]);
  assert.deepEqual(await response(createProductionRFQRoute({ ...f.options, enabled: false }), request()),
    [503, { error: "RFQ_UNAVAILABLE" }]);
  assert.equal(f.state.catalogCalls + f.state.writerCalls + f.state.rateCalls, 0);
  assert.equal(poolConstructions, 0);
});

test("missing or invalid Catalog, writer, origin, limiter, spam or audit dependency fails closed", async () => {
  const f = fixture();
  for (const change of [
    { catalogEnvironment: undefined }, { catalogEnvironment: { ...catalogEnvironment,
      RFQ_CATALOG_PUBLIC_USER: "catalog_admin_reader_runtime" } },
    { writerDatabaseUrl: undefined }, { writerDatabaseUrl: writerDatabaseUrl.replace("rfq_api", "catalog_admin") },
    { publicOrigin: undefined }, { publicOrigin: "http://buyer.example" },
    { controls: { ...f.controls, sharedRateLimit: undefined } },
    { controls: { ...f.controls, antiSpam: undefined } },
    { controls: { ...f.controls, audit: undefined } },
  ]) {
    assert.equal((await response(createProductionRFQRoute({ ...f.options, ...change })))[0], 503);
  }
  assert.equal(f.state.catalogCalls + f.state.writerCalls + f.state.rateCalls, 0);
});

test("Origin must be explicit and exactly match the trusted HTTPS deployment", async () => {
  const f = fixture();
  for (const headers of [{ origin: "https://evil.example" }, { origin: "" }, { origin: "null" }])
    assert.equal((await response(createProductionRFQRoute(f.options), request(body, headers)))[0], 403);
  assert.equal(f.state.rateCalls, 0);
  assert.equal(f.state.writerCalls, 0);
  assert.deepEqual(f.state.events, ["origin_denied", "origin_denied", "origin_denied"]);
});

test("shared limiter and anti-spam denial or failure never start a transaction", async () => {
  const f = fixture();
  const route = createProductionRFQRoute(f.options);
  f.controls.sharedRateLimit = async () => false;
  assert.equal((await response(route))[0], 429);
  f.controls.sharedRateLimit = async () => { throw Error("secret limiter"); };
  assert.deepEqual(await response(route), [503, { error: "RFQ_UNAVAILABLE" }]);
  f.controls.sharedRateLimit = async () => true;
  f.controls.antiSpam = async () => false;
  assert.equal((await response(route))[0], 429);
  f.controls.antiSpam = async () => { throw Error("secret spam"); };
  assert.deepEqual(await response(route), [503, { error: "RFQ_UNAVAILABLE" }]);
  assert.equal(f.state.writerCalls, 0);
});

test("only literal true passes either guard; invalid truthy values never create database dependencies", async () => {
  for (const invalid of [false, undefined, null, "DENY", 1, {}, []]) {
    for (const guard of ["sharedRateLimit", "antiSpam"]) {
      const f = fixture();
      f.controls[guard] = async () => invalid;
      assert.equal((await response(createProductionRFQRoute(f.options)))[0], 429);
      assert.equal(f.state.catalogCalls + f.state.writerCalls, 0);
    }
  }
  const bothDenied = fixture();
  bothDenied.controls.sharedRateLimit = async () => "DENY";
  bothDenied.controls.antiSpam = async () => "DENY";
  assert.equal((await response(createProductionRFQRoute(bothDenied.options)))[0], 429);
  assert.equal(bothDenied.state.spamCalls, 0);
  assert.equal(bothDenied.state.catalogCalls + bothDenied.state.writerCalls, 0);
  const both = fixture();
  assert.equal((await response(createProductionRFQRoute(both.options)))[0], 201);
  assert.equal(both.state.catalogCalls, 1);
  assert.equal(both.state.writerCalls, 1);
});

test("audit failure and timed-out shared guard fail closed", async () => {
  const f = fixture();
  f.state.failAudit = true;
  assert.deepEqual(await response(createProductionRFQRoute(f.options)), [503, { error: "RFQ_UNAVAILABLE" }]);
  assert.equal(f.state.writerCalls, 0);
  f.state.failAudit = false;
  f.controls.sharedRateLimit = () => new Promise(() => {});
  assert.deepEqual(await response(createProductionRFQRoute(f.options)), [503, { error: "RFQ_UNAVAILABLE" }]);
  assert.equal(f.state.writerCalls, 0);
});

test("timed-out anti-spam guard fails closed", async () => {
  const f = fixture();
  f.controls.antiSpam = () => new Promise(() => {});
  assert.deepEqual(await response(createProductionRFQRoute(f.options)), [503, { error: "RFQ_UNAVAILABLE" }]);
  assert.equal(f.state.catalogCalls + f.state.writerCalls, 0);
});

test("production route ignores arbitrary Catalog factory injection", async () => {
  const f = fixture();
  let arbitraryCalled = false;
  const route = createProductionRFQRoute({ ...f.options, factories: { publicCatalog() {
    arbitraryCalled = true; throw Error("hard-coded catalog was selected");
  } } });
  assert.equal((await response(route))[0], 201);
  assert.equal(arbitraryCalled, false);
  assert.equal(f.state.catalogCalls, 1);
  const source = fs.readFileSync(path.join(root, "src/lib/rfq/production-route.ts"), "utf8");
  assert.match(source, /createServerRFQPublicCatalogReader\(catalogConfig\)/);
  assert.doesNotMatch(source, /factories\.publicCatalog|mockProducts/);
});

test("writer target must identify the same Supabase project as public Catalog", async () => {
  const f = fixture();
  const samePooler = "postgresql://rfq_api.abcdefghijklmnopqrst:synthetic-password@aws-0-us-east-1.pooler.supabase.com:6543/postgres";
  const otherProject = "postgresql://rfq_api:synthetic-password@db.otherproject12345678.supabase.co:5432/postgres";
  const otherPooler = samePooler.replace("abcdefghijklmnopqrst", "otherproject12345678");
  for (const candidateUrl of [otherProject, otherPooler,
    "postgresql://rfq_api:synthetic-password@db.abcdefghijklmnopqrst.supabase.co.evil.invalid:5432/postgres",
    "postgresql://rfq_api.abcdefghijklmnopqrst:synthetic-password@aws-0-us-east-1.pooler.supabase.com.evil.invalid:6543/postgres",
    "postgresql://rfq_api:synthetic-password@unknown.example:5432/postgres",
    writerDatabaseUrl.replace("rfq_api", "RFQ_API"),
    writerDatabaseUrl.replace(":5432/", ":6543/"),
    "postgresql://rfq_api:synthetic-password@db.abcdefghijklmnopqrst.supabase.co:5432/other",
    "not a postgres url"]) {
    assert.deepEqual(await response(createProductionRFQRoute({ ...f.options, writerDatabaseUrl: candidateUrl })),
      [503, { error: "RFQ_UNAVAILABLE" }]);
  }
  assert.equal(f.state.catalogCalls + f.state.writerCalls, 0);
  assert.equal((await response(createProductionRFQRoute({ ...f.options, writerDatabaseUrl: samePooler })))[0], 201);
  assert.equal(f.state.writerCalls, 1);
  const session = fixture();
  assert.equal((await response(createProductionRFQRoute({ ...session.options,
    writerDatabaseUrl: samePooler.replace(":6543/", ":5432/") })))[0], 201);
  const canonical = fixture();
  const uppercaseHost = writerDatabaseUrl.replace("db.abcdefghijklmnopqrst.supabase.co",
    "DB.ABCDEFGHIJKLMNOPQRST.SUPABASE.CO");
  assert.equal((await response(createProductionRFQRoute({ ...canonical.options,
    writerDatabaseUrl: uppercaseHost })))[0], 503);
  assert.equal(canonical.state.catalogCalls + canonical.state.writerCalls, 0);
});

test("synthetic new submission stores trusted MOQ while replay and conflict skip Catalog", async () => {
  const f = fixture();
  const route = createProductionRFQRoute(f.options);
  assert.equal((await response(route))[0], 201);
  assert.deepEqual(f.state.items[0], { ...body.items[0],
    productName: { en: "Published product", zh: "已发布商品" }, productSlug: "published-product",
    selectedVariant: { id: variantId, attributes: { color: "red" } },
    moqAtSubmission: 100, moqUnitAtSubmission: "pieces", belowMoq: true });
  f.state.failCatalog = true;
  assert.equal((await response(route))[0], 200);
  assert.equal((await response(route, request({ ...body, requirements: "Changed requirements" })))[0], 409);
  assert.equal(f.state.catalogCalls, 1);
  assert.equal(f.state.rows.size, 1);
  assert.equal(f.state.items.length, 1);
  assert.equal(f.state.jobs.length, 1);
});

test("Catalog or writer failure cannot produce partial success or leak private errors", async () => {
  for (const field of ["failCatalog", "failWrite"]) {
    const f = fixture(); f.state[field] = true;
    assert.deepEqual(await response(createProductionRFQRoute(f.options)), [503, { error: "RFQ_UNAVAILABLE" }]);
    assert.equal(f.state.rows.size + f.state.items.length + f.state.jobs.length, 0);
  }
});

test("unavailable product or Variant cannot create a new RFQ", async () => {
  for (const published of [null, { ...product, variants: [] }]) {
    const f = fixture(); f.state.product = published;
    assert.equal((await response(createProductionRFQRoute(f.options)))[0], 422);
    assert.equal(f.state.rows.size + f.state.items.length + f.state.jobs.length, 0);
  }
});

test("client MOQ and price fields are rejected before Catalog or writer access", async () => {
  const f = fixture();
  const changed = { ...body, items: [{ ...body.items[0], moqAtSubmission: 1, referencePrice: "0.01" }] };
  assert.equal((await response(createProductionRFQRoute(f.options), request(changed)))[0], 422);
  assert.equal(f.state.catalogCalls, 0);
  assert.equal(f.state.writerCalls, 0);
});

test("production POST remains disconnected and closed", () => {
  const source = fs.readFileSync(path.join(root, "src/app/api/rfq/route.ts"), "utf8");
  assert.doesNotMatch(source, /production-route|createProductionRFQRoute|getServerRFQPublicCatalogReader/);
  assert.match(source, /createLocalRFQRoute/);
  assert.doesNotMatch(source, /RFQ_ENABLE_PRODUCTION|createServerRFQPublicCatalogReader/);
});
