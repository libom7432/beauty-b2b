import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createOfflineCatalogSource, notConfiguredCatalogSource, projectPublicCatalogBundle } from "../src/lib/catalog-read/offline.ts";
import { mapCategories, referencePrice, safeBigint, toPublic } from "../src/lib/catalog-read/mapping.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const date = "2026-10-01T00:00:00.000Z";
const category = (n, parent_id = null, status = "published") => ({ id: id(n), parent_id,
  slug: `cat-${n}`, status, name_en: `Category ${n}`, name_zh: `分类 ${n}`,
  description_en: "", description_zh: "", sort_order: n, created_at: date, updated_at: date });
const translation = (product_id, locale, name) => ({ product_id, locale, name,
  short_description: "Short", description: "Description", seo_title: name,
  seo_description: "SEO", created_at: date, updated_at: date });
const variant = (n, product_id, status = "published", price = "12.3456", currency = "USD") => ({
  id: id(n), product_id, sku: `SKU-${n}`, status, attributes: { color: "red", size: 2 },
  moq_quantity: "100", moq_unit: "pieces", order_multiple: null, package_quantity: null,
  package_unit: null, reference_price: price, reference_currency: currency, sort_order: n,
  created_at: date, updated_at: date });
const image = (n, product_id, variant_id = null, status = "published") => ({ id: id(n), product_id,
  variant_id, storage_key: `private/${n}.webp`, public_url: `https://example.invalid/${n}.webp`,
  role: variant_id ? "variant" : "primary", status, sort_order: n, width: 400, height: 400,
  format: "webp", alt_en: "Photo", alt_zh: "图片", created_at: date, updated_at: date });
const chain = [category(201), category(202, id(201)), category(203, id(202)), category(204)];
function bundle(n, status = "published", overrides = {}) {
  const product_id = id(n);
  return { product: { id: product_id, product_code: `FAMILY-${n}`, slug: `family-${n}`,
    product_type: "press-on", status, attributes: {}, customization_options: [], oem: false,
    odm: false, lead_time_min_days: null, lead_time_max_days: null, seo_indexable: true,
    featured: n === 1, new_arrival: false, published_at: status === "published" ? date : null,
    created_at: date, updated_at: date },
    translations: [translation(product_id, "en", `Product ${n}`), translation(product_id, "zh", `商品 ${n}`)],
    variants: [variant(n + 100, product_id), variant(n + 110, product_id, "draft")],
    categoryLinks: [
      { product_id, category_id: id(203), is_primary: true, sort_order: 0, created_at: date, updated_at: date },
      { product_id, category_id: id(204), is_primary: false, sort_order: 1, created_at: date, updated_at: date },
    ], categories: chain,
    images: [image(n + 300, product_id), image(n + 310, product_id, id(n + 100)),
      image(n + 320, product_id, id(n + 110)), image(n + 330, product_id, null, "draft")],
    ...overrides };
}
const fixtures = [bundle(1), bundle(2, "draft"), bundle(3, "retired"), bundle(4)];
const adminId = id(999);
const directory = {
  provider: { async verifySession(session) { return session === "valid" || session === "disabled" || session === "ordinary"
    ? { identity_provider: "test", provider_subject: session } : null; } },
  directory: { async findByProviderIdentity(identity) {
    if (identity.provider_subject === "ordinary") return null;
    return { admin_id: adminId, identity_provider: "test", provider_subject: identity.provider_subject,
      status: identity.provider_subject === "disabled" ? "disabled" : "active",
      created_at: date, disabled_at: identity.provider_subject === "disabled" ? date : null,
      permissions: ["catalog.read"] };
  } },
};
const repo = (session = "valid", data = fixtures) => createCatalogReadRepository(createOfflineCatalogSource(data),
  { session, dependencies: directory });
const rejects = (promise, code) => assert.rejects(promise, (error) => error?.code === code);

