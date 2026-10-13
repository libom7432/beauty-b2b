import assert from "node:assert/strict";
import test from "node:test";
import { validateCatalogProduct, validateCatalogBatch, normalizeVariantAttributes } from "../src/lib/catalog-validation/index.ts";

const PID = "11111111-1111-4111-8111-111111111111";
const VID = "22222222-2222-4222-8222-222222222222";
const CID = "33333333-3333-4333-8333-333333333333";
const IID = "44444444-4444-4444-8444-444444444444";
const category = { id: CID, parent_id: null, slug: "press-on-nails", status: "published" };
function product() {
  return {
    id: PID, product_code: "PO-001", slug: "press-on-set", product_type: "press_on_nails", status: "published",
    attributes: { design: "Floral", material: "abs" }, customization_options: [],
    oem: true, odm: true, lead_time_min_days: 7, lead_time_max_days: 14, seo_indexable: true,
    featured: false, new_arrival: false,
    variants: [{ id: VID, product_id: PID, sku: "PO-001-A", status: "published", attributes: { nail_shape: "almond", nail_size: "m" }, moq_quantity: 100, moq_unit: "sets", reference_price: 2.5, reference_currency: "USD" }],
    translations: ["en", "zh"].map((locale) => ({ locale, name: "Name", short_description: "Short", description: "Description", seo_title: "SEO title", seo_description: "SEO description" })),
    categories: [{ category_id: CID, is_primary: true }],
    images: [{ id: IID, product_id: PID, storage_key: "products/po-001.webp", public_url: "/products/po-001.webp", role: "primary", status: "published", sort_order: 0, format: "webp", width: 800, height: 800, alt_en: "Nails", alt_zh: "穿戴甲" }],
  };
}
const check = (p, context = {}) => validateCatalogProduct(p, { categories: [category], ...context });
const codes = (result) => result.issues.map((issue) => issue.error_code);
const has = (result, code) => assert.ok(codes(result).includes(code), `${code}: ${JSON.stringify(result.issues)}`);

