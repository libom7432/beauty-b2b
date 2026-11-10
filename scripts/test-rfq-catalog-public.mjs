import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { CatalogReadError } from "../src/lib/catalog-read/errors.ts";
import { createRFQPublicCatalogReader, createRFQPublicReadSnapshot,
  requireRFQPublicCatalogConfig, RFQ_PUBLIC_PRODUCTS_SQL, RFQ_PUBLIC_VARIANTS_SQL,
  RFQ_PUBLIC_TRANSLATIONS_SQL } from "../src/lib/rfq/catalog-public-postgres.ts";

const itemSource = readFileSync(new URL("../src/lib/rfq/items.ts", import.meta.url), "utf8");
const compiledItems = ts.transpileModule(itemSource, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
} }).outputText;
const itemModule = { exports: {} };
new Function("require", "exports", compiledItems)((name) => {
  if (name === "@/lib/catalog/inquiry") return {
    validQuantity: (value) => Number.isSafeInteger(value) && value > 0,
  };
  throw Error(`Unexpected import: ${name}`);
}, itemModule.exports);
const { snapshotRFQItemsFromPublicCatalog } = itemModule.exports;

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const product = () => ({ id: id(1), slug: "real-product" });
const variant = () => ({ id: id(2), product_id: id(1), sku: "REAL-SKU",
  attributes: { color: "red" }, moq_quantity: "100", moq_unit: "pieces" });
const translations = () => [
  { product_id: id(1), locale: "en", name: "Real product" },
  { product_id: id(1), locale: "zh", name: "真实商品" },
];
const data = () => ({ products: [product()], variants: [variant()], translations: translations() });
const copy = (value) => structuredClone(value);
const denied = (promise, code) => assert.rejects(promise, (error) =>
  error instanceof CatalogReadError && error.code === code &&
  !/private-secret|SELECT|buyer@example/.test(String(error)));

function fixture(initial = data()) {
  const state = { data: initial, calls: [], failed: false, released: [], connect: 0, afterProducts: null };
  const snapshot = createRFQPublicReadSnapshot(async () => {
    state.connect++;
    let frozen;
    return { async query(sql, values = []) {
      state.calls.push({ sql, values });
      if (state.failed) throw Error("private-secret SELECT buyer@example.invalid");
      if (sql === "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY") {
        frozen = copy(state.data); return { rows: [] };
      }
      if (sql === "SET LOCAL statement_timeout = 5000" || sql === "COMMIT" || sql === "ROLLBACK")
        return { rows: [] };
      assert.ok(frozen, "queries require a transaction snapshot");
      if (sql === RFQ_PUBLIC_PRODUCTS_SQL) {
        const rows = frozen.products.filter((row) => values[0].includes(row.id)).slice(0, values[1]);
        state.afterProducts?.();
        return { rows };
      }
      if (sql === RFQ_PUBLIC_VARIANTS_SQL) return { rows: frozen.variants.filter((row) =>
        values[0].includes(row.product_id)).slice(0, values[1]) };
      if (sql === RFQ_PUBLIC_TRANSLATIONS_SQL) return { rows: frozen.translations.filter((row) =>
        values[0].includes(row.product_id) && ["en", "zh"].includes(row.locale)).slice(0, values[1]) };
      throw Error("unexpected SQL");
    }, release(destroy) { state.released.push(Boolean(destroy)); } };
  });
  return { state, reader: createRFQPublicCatalogReader(snapshot) };
}

test("three fixed public-view queries select only approved columns with UUID bind and row caps", async () => {
  const f = fixture();
  const found = await f.reader.getPublishedProductsByIds([id(1)]);
  assert.equal(found.length, 1);
  const calls = f.state.calls.filter((call) => call.sql.startsWith("SELECT"));
  assert.deepEqual(calls.map((call) => call.sql),
    [RFQ_PUBLIC_PRODUCTS_SQL, RFQ_PUBLIC_VARIANTS_SQL, RFQ_PUBLIC_TRANSLATIONS_SQL]);
  assert.deepEqual(calls.map((call) => call.values), [[[id(1)], 2], [[id(1)], 2001], [[id(1)], 3]]);
  assert.deepEqual(calls.map((call) => call.sql.match(/catalog_public\.[a-z_]+/g)),
    [["catalog_public.products"], ["catalog_public.product_variants"], ["catalog_public.product_translations"]]);
  for (const sql of calls.map((call) => call.sql))
    assert.doesNotMatch(sql, /catalog_private|admin_private|rfq_private|reference_price|SELECT \*/);
  assert.deepEqual(f.state.released, [false]);
});