test("published projection filters draft/retired product, variants and images", async () => {
  const result = await repo().listPublishedProducts();
  assert.deepEqual(result.items.map((p) => p.productCode), ["FAMILY-1", "FAMILY-4"]);
  assert.equal(result.items[0].variants.length, 1);
  assert.deepEqual(result.items[0].images.map((entry) => entry.id), [id(301), id(311)]);
  assert.equal(JSON.stringify(result).includes("storageKey"), false);
  assert.equal(JSON.stringify(result).includes("draft"), false);
  await rejects(repo().getPublishedProductBySlug("family-2"), "NOT_FOUND");
});
test("one family has multiple distinct SKUs and exact variant image association", async () => {
  const detail = await repo().getAdminProductByCode("FAMILY-1");
  assert.equal(detail.basic.product_code, "FAMILY-1");
  assert.deepEqual(detail.variants.map((v) => v.sku), ["SKU-101", "SKU-111"]);
  assert.deepEqual(detail.variants[0].imageIds, [id(311)]);
  assert.equal(detail.variants[0].moq.quantity, 100);
});
test("English/Chinese and missing translation states are explicit", async () => {
  const full = await repo().getPublishedProductBySlug("family-1");
  assert.equal(full.translations.en.value.name, "Product 1");
  assert.equal(full.translations.zh.value.name, "商品 1");
  const missing = bundle(5, "published", { translations: [translation(id(5), "en", "English only")] });
  assert.equal((await repo("valid", [missing]).getPublishedProductBySlug("family-5")).translations.zh.state, "unavailable");
});
test("primary/additional categories, ancestors and path are preserved", () => {
  const mapped = mapCategories(bundle(1));
  assert.deepEqual(mapped.path, ["cat-201", "cat-202", "cat-203"]);
  assert.deepEqual(mapped.ancestors.map((c) => c.id), [id(201), id(202)]);
  assert.deepEqual(mapped.additional.map((c) => c.id), [id(204)]);
});
test("category cycle, missing parent and unpublished public ancestor fail closed", () => {
  const cycle = bundle(1, "published", { categories: [category(201, id(203)), ...chain.slice(1)] });
  const missing = bundle(1, "published", { categories: [category(203, id(999)), category(204)] });
  const draftParent = bundle(1, "published", { categories: [category(201, null, "draft"), ...chain.slice(1)] });
  assert.throws(() => mapCategories(projectPublicCatalogBundle(cycle)), (e) => e.code === "INTERNAL_ERROR");
  assert.throws(() => mapCategories(projectPublicCatalogBundle(missing)), (e) => e.code === "INTERNAL_ERROR");
  assert.throws(() => mapCategories(projectPublicCatalogBundle(draftParent)), (e) => e.code === "INTERNAL_ERROR");
});
test("public projection omits unpublished additional category and rejects mock category identity", async () => {
  const row = bundle(6, "published", { categories: [...chain.slice(0, 3), category(204, null, "draft")] });
  assert.deepEqual((await repo("valid", [row]).getPublishedProductBySlug("family-6")).categories.additional, []);
  const mock = bundle(6, "published", { categories: [{ ...chain[0], id: "mock-cat" }, ...chain.slice(1)] });
  assert.throws(() => mapCategories(mock), (e) => e.code === "INTERNAL_ERROR");
});
test("public category filter cannot reveal draft or retired associations", async () => {
  for (const hiddenStatus of ["draft", "retired"]) {
    const hidden = bundle(6, "published", { categories: [...chain.slice(0, 3), category(204, null, hiddenStatus)] });
    const publicRepo = repo("valid", [hidden]);
    const hiddenResult = await publicRepo.listPublishedProducts({ categoryId: id(204) });
    const unknownResult = await publicRepo.listPublishedProducts({ categoryId: id(999) });
    assert.deepEqual(hiddenResult, unknownResult);
    assert.deepEqual(hiddenResult, { items: [], nextCursor: null });
    assert.deepEqual((await publicRepo.getPublishedProductBySlug("family-6")).categories.additional, []);
    assert.equal((await publicRepo.listAdminProducts({ categoryId: id(204) })).items.length, 1);
  }
  const publicRepo = repo("valid", [bundle(1), bundle(2, "draft"), bundle(3, "retired")]);
  assert.deepEqual((await publicRepo.listPublishedProducts({ categoryId: id(203) })).items.map((p) => p.productCode), ["FAMILY-1"]);
  assert.equal((await publicRepo.listPublishedProducts({ categoryId: id(204) })).items.length, 1);
});
test("offline public projection has exactly the columns selected by all six SQL views", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261013120000_create_catalog_foundation.sql", import.meta.url), "utf8");
  const projected = projectPublicCatalogBundle(bundle(1));
  const examples = { products: projected.product, product_variants: projected.variants[0],
    categories: projected.categories[0], product_categories: projected.categoryLinks[0],
    product_images: projected.images[0], product_translations: projected.translations[0] };
  assert.equal(Object.keys(examples).length, 6);
  for (const [view, row] of Object.entries(examples)) {
    const match = sql.match(new RegExp(`CREATE VIEW catalog_public\\.${view} WITH \\(security_barrier = true\\) AS\\s+SELECT\\s+([\\s\\S]*?)\\s+FROM\\s+`));
    assert.ok(match, `missing SQL view: ${view}`);
    const selectedColumns = match[1].split(",").map((column) => column.trim().replace(/^\w+\./, ""));
    assert.deepEqual(Object.keys(row).sort(), selectedColumns.sort(), `view column mismatch: ${view}`);
    for (const privateField of ["status", "created_at", "updated_at", "storage_key"])
      assert.equal(Object.hasOwn(row, privateField), false, `${view} exposes ${privateField}`);
  }
  const dto = toPublic(projected);
  assert.equal(JSON.stringify(dto).includes("storage_key"), false);
  assert.throws(() => toPublic(bundle(1)), (error) => error.code === "INTERNAL_ERROR");
});
test("duplicate variant SKU across products is rejected by offline adapter", () => {
  const collision = bundle(7, "published", { variants: [variant(101, id(7))], images: [] });
  assert.throws(() => createOfflineCatalogSource([bundle(1), collision]), (e) => e.code === "INTERNAL_ERROR");
});
test("reference price distinguishes USD, non-USD and absent without making tiers", async () => {
  assert.deepEqual(referencePrice("12.3456", "USD"), { kind: "usd_reference", amount: "12.3456", currency: "USD" });
  assert.deepEqual(referencePrice("12.3456", "EUR"), { kind: "non_usd_reference", amount: "12.3456", currency: "EUR" });
  assert.deepEqual(referencePrice(null, null), { kind: "not_provided" });
  const item = bundle(5, "published", { variants: [variant(105, id(5), "published", null, null)], images: [] });
  const mapped = toPublic(projectPublicCatalogBundle(item));
  assert.equal(mapped.variants[0].referencePrice.kind, "not_provided");
  assert.equal(mapped.variants[0].tieredPricing.state, "unavailable");
  assert.equal(mapped.collections.state, "unavailable");
});
test("numeric precision and bigint range are not silently rounded", () => {
  assert.equal(referencePrice("9999999999.9999", "USD").amount, "9999999999.9999");
  assert.equal(safeBigint("9007199254740991"), Number.MAX_SAFE_INTEGER);
  assert.throws(() => safeBigint("9007199254740992"), (e) => e.code === "INTERNAL_ERROR");
  assert.throws(() => referencePrice("1.23456", "USD"), (e) => e.code === "INTERNAL_ERROR");
});
test("admin lists drafts and retired, public does not", async () => {
  const items = (await repo().listAdminProducts()).items;
  assert.deepEqual(new Set(items.map((item) => item.status)), new Set(["draft", "published", "retired"]));
  assert.equal((await repo().getAdminProductByCode("FAMILY-2")).publishing.status, "draft");
});
test("missing product, unauthenticated, ordinary, disabled and expired sessions", async () => {
  await rejects(repo().getAdminProductByCode("MISSING"), "NOT_FOUND");
  for (const session of [null, "ordinary", "disabled", "expired", { role: "super_admin" }])
    await rejects(repo(session).listAdminProducts(), "FORBIDDEN");
});
test("permission failure precedes source query", async () => {
  let called = 0;
  const source = { mode: "offline", async listAdmin() { called++; return { rows: [], hasMore: false }; },
    async getAdminByCode() { called++; return null; }, async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  const denied = createCatalogReadRepository(source, { session: "ordinary", dependencies: directory });
  await rejects(denied.listAdminProducts(), "FORBIDDEN");
  await rejects(denied.getAdminProductByCode("FAMILY-1"), "FORBIDDEN");
  assert.equal(called, 0);
});
test("not configured and source failure remain distinct from not found", async () => {
  const disconnected = createCatalogReadRepository(notConfiguredCatalogSource, { session: "valid", dependencies: directory });
  await rejects(disconnected.listPublishedProducts(), "NOT_CONFIGURED");
  await rejects(disconnected.listAdminProducts(), "NOT_CONFIGURED");
  const failing = createCatalogReadRepository({ mode: "offline", async listPublished() { throw Error("SECRET SQL"); },
    async getPublishedBySlug() { throw Error("SECRET SQL"); }, async listAdmin() { throw Error("SECRET SQL"); },
    async getAdminByCode() { throw Error("SECRET SQL"); } });
  await rejects(failing.getPublishedProductBySlug("family-1"), "SOURCE_UNAVAILABLE");
  await assert.rejects(failing.listPublishedProducts(), (e) => e.code === "SOURCE_UNAVAILABLE" && !e.message.includes("SECRET"));
});
test("stable keyset pagination, filters, and invalid parameters", async () => {
  const r = repo();
  const first = await r.listPublishedProducts({ limit: 1 });
  const second = await r.listPublishedProducts({ limit: 1, cursor: first.nextCursor });
  assert.deepEqual([...first.items, ...second.items].map((x) => x.productCode), ["FAMILY-1", "FAMILY-4"]);
  assert.equal(second.nextCursor, null);
  assert.equal((await r.listAdminProducts({ status: "draft" })).items.length, 1);
  assert.equal((await r.listPublishedProducts({ categoryId: id(204) })).items.length, 2);
  for (const query of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { sort: "updated" },
    { status: "draft" }, { categoryId: "mock-id" }, { cursor: "bad" }, { sql: "anything" },
    { cursor: first.nextCursor, productType: "different" }])
    await rejects(r.listPublishedProducts(query), "INVALID_INPUT");
});
test("admin pagination keeps updated_at DESC and id ASC across three two-row pages", async () => {
  const rows = [10, 11, 12, 13, 14, 15].map((n) => {
    const row = bundle(n);
    const updated_at = n === 10 ? "2026-10-03T00:00:00.000Z" :
      n === 11 ? "2026-10-02T00:00:00.000Z" : date;
    return { ...row, product: { ...row.product, updated_at } };
  });
  const read = repo("valid", rows);
  const pages = [];
  let cursor;
  for (let page = 0; page < 3; page++) {
    const result = await read.listAdminProducts({ limit: 2, cursor });
    pages.push(result.items.map((item) => item.productCode));
    cursor = result.nextCursor ?? undefined;
    if (page < 2) assert.ok(cursor);
    else assert.equal(cursor, undefined);
  }
  assert.deepEqual(pages, [["FAMILY-10", "FAMILY-11"], ["FAMILY-12", "FAMILY-13"], ["FAMILY-14", "FAMILY-15"]]);
  assert.equal(new Set(pages.flat()).size, 6);
  assert.deepEqual(await read.listAdminProducts({ productType: "none" }), { items: [], nextCursor: null });
  const adminCursor = (await read.listAdminProducts({ limit: 2 })).nextCursor;
  await rejects(read.listAdminProducts({ limit: 2, cursor: "invalid" }), "INVALID_INPUT");
  await rejects(read.listAdminProducts({ limit: 2, cursor: adminCursor, status: "published" }), "INVALID_INPUT");
  await rejects(read.listPublishedProducts({ limit: 2, cursor: adminCursor }), "INVALID_INPUT");
  const publicCursor = (await read.listPublishedProducts({ limit: 2, sort: "featured" })).nextCursor;
  await rejects(read.listPublishedProducts({ limit: 2, sort: "newest", cursor: publicCursor }), "INVALID_INPUT");
});