test("complete published product and canonical category path", () => {
  const result = check(product());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.canonical_category_path, "press-on-nails");
});
test("required fields, SQL types, lead time and report metadata", () => {
  const p = product();
  p.product_code = " "; p.slug = "Bad Slug"; p.oem = "yes"; p.lead_time_max_days = 2;
  const result = check(p, { row_number: 7 });
  for (const code of ["REQUIRED_TEXT", "INVALID_SLUG", "INVALID_BOOLEAN", "LEAD_TIME_ORDER"]) has(result, code);
  assert.ok(result.issues.length >= 4);
  assert.deepEqual(Object.keys(result.issues[0]).sort(), ["error_code", "field_path", "message", "row_number", "severity"].sort());
  assert.equal(result.issues[0].row_number, 7);
});
test("batch catches duplicate product code, slug, SKU and storage key", () => {
  const second = product(); second.variants[0].attributes.nail_size = "l";
  const [first, repeated] = validateCatalogBatch([{ operation: "create", product: product() }, { operation: "create", product: second }], { categories: [category] });
  assert.equal(first.valid, true);
  for (const code of ["DUPLICATE_PRODUCT_CODE", "DUPLICATE_SLUG", "DUPLICATE_SKU", "DUPLICATE_STORAGE_KEY"]) has(repeated, code);
  assert.equal(repeated.issues[0].row_number, 2);
});
test("duplicate normalized specification catches case and whitespace", () => {
  const p = product();
  p.variants.push({ ...p.variants[0], id: "55555555-5555-4555-8555-555555555555", sku: "PO-001-B", attributes: { " Nail_Shape ": " ALMOND ", nail_size: "M" } });
  has(check(p), "DUPLICATE_SPECIFICATION");
  assert.deepEqual(normalizeVariantAttributes({ " COLOR ": " Rose   Pink " }), { color: "rose pink" });
  assert.throws(() => normalizeVariantAttributes({ Color: "red", color: "blue" }));
  assert.throws(() => normalizeVariantAttributes({ "\tcolor\t": "red" }));
  assert.deepEqual(normalizeVariantAttributes({ color: "\tRose\t" }), { color: " rose " });
});
test("MOQ, package, multiple, numeric price and ISO currency", () => {
  const p = product(); const v = p.variants[0];
  v.moq_quantity = 0; v.order_multiple = 0; v.package_quantity = 10; v.reference_price = -1; v.reference_currency = "ZZZ";
  const result = check(p);
  for (const code of ["INVALID_MOQ", "INVALID_ORDER_MULTIPLE", "PACKAGE_PAIR", "INVALID_PRICE", "INVALID_CURRENCY"]) has(result, code);
});
test("published translations, primary category, SKU and image are mandatory", () => {
  const p = product(); p.translations.pop(); p.categories = []; p.variants[0].status = "draft"; p.images = [];
  const result = check(p);
  for (const code of ["MISSING_TRANSLATION", "MISSING_PRIMARY_CATEGORY", "MISSING_PUBLISHED_SKU", "MISSING_PRIMARY_IMAGE"]) has(result, code);
});
test("draft accepts incomplete content, but preserves database field rules", () => {
  const p = product(); p.status = "draft"; p.variants = []; p.translations = []; p.categories = []; p.images = [];
  assert.equal(check(p).valid, true);
  p.attributes.unknown = "future";
  const result = check(p);
  assert.equal(result.valid, true);
  assert.equal(result.issues.find((issue) => issue.error_code === "UNDEFINED_ATTRIBUTE")?.severity, "warning");
});
test("retired product cannot retain a published SKU", () => {
  const p = product(); p.status = "retired";
  has(check(p), "RETIRED_PUBLISHED_SKU");
});
test("unknown, retired, cyclic and too-deep primary categories", () => {
  const p = product();
  has(check(p, { categories: [] }), "UNKNOWN_CATEGORY");
  has(check(p, { categories: [{ ...category, status: "retired" }] }), "UNPUBLISHED_CATEGORY");
  has(check(p, { categories: [{ ...category, parent_id: CID }] }), "CATEGORY_CYCLE");
  const secondary = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", parent_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", slug: "secondary", status: "published" };
  p.categories.push({ category_id: secondary.id, is_primary: false });
  has(check(p, { categories: [category, secondary] }), "CATEGORY_CYCLE");
  p.categories.pop();
  const root = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", parent_id: null, slug: "a", status: "published" };
  const mid = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", parent_id: root.id, slug: "b", status: "published" };
  const low = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", parent_id: mid.id, slug: "c", status: "published" };
  has(check(p, { categories: [category, root, mid, low, { ...category, parent_id: low.id }] }), "CATEGORY_DEPTH");
});
test("image SKU must belong to product, primary ALT required", () => {
  const p = product(); p.images[0].alt_zh = ""; p.images[0].public_url = "javascript:bad";
  p.images.push({ ...p.images[0], id: "66666666-6666-4666-8666-666666666666", storage_key: "other.webp", role: "variant", variant_id: "77777777-7777-4777-8777-777777777777" });
  const result = check(p);
  has(result, "MISSING_PRIMARY_ALT"); has(result, "IMAGE_VARIANT_MISMATCH");
  has(result, "INVALID_IMAGE_URL");
});
test("published attributes must use controlled template; templates can be extended", () => {
  const p = product(); p.attributes.fabric = "cotton";
  has(check(p), "UNDEFINED_ATTRIBUTE");
  p.product_type = "nail_tools"; p.attributes = { material: "steel" }; p.variants[0].attributes = { size: "small" };
  const result = check(p, { templates: { nail_tools: { product: { material: { kind: "string", values: ["steel"] } }, sku: { size: { kind: "string", values: ["small", "large"] } } } } });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
});
test("existing identifiers and published slug are immutable", () => {
  const p = product(); p.product_code = "PO-002"; p.slug = "renamed"; p.variants[0].sku = "PO-002-A";
  const result = check(p, { operation: "update", previous: { id: PID, product_code: "PO-001", slug: "press-on-set", published_at: "2026-10-13T00:00:00Z", skus: { [VID]: "PO-001-A" } } });
  for (const code of ["IMMUTABLE_PRODUCT_CODE", "IMMUTABLE_PUBLISHED_SLUG", "IMMUTABLE_SKU"]) has(result, code);
});

