import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogCsvBundle } from "../src/lib/catalog-import/csv.ts";
import { assertNoPreviewCatalogIds } from "../src/lib/catalog-import/merge.ts";
import { MockCatalogDatabaseAdapter, mapCatalogDatabaseRows, readCatalogSnapshot, verifyCatalogActorContext } from "../src/lib/catalog-import/transaction.ts";

const ids = { p: "11111111-1111-4111-8111-111111111111", v: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333", i: "44444444-4444-4444-8444-444444444444" };
const time = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" };
const fixture = () => ({
  products: [{ ...time, id: ids.p, product_code: "DEMO-A", slug: "demo-a", product_type: "press_on_nails", status: "draft",
    attributes: {}, customization_options: [], oem: false, odm: false, lead_time_min_days: null, lead_time_max_days: null,
    seo_indexable: false, featured: false, new_arrival: false, published_at: null }],
  variants: [{ ...time, id: ids.v, product_id: ids.p, sku: "SKU-A", status: "draft", attributes: { nail_shape: "almond" },
    moq_quantity: 100, moq_unit: "sets", order_multiple: null, package_quantity: null, package_unit: null,
    reference_price: null, reference_currency: null, sort_order: 0 }],
  categories: [{ ...time, id: ids.c, parent_id: null, slug: "nails", status: "published", name_en: "Nails", name_zh: "美甲",
    description_en: "", description_zh: "", sort_order: 0 }],
  product_categories: [{ ...time, product_id: ids.p, category_id: ids.c, is_primary: true, sort_order: 0 }],
  images: [{ ...time, id: ids.i, product_id: ids.p, variant_id: null, storage_key: "a.webp", public_url: "/a.webp",
    role: "primary", status: "draft", sort_order: 0, width: null, height: null, format: null, alt_en: "", alt_zh: "" }],
  translations: [{ ...time, product_id: ids.p, locale: "en", name: "Name", short_description: "Short",
    description: "Detail", seo_title: "SEO", seo_description: "Description" }],
});
const csv = (name, header, rows) => `${header.join(",")}\n${rows.map((row) => header.map((key) => {
  const value = row[key] === undefined ? "" : typeof row[key] === "object" ? JSON.stringify(row[key]) : String(row[key]);
  return `"${value.replaceAll('"', '""')}"`;
}).join(",")).join("\n")}\n`;
const batch = (files) => parseCatalogCsvBundle(files, { knownProductCodes: new Set(["DEMO-A"]) });
const productUpdate = (oem = true) => batch({ "products.csv": csv("products.csv", ["operation", "product_code", "slug", "product_type", "oem"], [{ operation: "update", product_code: "DEMO-A", oem }]) });
const skuUpdate = (moq = 120) => batch({ "product_variants.csv": csv("product_variants.csv", ["operation", "product_code", "sku", "moq_quantity", "moq_unit"],
  [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", moq_quantity: moq }]) });
const translationUpdate = (name = "New name") => batch({ "product_translations.csv": csv("product_translations.csv", ["operation", "product_code", "locale", "name"],
  [{ operation: "update", product_code: "DEMO-A", locale: "en", name }]) });
const make = (options) => new MockCatalogDatabaseAdapter(fixture(), "templates-v1", options);
const actor = await verifyCatalogActorContext("fixture-session-1", async (session) => session === "fixture-session-1"
  ? { actor_id: "admin-1", role: "catalog_import" } : null);
const request = (version, normalized_batch, key = "key-1", other = {}) => ({ import_batch_id: "batch-1", idempotency_key: key,
  expected_snapshot_version: version, import_source: "csv", normalized_batch, actor_context: actor, ...other });
const code = (value, expected) => assert.equal(value?.code, expected);

test("trusted six-table reader maps SQL null, bigint, numeric and timestamp without losing UUID", async () => {
  const source = fixture(); source.variants[0].moq_quantity = 100n; source.variants[0].reference_price = "1.2500";
  source.variants[0].reference_currency = "USD"; source.products[0].created_at = new Date("2026-01-01T00:00:00Z");
  const rows = mapCatalogDatabaseRows(source);
  const snapshot = await readCatalogSnapshot({ readRows: async () => rows }, "templates-v1");
  assert.equal(snapshot.products[0].id, ids.p);
  assert.equal(snapshot.products[0].created_at, "2026-01-01T00:00:00.000Z");
  assert.equal(snapshot.products[0].published_at, null);
  assert.equal(snapshot.variants[0].moq_quantity, 100);
  assert.equal(snapshot.variants[0].reference_price, "1.2500");
  assert.ok(Object.isFrozen(snapshot.products[0]));
});
test("successful update commits atomically and replay returns the same receipt", async () => {
  const adapter = make(); const before = await adapter.readSnapshot();
  const req = request(before.version, productUpdate());
  const result = await adapter.execute(req);
  assert.equal(result.status, "committed"); assert.equal(result.product_count, 1);
  assert.equal((await adapter.readSnapshot()).products[0].oem, true);
  assert.equal((await adapter.readSnapshot()).products[0].id, ids.p);
  assert.notEqual(result.snapshot_version.digest, before.version.digest);
  assert.deepEqual(await adapter.execute(req), { ...result, replayed: true });
  assert.equal((await adapter.readRows()).products.length, 1);
});
test("same idempotency key with different content conflicts without modifying state", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version;
  await adapter.execute(request(version, productUpdate()));
  await assert.rejects(adapter.execute(request(version, productUpdate(false))), (error) => { code(error, "IDEMPOTENCY_CONFLICT"); return true; });
  await assert.rejects(adapter.execute(request(version, productUpdate(), "key-1", { import_batch_id: "another-batch" })),
    (error) => { code(error, "IDEMPOTENCY_CONFLICT"); return true; });
  assert.equal((await adapter.readSnapshot()).products[0].oem, true);
});
test("concurrent administrators updating one SKU serialize; stale second writer fails", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version;
  const otherActor = await verifyCatalogActorContext("fixture-session-2", async () => ({ actor_id: "admin-2", role: "catalog_admin" }));
  const [first, second] = await Promise.allSettled([
    adapter.execute(request(version, skuUpdate(120), "sku-1")),
    adapter.execute(request(version, skuUpdate(130), "sku-2", { actor_context: otherActor })),
  ]);
  assert.equal(first.status, "fulfilled"); assert.equal(second.status, "rejected"); code(second.reason, "SNAPSHOT_STALE");
  assert.equal((await adapter.readSnapshot()).variants[0].moq_quantity, 120);
});
test("same batch with concurrent identical key commits only once", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version; const req = request(version, productUpdate());
  const [a, b] = await Promise.all([adapter.execute(req), adapter.execute(req)]);
  assert.deepEqual([a.replayed, b.replayed], [false, true]);
  assert.equal((await adapter.readRows()).products.length, 1);
});
test("lost response is recovered with the original actor, key and fingerprint", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version; const req = request(version, productUpdate());
  const committed = await adapter.execute(req);
  // The caller loses the response after commit and retries without a fresh preview.
  const replay = await adapter.execute(req);
  assert.deepEqual(replay, { ...committed, replayed: true });
  assert.equal((await adapter.readRows()).products.length, 1);
});
test("different SKU insertions conflict with current snapshot and global SKU uniqueness", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version;
  const makeSku = (code) => batch({ "product_variants.csv": csv("product_variants.csv", ["operation", "product_code", "sku", "attributes", "moq_quantity", "moq_unit"],
    [{ operation: "create", product_code: "DEMO-A", sku: code, attributes: { nail_shape: "oval" }, moq_quantity: 50, moq_unit: "sets" }]) });
  await adapter.execute(request(version, makeSku("SKU-B"), "sku-create-1"));
  await assert.rejects(adapter.execute(request(version, makeSku("SKU-B"), "sku-create-2")), (error) => { code(error, "SNAPSHOT_STALE"); return true; });
  const fresh = (await adapter.readSnapshot()).version;
  await assert.rejects(adapter.execute(request(fresh, makeSku("SKU-B"), "sku-create-3")), (error) => { code(error, "BATCH_INVALID"); return true; });
  assert.equal((await adapter.readRows()).variants.length, 2);
});
test("category and translation changes invalidate concurrent import previews", async () => {
  for (const change of ["category", "translation"]) {
    const adapter = make(); const old = (await adapter.readSnapshot()).version;
    const rows = await adapter.readRows();
    if (change === "category") rows.categories[0].status = "draft";
    else rows.translations[0].name = "Changed elsewhere";
    const concurrent = new MockCatalogDatabaseAdapter(rows, "templates-v1");
    await assert.rejects(concurrent.execute(request(old, productUpdate())), (error) => { code(error, "SNAPSHOT_STALE"); return true; });
  }
  const adapter = make(); const version = (await adapter.readSnapshot()).version;
  await adapter.execute(request(version, translationUpdate()));
  await assert.rejects(adapter.execute(request(version, productUpdate(), "later")), (error) => { code(error, "SNAPSHOT_STALE"); return true; });
});
test("all simulated table and receipt failures leave the complete state unchanged", async () => {
  for (const fail_at of ["products", "variants", "translations", "product_categories", "images", "before_commit", "idempotency_receipt"]) {
    const adapter = make({ fail_at }); const before = await adapter.readSnapshot();
    await assert.rejects(adapter.execute(request(before.version, productUpdate())), (error) => { code(error, "WRITE_FAILED"); return true; });
    assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest, fail_at);
    await assert.rejects(adapter.execute(request(before.version, productUpdate())), (error) => { code(error, "WRITE_FAILED"); return true; });
  }
});
test("invalid publication and invalid MOQ roll back without an idempotency receipt", async () => {
  const adapter = make(); const before = await adapter.readSnapshot();
  const publish = batch({ "products.csv": csv("products.csv", ["operation", "product_code", "slug", "product_type", "status"],
    [{ operation: "update", product_code: "DEMO-A", status: "published" }]) });
  await assert.rejects(adapter.execute(request(before.version, publish)), (error) => { code(error, "BATCH_INVALID"); return true; });
  const invalidMoq = skuUpdate(0);
  await assert.rejects(adapter.execute(request(before.version, invalidMoq)), (error) => { code(error, "BATCH_INVALID"); return true; });
  assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest);
  const good = await adapter.execute(request(before.version, productUpdate()));
  assert.equal(good.status, "committed");
});
test("Excel conversion errors cannot be bypassed by submitting only parsed rows", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version;
  const parsed = productUpdate();
  await assert.rejects(adapter.execute(request(version, parsed, "excel-parsed", { import_source: "excel" })),
    (error) => { code(error, "INVALID_REQUEST"); return true; });
  const conversion = { valid: false, parsed, csvFiles: {}, b3Results: [], issues: [{ error_code: "FORMULA_CELL",
    field_path: "oem", message: "Formula", severity: "error", sheet_name: "Products", row_number: 2 }] };
  await assert.rejects(adapter.execute(request(version, conversion, "excel-invalid", { import_source: "excel" })),
    (error) => { code(error, "BATCH_INVALID"); return true; });
  assert.equal((await adapter.readSnapshot()).version.digest, version.digest);
});
test("unauthorized actor, preview injection and timeout cannot alter state", async () => {
  const adapter = make(); const before = await adapter.readSnapshot();
  await assert.rejects(adapter.execute(request(before.version, productUpdate(), "bad", { actor_context: { actor_id: "anonymous", role: "anon" } })),
    (error) => { code(error, "PERMISSION_DENIED"); return true; });
  await assert.rejects(adapter.execute(request(before.version, productUpdate(), "forged", { actor_context: { actor_id: "admin-1", role: "catalog_import" } })),
    (error) => { code(error, "PERMISSION_DENIED"); return true; });
  await assert.rejects(verifyCatalogActorContext("unknown", async () => null),
    (error) => { code(error, "PERMISSION_DENIED"); return true; });
  const injected = productUpdate(); injected.rows["products.csv"][0].data.id = `preview:product:${"a".repeat(64)}`;
  assert.throws(() => assertNoPreviewCatalogIds(injected), /Preview catalog identity/);
  await assert.rejects(adapter.execute(request(before.version, injected)), /Preview catalog identity/);
  const suppliedUuid = productUpdate(); suppliedUuid.rows["products.csv"][0].data.id = ids.p;
  await assert.rejects(adapter.execute(request(before.version, suppliedUuid)), (error) => { code(error, "BATCH_INVALID"); return true; });
  const blocked = make({ timeout_ms: 10, hold_lock: () => new Promise(() => {}) });
  const blockedVersion = (await blocked.readSnapshot()).version;
  await assert.rejects(blocked.execute(request(blockedVersion, productUpdate())), (error) => { code(error, "TRANSACTION_TIMEOUT"); return true; });
  assert.equal((await adapter.readSnapshot()).version.digest, before.version.digest);
  assert.equal((await blocked.readSnapshot()).version.digest, blockedVersion.digest);
});
test("new product, SKU and image get distinct database UUIDs; input stays untouched", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version;
  const incoming = batch({
    "products.csv": csv("products.csv", ["operation", "product_code", "slug", "product_type"],
      [{ operation: "create", product_code: "DEMO-B", slug: "demo-b", product_type: "press_on_nails" }]),
    "product_variants.csv": csv("product_variants.csv", ["operation", "product_code", "sku", "attributes", "moq_quantity", "moq_unit"],
      [{ operation: "create", product_code: "DEMO-B", sku: "SKU-B", attributes: { nail_shape: "square" }, moq_quantity: 30, moq_unit: "sets" }]),
    "product_images.csv": csv("product_images.csv", ["operation", "product_code", "sku", "storage_key", "public_url", "role"],
      [{ operation: "create", product_code: "DEMO-B", sku: "SKU-B", storage_key: "b.webp", public_url: "/b.webp", role: "variant" }]),
    "product_translations.csv": csv("product_translations.csv", ["operation", "product_code", "locale", "name"],
      [{ operation: "create", product_code: "DEMO-B", locale: "en", name: "Sample" },
        { operation: "create", product_code: "DEMO-B", locale: "zh", name: "样品" }]),
    "product_categories.csv": csv("product_categories.csv", ["operation", "product_code", "category_id", "is_primary"],
      [{ operation: "create", product_code: "DEMO-B", category_id: ids.c, is_primary: true }]),
  });
  const original = structuredClone(incoming);
  const result = await adapter.execute(request(version, incoming));
  assert.equal(result.status, "committed");
  assert.equal(Object.keys(result.identity_map).length, 3);
  assert.ok(Object.keys(result.identity_map).every((key) => key.startsWith("preview:")));
  assert.ok(Object.values(result.identity_map).every((value) => /^[0-9a-f-]{36}$/.test(value)));
  const current = await adapter.readSnapshot();
  assert.equal(current.products.length, 2); assert.equal(current.variants.length, 2); assert.equal(current.images.length, 2);
  const newProduct = current.products.find((product) => product.product_code === "DEMO-B");
  assert.equal(current.variants.find((variant) => variant.sku === "SKU-B").product_id, newProduct.id);
  assert.equal(current.product_categories.find((link) => link.product_id === newProduct.id).category_id, ids.c);
  assert.deepEqual(current.translations.filter((row) => row.product_id === newProduct.id).map((row) => row.locale).sort(), ["en", "zh"]);
  assert.equal(current.images.find((image) => image.storage_key === "b.webp").variant_id,
    current.variants.find((variant) => variant.sku === "SKU-B").id);
  assertNoPreviewCatalogIds(await adapter.readRows());
  assert.deepEqual(incoming, original);
});
test("unchanged batch is a no-op and snapshot state is deterministic", async () => {
  const adapter = make(); const version = (await adapter.readSnapshot()).version;
  const result = await adapter.execute(request(version, productUpdate(false)));
  assert.equal(result.status, "no_changes"); assert.deepEqual(result.identity_map, {});
  assert.equal((await adapter.readSnapshot()).version.digest, version.digest);
  assert.deepEqual(await adapter.readRows(), await make().readRows());
});
test("Mock detaches fixture input and produces deterministic identity mappings", async () => {
  const initial = fixture(); const a = new MockCatalogDatabaseAdapter(initial, "templates-v1");
  initial.products[0].attributes.private = "external mutation";
  assert.deepEqual((await a.readSnapshot()).products[0].attributes, {});
  const b = make();
  const version = (await a.readSnapshot()).version;
  const first = await a.execute(request(version, productUpdate()));
  const second = await b.execute(request(version, productUpdate()));
  assert.deepEqual(first, second);
  assert.deepEqual(await a.readRows(), await b.readRows());
});