test("invalid, duplicate and over-20 IDs stop before a connection", async () => {
  const f = fixture();
  for (const ids of [[], ["bad"], [id(1), id(1).toUpperCase()],
    Array.from({ length: 21 }, (_, index) => id(index + 1))])
    await denied(f.reader.getPublishedProductsByIds(ids), "INVALID_INPUT");
  assert.equal(f.state.connect, 0);
});

test("missing or unpublished product is unavailable to a new RFQ", async () => {
  await denied(fixture({ ...data(), products: [] }).reader.getPublishedProductsByIds([id(1)]), "NOT_FOUND");
  const draft = { productId: id(1), sku: "REAL-SKU", quantity: 50 };
  await denied(snapshotRFQItemsFromPublicCatalog([draft], fixture({ ...data(), products: [] }).reader), "NOT_FOUND");
});

test("unpublished variant is absent, while wrong SKU cannot be snapshotted", async () => {
  const f = fixture({ ...data(), variants: [] });
  await denied(f.reader.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
  const good = fixture();
  const result = await snapshotRFQItemsFromPublicCatalog([{ productId: id(1), sku: "OTHER", quantity: 50 }], good.reader);
  assert.equal(result.ok, false);
});

test("extra product, variant ownership conflict and duplicate variant or SKU fail closed", async () => {
  for (const changed of [
    { ...data(), variants: [{ ...variant(), product_id: id(9) }] },
    { ...data(), variants: [variant(), variant()] },
    { ...data(), variants: [variant(), { ...variant(), id: id(3) }] },
  ]) {
    const f = fixture(changed);
    await denied(f.reader.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
  }
  const extra = createRFQPublicCatalogReader(async (work) => work({ async select(sql) {
    if (sql === RFQ_PUBLIC_PRODUCTS_SQL) return [product(), { id: id(9), slug: "extra" }];
    return [];
  } }));
  await denied(extra.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
  const crossed = createRFQPublicCatalogReader(async (work) => work({ async select(sql) {
    if (sql === RFQ_PUBLIC_PRODUCTS_SQL) return [product()];
    if (sql === RFQ_PUBLIC_VARIANTS_SQL) return [{ ...variant(), product_id: id(9) }];
    return translations();
  } }));
  await denied(crossed.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
});

test("bad MOQ, attributes and translation absence or conflict fail closed", async () => {
  for (const bad of [undefined, null, "0", "1.5", "9007199254740992", 100]) {
    const f = fixture({ ...data(), variants: [{ ...variant(), moq_quantity: bad }] });
    await denied(f.reader.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
  }
  for (const bad of ["", " pieces ", "x".repeat(65), 4]) {
    const f = fixture({ ...data(), variants: [{ ...variant(), moq_unit: bad }] });
    await denied(f.reader.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
  }
  for (const bad of [{ color: ["red"] }, { color: null }])
    await denied(fixture({ ...data(), variants: [{ ...variant(), attributes: bad }] })
      .reader.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
  for (const bad of [translations().slice(0, 1), [...translations(), translations()[0]],
    [{ ...translations()[0], name: "" }, translations()[1]]])
    await denied(fixture({ ...data(), translations: bad }).reader.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
});

test("one repeatable-read transaction prevents mixed product, variant and name states", async () => {
  const f = fixture();
  f.state.afterProducts = () => { f.state.data.variants = []; f.state.data.translations = []; };
  const result = await f.reader.getPublishedProductsByIds([id(1)]);
  assert.equal(result[0].variants[0].sku, "REAL-SKU");
  assert.equal(result[0].translations.zh.value.name, "真实商品");
  assert.deepEqual(f.state.calls.map((call) => call.sql).slice(0, 2),
    ["BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY", "SET LOCAL statement_timeout = 5000"]);
  assert.equal(f.state.calls.at(-1).sql, "COMMIT");
});

test("query failure rolls back and does not return a partial product", async () => {
  const f = fixture();
  f.state.afterProducts = () => { f.state.failed = true; };
  await denied(f.reader.getPublishedProductsByIds([id(1)]), "SOURCE_UNAVAILABLE");
  assert.equal(f.state.calls.at(-1).sql, "ROLLBACK");
  assert.deepEqual(f.state.released, [true]);
});

test("low, equal and high quantities retain complete server-computed MOQ snapshots", async () => {
  for (const quantity of [50, 100, 150]) {
    const f = fixture();
    const result = await snapshotRFQItemsFromPublicCatalog([{ productId: id(1), sku: "REAL-SKU", quantity }], f.reader);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value[0], { productId: id(1), sku: "REAL-SKU", quantity,
      productName: { en: "Real product", zh: "真实商品" }, productSlug: "real-product",
      selectedVariant: { id: id(2), attributes: { color: "red" } },
      moqAtSubmission: 100, moqUnitAtSubmission: "pieces", belowMoq: quantity < 100 });
  }
});

test("configuration rejects missing and wrong roles, and source never imports Admin or Mock", () => {
  assert.throws(() => requireRFQPublicCatalogConfig({}), { code: "NOT_CONFIGURED" });
  const env = { RFQ_CATALOG_PUBLIC_PROJECT_REF: "abcdefghijklmnopqrst",
    RFQ_CATALOG_PUBLIC_MODE: "direct", RFQ_CATALOG_PUBLIC_HOST: "db.abcdefghijklmnopqrst.supabase.co",
    RFQ_CATALOG_PUBLIC_PORT: "5432", RFQ_CATALOG_PUBLIC_DATABASE: "postgres",
    RFQ_CATALOG_PUBLIC_USER: "rfq_catalog_public_reader_runtime",
    RFQ_CATALOG_PUBLIC_PASSWORD: "p".repeat(32),
    RFQ_CATALOG_PUBLIC_CA_PEM: "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----" };
  assert.equal(requireRFQPublicCatalogConfig(env).poolMax, 2);
  for (const [mode, port, poolMax] of [["session", "5432", 2], ["transaction", "6543", 1]]) {
    const config = requireRFQPublicCatalogConfig({ ...env, RFQ_CATALOG_PUBLIC_MODE: mode,
      RFQ_CATALOG_PUBLIC_HOST: "aws-0-us-east-1.pooler.supabase.com",
      RFQ_CATALOG_PUBLIC_PORT: port,
      RFQ_CATALOG_PUBLIC_USER: "rfq_catalog_public_reader_runtime.abcdefghijklmnopqrst" });
    assert.equal(config.poolMax, poolMax);
  }
  for (const user of ["catalog_admin_reader_runtime", "rfq_api", "postgres", "service_role"])
    assert.throws(() => requireRFQPublicCatalogConfig({ ...env, RFQ_CATALOG_PUBLIC_USER: user }),
      { code: "NOT_CONFIGURED" });
  const core = readFileSync(new URL("../src/lib/rfq/catalog-public-postgres.ts", import.meta.url), "utf8");
  const server = readFileSync(new URL("../src/lib/rfq/catalog-public-server.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /postgres-supabase|ADMIN_DIRECTORY_DATABASE_URL|RFQ_DATABASE_URL|mockProducts/);
  assert.match(server, /rejectUnauthorized: true/);
  assert.match(server, /createRFQPublicReadSnapshot/);
  assert.doesNotMatch(core, /catalog_private\.|admin_private\.|rfq_private\.|mockProducts/);
  const route = readFileSync(new URL("../src/app/api/rfq/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /catalog-public-server/);
});