test("existing identifiers conflict on create but are legal for own product and SKU update", () => {
  const p = product();
  const existing = { productCodes: new Set([p.product_code]), slugs: new Set([p.slug]), skus: new Set([p.variants[0].sku]), imageStorageKeys: new Set([p.images[0].storage_key]) };
  const previous = { id: PID, product_code: p.product_code, slug: p.slug, published_at: "2026-10-13T00:00:00Z", skus: { [VID]: p.variants[0].sku }, images: { [IID]: p.images[0].storage_key } };
  const created = check(p, { operation: "create", ...existing });
  for (const code of ["DUPLICATE_PRODUCT_CODE", "DUPLICATE_SLUG", "DUPLICATE_SKU", "DUPLICATE_STORAGE_KEY"]) has(created, code);
  const updated = check(p, { operation: "update", previous, ...existing });
  assert.equal(updated.valid, true, JSON.stringify(updated.issues));
  const wrongIdentity = check(p, { operation: "update", previous: { ...previous, id: CID }, ...existing });
  has(wrongIdentity, "UPDATE_ID_MISMATCH");
  has(check(p, { operation: "update", ...existing }), "MISSING_UPDATE_IDENTITY");
});

test("batch update retains own identities; duplicate update target and create conflicts fail", () => {
  const p = product();
  const previous = { id: PID, product_code: p.product_code, slug: p.slug, skus: { [VID]: p.variants[0].sku }, images: { [IID]: p.images[0].storage_key } };
  const existing = { categories: [category], productCodes: new Set([p.product_code]), slugs: new Set([p.slug]), skus: new Set([p.variants[0].sku]), imageStorageKeys: new Set([p.images[0].storage_key]) };
  const result = validateCatalogBatch([
    { operation: "update", product: p, previous },
    { operation: "update", product: structuredClone(p), previous },
    { operation: "create", product: structuredClone(p) },
  ], existing);
  assert.equal(result[0].valid, true, JSON.stringify(result[0].issues));
  has(result[1], "DUPLICATE_UPDATE_TARGET");
  has(result[2], "DUPLICATE_PRODUCT_CODE");
  has(result[2], "DUPLICATE_SKU");
  assert.deepEqual(result.map((r) => r.issues[0]?.row_number), [undefined, 2, 3]);
});

test("complete final snapshot rejects removal of last published association", () => {
  for (const [remove, expected] of [
    [(p) => { p.variants = []; }, "MISSING_PUBLISHED_SKU"],
    [(p) => { p.categories = []; }, "MISSING_PRIMARY_CATEGORY"],
    [(p) => { p.images = []; }, "MISSING_PRIMARY_IMAGE"],
    [(p) => { p.translations = p.translations.filter((t) => t.locale !== "zh"); }, "MISSING_TRANSLATION"],
  ]) {
    const p = product(); remove(p);
    has(check(p), expected);
  }
});

test("one bad import row does not stop later rows; error paths and SKU metadata are stable", () => {
  const bad = product(); bad.variants[0].moq_quantity = 0; bad.variants[0].reference_price = -1;
  const good = product(); good.product_code = "PO-002"; good.slug = "press-on-two"; good.variants[0].sku = "PO-002-A"; good.images[0].storage_key = "products/po-002.webp";
  const [first, second] = validateCatalogBatch([{ operation: "create", product: bad }, { operation: "create", product: good }], { categories: [category], row_number: 20 });
  assert.equal(first.valid, false); assert.equal(second.valid, true, JSON.stringify(second.issues));
  const issue = first.issues.find((i) => i.error_code === "INVALID_MOQ");
  assert.deepEqual(issue, { error_code: "INVALID_MOQ", field_path: "variants[0].moq_quantity", message: "MOQ must be a positive safe integer", severity: "error", row_number: 20, product_code: "PO-001", sku: "PO-001-A" });
});
