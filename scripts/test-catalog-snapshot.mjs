import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogCsvBundle } from "../src/lib/catalog-import/csv.ts";
import { captureTrustedCatalogSnapshot, catalogSnapshotDigest, resolveCatalogImport } from "../src/lib/catalog-import/snapshot.ts";

const ID = {
  a: "11111111-1111-4111-8111-111111111111", b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333", d: "44444444-4444-4444-8444-444444444444",
  v1: "55555555-5555-4555-8555-555555555555", v2: "66666666-6666-4666-8666-666666666666",
  i1: "77777777-7777-4777-8777-777777777777", i2: "88888888-8888-4888-8888-888888888888",
};
const dates = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
const product = (id, code, status = "draft") => ({ ...dates, id, product_code: code, slug: code.toLowerCase(), product_type: "press_on_nails", status,
  attributes: { design: "Floral" }, customization_options: [], oem: false, odm: false, lead_time_min_days: null, lead_time_max_days: null,
  seo_indexable: false, featured: false, new_arrival: false, published_at: status === "published" ? "2026-01-03T00:00:00Z" : null });
const variant = (id, product_id, sku, status = "draft") => ({ ...dates, id, product_id, sku, status, attributes: { nail_shape: "almond" },
  moq_quantity: 100, moq_unit: "sets", order_multiple: null, package_quantity: null, package_unit: null,
  reference_price: null, reference_currency: null, sort_order: 0 });
const category = (id, slug, status = "published", parent_id = null) => ({ ...dates, id, parent_id, slug, status,
  name_en: slug, name_zh: slug, description_en: "", description_zh: "", sort_order: 0 });
const image = (id, product_id, storage_key, status = "draft") => ({ ...dates, id, product_id, variant_id: null, storage_key, public_url: `/images/${storage_key}`,
  role: "primary", status, sort_order: 0, width: 800, height: 800, format: "webp", alt_en: "Image", alt_zh: "图片" });
const translation = (product_id, locale) => ({ ...dates, product_id, locale, name: "Name", short_description: "Short", description: "Detail", seo_title: "SEO", seo_description: "SEO detail" });
const baseRows = () => ({
  products: [product(ID.a, "DEMO-A", "published"), product(ID.b, "DEMO-B")],
  variants: [variant(ID.v1, ID.a, "SKU-A", "published"), variant(ID.v2, ID.b, "SKU-B")],
  categories: [category(ID.c, "nails"), category(ID.d, "hidden", "draft")],
  product_categories: [{ ...dates, product_id: ID.a, category_id: ID.c, is_primary: true, sort_order: 0 }],
  images: [image(ID.i1, ID.a, "products/a.webp", "published"), image(ID.i2, ID.b, "products/b.webp")],
  translations: [translation(ID.a, "en"), translation(ID.a, "zh")],
});
const snapshot = (mutate = () => {}) => { const rows = baseRows(); mutate(rows); return captureTrustedCatalogSnapshot(rows, "templates-v1"); };
const HEADERS = {
  "products.csv": ["operation", "product_code", "slug", "product_type", "status", "attributes"],
  "product_variants.csv": ["operation", "product_code", "sku", "status", "attributes", "moq_quantity", "moq_unit"],
  "product_translations.csv": ["operation", "product_code", "locale", "name"],
  "product_categories.csv": ["operation", "product_code", "category_id", "is_primary"],
  "product_images.csv": ["operation", "product_code", "image_id", "sku", "source_file", "storage_key", "public_url", "role", "status"],
};
const csvCell = (value) => `"${(value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")).replaceAll('"', '""')}"`;
function parsed(rows) {
  const files = {};
  for (const [name, records] of Object.entries(rows)) {
    const header = HEADERS[name];
    files[name] = `${header.join(",")}\n${records.map((record) => header.map((field) => csvCell(record[field])).join(",")).join("\n")}\n`;
  }
  return parseCatalogCsvBundle(files, { knownProductCodes: new Set(["DEMO-A", "DEMO-B"]) });
}
const codes = (result) => result.issues.map((issue) => issue.error_code);
const has = (result, code) => assert.ok(codes(result).includes(code), `${code}: ${JSON.stringify(result.issues)}`);
const productCreate = (code = "DEMO-C") => ({ operation: "create", product_code: code, slug: code.toLowerCase(), product_type: "press_on_nails", status: "draft" });
const productUpdate = (code = "DEMO-A", more = {}) => ({ operation: "update", product_code: code, ...more });
const variantCreate = (code = "DEMO-C", sku = "SKU-C") => ({ operation: "create", product_code: code, sku, status: "draft", attributes: { nail_shape: "oval" }, moq_quantity: 100, moq_unit: "sets" });
const variantUpdate = (code = "DEMO-A", sku = "SKU-A", more = {}) => ({ operation: "update", product_code: code, sku, ...more });
const imageCreate = (code = "DEMO-C", more = {}) => ({ operation: "create", product_code: code, storage_key: "products/c.webp", public_url: "/images/c.webp", role: "primary", status: "draft", ...more });

test("empty trusted snapshot accepts all-new product and SKU", () => {
  const empty = captureTrustedCatalogSnapshot({ products: [], variants: [], categories: [], product_categories: [], images: [], translations: [] }, "templates-v1");
  const result = resolveCatalogImport(parsed({ "products.csv": [productCreate()], "product_variants.csv": [variantCreate()] }), empty);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.deepEqual(result.rows.map((row) => [row.identity, row.product_id, row.variant_id]), [["new", undefined, undefined], ["new", undefined, undefined]]);
});
test("existing product and SKU updates resolve only trusted UUIDs", () => {
  const result = resolveCatalogImport(parsed({ "products.csv": [productUpdate("DEMO-A", { status: "published" })], "product_variants.csv": [variantUpdate()] }), snapshot());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.rows[0].product_id, ID.a);
  assert.equal(result.rows[1].variant_id, ID.v1);
});
test("new SKU under an existing product remains new", () => {
  const result = resolveCatalogImport(parsed({ "product_variants.csv": [variantCreate("DEMO-A", "SKU-NEW")] }), snapshot());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.rows[0].product_id, ID.a);
  assert.equal(result.rows[0].variant_id, undefined);
});
test("duplicate product code and SKU report both batch conflicts", () => {
  const result = resolveCatalogImport(parsed({ "products.csv": [productCreate(), productCreate()], "product_variants.csv": [variantCreate(), variantCreate()] }), snapshot());
  has(result, "DUPLICATE_PRODUCT_CODE"); has(result, "DUPLICATE_SKU");
});
test("create colliding with existing product or SKU is rejected", () => {
  const result = resolveCatalogImport(parsed({ "products.csv": [productCreate("DEMO-A")], "product_variants.csv": [variantCreate("DEMO-A", "SKU-A")] }), snapshot());
  has(result, "PRODUCT_ALREADY_EXISTS"); has(result, "SKU_ALREADY_EXISTS");
});
test("update missing product or SKU is rejected", () => {
  const result = resolveCatalogImport(parsed({ "products.csv": [productUpdate("UNKNOWN")], "product_variants.csv": [variantUpdate("DEMO-A", "UNKNOWN-SKU")] }), snapshot());
  has(result, "PRODUCT_NOT_FOUND"); has(result, "SKU_NOT_FOUND");
});
test("global SKU identity cannot be moved to another product", () => {
  has(resolveCatalogImport(parsed({ "product_variants.csv": [variantUpdate("DEMO-B", "SKU-A")] }), snapshot()), "SKU_OWNERSHIP_CONFLICT");
});
test("category UUID must exist and be published", () => {
  const result = resolveCatalogImport(parsed({ "product_categories.csv": [
    { operation: "create", product_code: "DEMO-B", category_id: "99999999-9999-4999-8999-999999999999" },
    { operation: "create", product_code: "DEMO-B", category_id: ID.d },
  ] }), snapshot());
  has(result, "CATEGORY_NOT_FOUND"); has(result, "CATEGORY_UNAVAILABLE");
});
test("existing category and translation links use composite identity", () => {
  const result = resolveCatalogImport(parsed({ "product_categories.csv": [{ operation: "update", product_code: "DEMO-A", category_id: ID.c, is_primary: true }],
    "product_translations.csv": [{ operation: "update", product_code: "DEMO-A", locale: "en", name: "New" }] }), snapshot());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.rows.find((row) => row.file_name === "product_categories.csv")?.category_id, ID.c);
});
test("image update requires existing ID and same-product ownership", () => {
  const result = resolveCatalogImport(parsed({ "product_images.csv": [
    { operation: "update", product_code: "DEMO-A", image_id: ID.i2 },
    { operation: "update", product_code: "DEMO-A", image_id: "99999999-9999-4999-8999-999999999999" },
  ] }), snapshot());
  has(result, "IMAGE_OWNERSHIP_CONFLICT"); has(result, "IMAGE_NOT_FOUND");
});
test("image SKU must resolve within the same product", () => {
  const result = resolveCatalogImport(parsed({ "product_images.csv": [imageCreate("DEMO-A", { sku: "SKU-B", storage_key: "products/new.webp" })] }), snapshot());
  has(result, "IMAGE_SKU_OWNERSHIP_CONFLICT");
});
test("new image uses no image ID and cannot reuse an existing storage key", () => {
  const result = resolveCatalogImport(parsed({ "product_images.csv": [imageCreate("DEMO-A", { image_id: ID.i1, storage_key: "products/a.webp" })] }), snapshot());
  has(result, "IMAGE_ID_ON_CREATE");
  const second = resolveCatalogImport(parsed({ "product_images.csv": [imageCreate("DEMO-A", { storage_key: "products/b.webp" })] }), snapshot());
  has(second, "IMAGE_STORAGE_KEY_CONFLICT");
});
test("published slug is immutable and other product slug cannot be reused", () => {
  const result = resolveCatalogImport(parsed({ "products.csv": [productUpdate("DEMO-A", { slug: "demo-b" })] }), snapshot());
  has(result, "PUBLISHED_SLUG_IMMUTABLE"); has(result, "SLUG_CONFLICT");
});
test("retired product cannot reactivate or gain published SKU", () => {
  const retired = snapshot((rows) => { rows.products[1].status = "retired"; });
  const result = resolveCatalogImport(parsed({ "products.csv": [productUpdate("DEMO-B", { status: "published" })],
    "product_variants.csv": [variantCreate("DEMO-B", "SKU-NEW")].map((row) => ({ ...row, status: "published" })) }), retired);
  has(result, "RETIRED_REACTIVATION_FORBIDDEN");
  has(result, "RETIRED_PRODUCT_PUBLISHED_SKU");
  const skuOnly = resolveCatalogImport(parsed({ "product_variants.csv": [{ ...variantCreate("DEMO-B", "SKU-NEW"), status: "published" }] }), retired);
  has(skuOnly, "RETIRED_PRODUCT_PUBLISHED_SKU");
});
test("rows omitted from a patch retain product, SKU, image and other relations", () => {
  const current = snapshot();
  const before = catalogSnapshotDigest(current);
  const result = resolveCatalogImport(parsed({ "products.csv": [productUpdate("DEMO-A", { oem: true })] }), current);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.rows.length, 1);
  assert.equal(current.products.length, 2); assert.equal(current.variants.length, 2); assert.equal(current.images.length, 2);
  assert.equal(current.translations.length, 2); assert.equal(current.product_categories.length, 1);
  assert.equal(catalogSnapshotDigest(current), before);
});
test("digest is stable across row and property order but changes with business state", () => {
  const first = snapshot();
  const reordered = snapshot((rows) => {
    rows.products.reverse(); rows.variants.reverse(); rows.translations.reverse();
    rows.products[0] = Object.fromEntries(Object.entries(rows.products[0]).reverse());
  });
  assert.equal(catalogSnapshotDigest(first), catalogSnapshotDigest(reordered));
  assert.equal(catalogSnapshotDigest(first), catalogSnapshotDigest(snapshot()));
  const changed = snapshot((rows) => { rows.products[0].featured = true; });
  assert.notEqual(catalogSnapshotDigest(first), catalogSnapshotDigest(changed));
  const changedImage = snapshot((rows) => { rows.images[1].status = "retired"; });
  assert.notEqual(catalogSnapshotDigest(first), catalogSnapshotDigest(changedImage));
  const timestampOnly = snapshot((rows) => { rows.products[0].updated_at = "2030-01-01T00:00:00Z"; });
  assert.equal(catalogSnapshotDigest(first), catalogSnapshotDigest(timestampOnly));
  const publishedAtPresence = snapshot((rows) => { rows.products[1].published_at = "2026-01-03T00:00:00Z"; });
  assert.notEqual(catalogSnapshotDigest(first), catalogSnapshotDigest(publishedAtPresence));
  const categoryStatus = snapshot((rows) => { rows.categories[1].status = "retired"; });
  assert.notEqual(catalogSnapshotDigest(first), catalogSnapshotDigest(categoryStatus));
  const skuOwner = snapshot((rows) => { rows.variants[1].product_id = ID.a; rows.variants[1].attributes = { nail_shape: "oval" }; });
  assert.notEqual(catalogSnapshotDigest(first), catalogSnapshotDigest(skuOwner));
  const imageVariant = snapshot((rows) => { rows.images[1].role = "variant"; rows.images[1].variant_id = ID.v2; });
  assert.notEqual(catalogSnapshotDigest(first), catalogSnapshotDigest(imageVariant));
  const templateVersion = captureTrustedCatalogSnapshot(baseRows(), "templates-v2");
  assert.notEqual(catalogSnapshotDigest(first), catalogSnapshotDigest(templateVersion));
});
test("snapshot input is copied and frozen; an unbranded object is rejected", () => {
  const rows = baseRows();
  const trusted = captureTrustedCatalogSnapshot(rows, "templates-v1");
  rows.products[0].slug = "tampered";
  rows.products[0].attributes.design = "Tampered";
  rows.products[0].customization_options.push("Tampered");
  assert.equal(trusted.products[0].slug, "demo-a");
  assert.equal(trusted.products[0].attributes.design, "Floral");
  assert.deepEqual(trusted.products[0].customization_options, []);
  assert.ok(Object.isFrozen(trusted.products[0]));
  assert.ok(Object.isFrozen(trusted.products[0].attributes));
  assert.ok(Object.isFrozen(trusted.products[0].customization_options));
  assert.throws(() => { trusted.products[0].attributes.design = "Changed"; }, TypeError);
  assert.throws(() => { trusted.products[0].customization_options.push("Changed"); }, TypeError);
  assert.throws(() => resolveCatalogImport(parsed({ "products.csv": [productUpdate()] }), { ...trusted }), /trusted constructor/);
});
test("duplicate snapshot identities and contradictory B2 states are rejected", () => {
  assert.throws(() => snapshot((rows) => { rows.products[1].id = ID.a; }), /duplicate products id/);
  assert.throws(() => snapshot((rows) => { rows.products[1].product_code = "DEMO-A"; }), /duplicate product code/);
  assert.throws(() => snapshot((rows) => { rows.variants[1].sku = "SKU-A"; }), /duplicate SKU/);
  assert.throws(() => snapshot((rows) => { rows.products[0].published_at = null; }), /publication state/);
  assert.throws(() => snapshot((rows) => { rows.products[1].status = "retired"; rows.variants[1].status = "published"; }), /retired product SKU/);
  assert.throws(() => snapshot((rows) => { rows.images[0].variant_id = ID.v1; }), /image role/);
  assert.throws(() => snapshot((rows) => { rows.images[0].status = "retired"; }), /primary image requirement/);
  assert.throws(() => snapshot((rows) => { rows.product_categories.length = 0; }), /primary category requirement/);
  assert.throws(() => snapshot((rows) => { rows.translations.pop(); }), /translation requirement/);
  assert.throws(() => snapshot((rows) => { rows.categories[0].parent_id = ID.d; rows.categories[1].parent_id = ID.c; }), /category cycle/);
  assert.throws(() => snapshot((rows) => { rows.variants[1].product_id = ID.a; rows.variants[1].attributes = { nail_shape: " ALMOND " }; }), /duplicate SKU combination/);
});
test("malformed identities and unsafe snapshot data are rejected", () => {
  const malformed = resolveCatalogImport(parsed({ "products.csv": [productCreate(" BAD ")] }), snapshot());
  has(malformed, "INVALID_PRODUCT_CODE");
  assert.throws(() => captureTrustedCatalogSnapshot({ ...baseRows(), products: [product("invalid", "DEMO-A")] }, "templates-v1"), /identity/);
  const malicious = baseRows(); malicious.products[0].attributes = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => captureTrustedCatalogSnapshot(malicious, "templates-v1"), /snapshot key/);
});
test("untrusted UUID and product/SKU identity fields cannot override snapshot identity", () => {
  const forged = parsed({ "products.csv": [productUpdate()], "product_variants.csv": [variantUpdate()] });
  forged.rows["products.csv"][0].data.id = ID.b;
  forged.rows["product_variants.csv"][0].data.product_id = ID.b;
  const result = resolveCatalogImport(forged, snapshot());
  has(result, "IMMUTABLE_PRODUCT_IDENTITY");
  has(result, "IMMUTABLE_SKU_IDENTITY");
  assert.equal(result.rows[0].product_id, ID.a);
  assert.equal(result.rows[1].variant_id, ID.v1);
});
test("published category requires an available ancestor chain", () => {
  assert.throws(() => snapshot((rows) => { rows.categories.push(category("99999999-9999-4999-8999-999999999999", "nested", "published", ID.d)); }), /published category parent/);
  const current = snapshot((rows) => { rows.categories.push(category("99999999-9999-4999-8999-999999999999", "nested", "draft", ID.d)); });
  const result = resolveCatalogImport(parsed({ "product_categories.csv": [{ operation: "create", product_code: "DEMO-B", category_id: "99999999-9999-4999-8999-999999999999" }] }), current);
  has(result, "CATEGORY_UNAVAILABLE");
});
test("resolution errors preserve CSV provenance and optional Excel source location", () => {
  const result = resolveCatalogImport(parsed({ "product_variants.csv": [variantUpdate("DEMO-B", "SKU-A")] }), snapshot(), () => ({ sheet_name: "Variants", column_name: "SKU" }));
  const issue = result.issues.find((entry) => entry.error_code === "SKU_OWNERSHIP_CONFLICT");
  assert.deepEqual([issue.file_name, issue.sheet_name, issue.row_number, issue.column_name, issue.field_path, issue.product_code, issue.sku],
    ["product_variants.csv", "Variants", 2, "SKU", "sku", "DEMO-B", "SKU-A"]);
});
test("resolved patch data is detached from subsequent uploaded-object mutation", () => {
  const upload = parsed({ "products.csv": [productUpdate("DEMO-A", { status: "draft" })] });
  const result = resolveCatalogImport(upload, snapshot());
  upload.rows["products.csv"][0].data.status = "retired";
  assert.equal(result.rows[0].data.status, "draft");
  assert.ok(Object.isFrozen(result.rows[0].data));
});
