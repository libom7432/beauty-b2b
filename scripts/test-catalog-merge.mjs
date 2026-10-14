import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseCatalogCsvBundle } from "../src/lib/catalog-import/csv.ts";
import { convertCatalogWorkbook } from "../src/lib/catalog-import/excel.ts";
import { captureTrustedCatalogSnapshot, catalogSnapshotDigest } from "../src/lib/catalog-import/snapshot.ts";
import { assertNoPreviewCatalogIds, mergeCatalogImport } from "../src/lib/catalog-import/merge.ts";

const id = {
  p1: "11111111-1111-4111-8111-111111111111", p2: "22222222-2222-4222-8222-222222222222",
  c1: "33333333-3333-4333-8333-333333333333", c2: "44444444-4444-4444-8444-444444444444",
  v1: "55555555-5555-4555-8555-555555555555", v2: "66666666-6666-4666-8666-666666666666",
  i1: "77777777-7777-4777-8777-777777777777", i2: "88888888-8888-4888-8888-888888888888",
};
const time = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
const product = (uuid, code, status) => ({ ...time, id: uuid, product_code: code, slug: code.toLowerCase(), product_type: "press_on_nails", status,
  attributes: { design: "Floral" }, customization_options: [], oem: false, odm: false, lead_time_min_days: null, lead_time_max_days: null,
  seo_indexable: false, featured: false, new_arrival: false, published_at: status === "published" ? "2026-01-03T00:00:00Z" : null });
const variant = (uuid, owner, sku, status) => ({ ...time, id: uuid, product_id: owner, sku, status, attributes: { nail_shape: "almond" },
  moq_quantity: 100, moq_unit: "sets", order_multiple: null, package_quantity: null, package_unit: null,
  reference_price: null, reference_currency: null, sort_order: 0 });
const category = (uuid, slug) => ({ ...time, id: uuid, parent_id: null, slug, status: "published", name_en: slug, name_zh: slug, description_en: "", description_zh: "", sort_order: 0 });
const image = (uuid, owner, key, status) => ({ ...time, id: uuid, product_id: owner, variant_id: null, storage_key: key, public_url: `/images/${key}`,
  role: "primary", status, sort_order: 0, width: 800, height: 800, format: "webp", alt_en: "Image", alt_zh: "图片" });
const translation = (owner, locale) => ({ ...time, product_id: owner, locale, name: "Name", short_description: "Short", description: "Detail", seo_title: "SEO", seo_description: "SEO detail" });
const rows = () => ({
  products: [product(id.p1, "DEMO-A", "published"), product(id.p2, "DEMO-B", "draft")],
  variants: [variant(id.v1, id.p1, "SKU-A", "published"), variant(id.v2, id.p2, "SKU-B", "draft")],
  categories: [category(id.c1, "nails"), category(id.c2, "polish")],
  product_categories: [{ ...time, product_id: id.p1, category_id: id.c1, is_primary: true, sort_order: 0 }],
  images: [image(id.i1, id.p1, "a.webp", "published"), image(id.i2, id.p2, "b.webp", "draft")],
  translations: [translation(id.p1, "en"), translation(id.p1, "zh")],
});
const snapshot = (change = () => {}) => { const data = rows(); change(data); return captureTrustedCatalogSnapshot(data, "templates-v1"); };
const HEAD = {
  "products.csv": ["operation", "product_code", "slug", "product_type", "status", "oem", "odm", "attributes", "lead_time_min_days"],
  "product_variants.csv": ["operation", "product_code", "sku", "status", "attributes", "moq_quantity", "moq_unit", "order_multiple", "reference_price", "reference_currency"],
  "product_translations.csv": ["operation", "product_code", "locale", "name", "short_description", "description", "seo_title", "seo_description"],
  "product_categories.csv": ["operation", "product_code", "category_id", "is_primary", "sort_order"],
  "product_images.csv": ["operation", "product_code", "image_id", "sku", "storage_key", "public_url", "role", "status", "alt_en", "alt_zh"],
};
const cell = (value) => `"${(value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")).replaceAll('"', '""')}"`;
const parse = (batch, current) => {
  const files = Object.fromEntries(Object.entries(batch).map(([name, records]) => [name, `${HEAD[name].join(",")}\n${records.map((record) => HEAD[name].map((key) => cell(record[key])).join(",")).join("\n")}\n`]));
  return parseCatalogCsvBundle(files, { knownProductCodes: new Set(current.products.map((entry) => entry.product_code)) });
};
const run = (batch, current = snapshot()) => mergeCatalogImport(parse(batch, current), current);
const codes = (result) => result.issues.map((issue) => issue.error_code);
const has = (result, code) => assert.ok(codes(result).includes(code), `${code}: ${JSON.stringify(result.issues)}`);
const update = (code = "DEMO-A", extra = {}) => ({ operation: "update", product_code: code, ...extra });
const create = (code = "DEMO-C", extra = {}) => ({ operation: "create", product_code: code, slug: code.toLowerCase(), product_type: "press_on_nails", ...extra });
const skuCreate = (code = "DEMO-B", sku = "SKU-C", extra = {}) => ({ operation: "create", product_code: code, sku, status: "draft", attributes: { nail_shape: "oval" }, moq_quantity: 50, moq_unit: "sets", ...extra });
const final = (result, code = "DEMO-A") => result.products.find((item) => item.product_code === code);

test("single and multiple field patches retain other product data", () => {
  const one = run({ "products.csv": [update("DEMO-A", { oem: true })] });
  assert.equal(one.valid, true, JSON.stringify(one.issues)); assert.equal(final(one).product.oem, true); assert.equal(final(one).product.odm, false);
  const two = run({ "products.csv": [update("DEMO-A", { oem: true, odm: true })] });
  assert.equal(two.valid, true, JSON.stringify(two.issues)); assert.equal(final(two).product.odm, true);
  assert.ok(two.changes.every((change) => change.file_name === "products.csv" && change.row_number === 2));
});
test("missing and blank preserve values; value overwrites", () => {
  const result = run({ "products.csv": [update("DEMO-A", { oem: "", odm: true })] });
  assert.equal(result.valid, true); assert.equal(final(result).product.oem, false); assert.equal(final(result).product.odm, true);
  assert.ok(result.changes.every((change) => change.field_path !== "oem"));
  const noColumn = parseCatalogCsvBundle({ "products.csv": "operation,product_code,slug,product_type,status\nupdate,DEMO-A,,,\n" }, { knownProductCodes: new Set(["DEMO-A"]) });
  const missing = mergeCatalogImport(noColumn, snapshot());
  assert.equal(missing.valid, true); assert.equal(final(missing).product.attributes.design, "Floral");
});
test("allowed clear uses B4.2 typed value; forbidden clear blocks batch", () => {
  const okay = run({ "products.csv": [update("DEMO-A", { lead_time_min_days: "__CLEAR__", attributes: "__CLEAR__" })] });
  assert.equal(okay.valid, true, JSON.stringify(okay.issues)); assert.equal(final(okay).product.lead_time_min_days, null);
  assert.deepEqual(final(okay).product.attributes, {}); assert.ok(okay.changes.some((change) => change.cell_state === "clear"));
  const bad = run({ "products.csv": [update("DEMO-A", { status: "__CLEAR__" })] });
  has(bad, "CLEAR_NOT_ALLOWED"); assert.equal(bad.can_apply, false);
});
test("existing product accepts new SKU and existing SKU update", () => {
  const add = run({ "product_variants.csv": [skuCreate()] });
  assert.equal(add.valid, true, JSON.stringify(add.issues)); assert.equal(final(add, "DEMO-B").variants.length, 2);
  const edit = run({ "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", moq_quantity: 250 }] });
  assert.equal(edit.valid, true, JSON.stringify(edit.issues)); assert.equal(final(edit).variants[0].moq_quantity, 250);
  assert.equal(final(edit).variants[0].attributes.nail_shape, "almond");
});
test("translation create and update preserve other locales and fields", () => {
  const result = run({ "product_translations.csv": [
    { operation: "update", product_code: "DEMO-A", locale: "en", name: "New name" },
    { operation: "create", product_code: "DEMO-B", locale: "zh", name: "中文名称" },
  ] });
  assert.equal(result.valid, true, JSON.stringify(result.issues)); assert.equal(final(result).translations[0].name, "New name");
  assert.equal(final(result).translations[1].name, "Name"); assert.equal(final(result, "DEMO-B").translations[0].name, "中文名称");
});
test("category links can be created and updated without deleting omitted links", () => {
  const result = run({ "product_categories.csv": [
    { operation: "update", product_code: "DEMO-A", category_id: id.c1, is_primary: false },
    { operation: "create", product_code: "DEMO-A", category_id: id.c2, is_primary: true },
  ] });
  assert.equal(result.valid, true, JSON.stringify(result.issues)); assert.equal(final(result).categories.length, 2);
  assert.equal(final(result).categories.find((item) => item.category_id === id.c1).is_primary, false);
});
test("image metadata update and new SKU image retain existing image", () => {
  const result = run({ "product_variants.csv": [skuCreate()], "product_images.csv": [
    { operation: "update", product_code: "DEMO-B", image_id: id.i2, alt_en: "Updated" },
    { operation: "create", product_code: "DEMO-B", sku: "SKU-C", storage_key: "c.webp", public_url: "/images/c.webp", role: "variant" },
  ] });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(final(result, "DEMO-B").images.length, 2);
  assert.equal(final(result, "DEMO-B").images[0].alt_en, "Updated");
  assert.equal(final(result, "DEMO-B").images[1].variant_id, final(result, "DEMO-B").variants[1].id);
});
test("new draft product may remain partial and has preview-only identity", () => {
  const result = run({ "products.csv": [create()] });
  assert.equal(result.valid, true, JSON.stringify(result.issues)); assert.equal(final(result, "DEMO-C").operation, "create");
  assert.equal(final(result, "DEMO-C").identity.kind, "preview"); assert.equal(final(result, "DEMO-C").variants.length, 0);
  assert.match(final(result, "DEMO-C").product.id, /^preview:product:[a-f0-9]{64}$/);
  assert.throws(() => assertNoPreviewCatalogIds(final(result, "DEMO-C")), /cannot be persisted/);
  assert.doesNotThrow(() => assertNoPreviewCatalogIds(final(run({ "products.csv": [update("DEMO-A", { oem: true })] }))));
});
test("published create is validated after complete merge", () => {
  const incomplete = run({ "products.csv": [create("DEMO-C", { status: "published" })] });
  has(incomplete, "MISSING_PUBLISHED_SKU"); has(incomplete, "MISSING_TRANSLATION"); has(incomplete, "MISSING_PRIMARY_IMAGE");
  assert.equal(incomplete.can_apply, false);
  const complete = run({
    "products.csv": [create("DEMO-C", { status: "published" })],
    "product_variants.csv": [skuCreate("DEMO-C", "SKU-C", { status: "published" })],
    "product_translations.csv": ["en", "zh"].map((locale) => ({ operation: "create", product_code: "DEMO-C", locale, name: "Name", short_description: "Short", description: "Detail", seo_title: "SEO", seo_description: "SEO detail" })),
    "product_categories.csv": [{ operation: "create", product_code: "DEMO-C", category_id: id.c1, is_primary: true }],
    "product_images.csv": [{ operation: "create", product_code: "DEMO-C", storage_key: "c.webp", public_url: "/images/c.webp", role: "primary", status: "published", alt_en: "Image", alt_zh: "图片" }],
  });
  assert.equal(complete.valid, true, JSON.stringify(complete.issues)); assert.equal(complete.can_apply, true);
  const created = final(complete, "DEMO-C");
  assert.match(created.variants[0].id, /^preview:variant:/);
  assert.match(created.images[0].id, /^preview:image:/);
  assert.throws(() => assertNoPreviewCatalogIds(created), /cannot be persisted/);
});
test("final-state B3 rejects invalid MOQ, duplicate specification and missing published fields", () => {
  const moq = run({ "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", moq_quantity: 0 }] });
  assert.equal(moq.can_apply, false); assert.ok(codes(moq).includes("INVALID_VALUE") || codes(moq).includes("INVALID_MOQ"));
  const duplicate = run({ "product_variants.csv": [skuCreate("DEMO-A", "SKU-C", { attributes: { nail_shape: " ALMOND " } })] });
  has(duplicate, "DUPLICATE_SPECIFICATION");
  const badTranslation = run({ "product_translations.csv": [{ operation: "update", product_code: "DEMO-A", locale: "en", name: "__CLEAR__" }] });
  has(badTranslation, "INCOMPLETE_TRANSLATION");
});
test("published final state rejects loss of its only active SKU, category or image", () => {
  has(run({ "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", status: "retired" }] }), "MISSING_PUBLISHED_SKU");
  has(run({ "product_categories.csv": [{ operation: "update", product_code: "DEMO-A", category_id: id.c1, is_primary: false }] }), "MISSING_PRIMARY_CATEGORY");
  has(run({ "product_images.csv": [{ operation: "update", product_code: "DEMO-A", image_id: id.i1, status: "retired" }] }), "MISSING_PRIMARY_IMAGE");
});
test("price spelling remains decimal text, while B3 checks its numeric value and currency", () => {
  const good = run({ "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", reference_price: "12.3400", reference_currency: "USD" }] });
  assert.equal(good.valid, true, JSON.stringify(good.issues)); assert.equal(final(good).variants[0].reference_price, "12.3400");
  const bad = run({ "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", reference_price: "12.34" }] });
  has(bad, "PRICE_CURRENCY_PAIR");
});
test("child blanks preserve records and image SKU clear remains explicit", () => {
  const current = snapshot((data) => { data.images[1].role = "variant"; data.images[1].variant_id = id.v2; });
  const blank = run({ "product_variants.csv": [{ operation: "update", product_code: "DEMO-B", sku: "SKU-B", moq_quantity: "" }],
    "product_translations.csv": [{ operation: "create", product_code: "DEMO-B", locale: "en", name: "" }],
    "product_images.csv": [{ operation: "update", product_code: "DEMO-B", image_id: id.i2, sku: "" }] }, current);
  assert.equal(blank.valid, true, JSON.stringify(blank.issues)); assert.equal(final(blank, "DEMO-B").variants[0].moq_quantity, 100);
  assert.equal(final(blank, "DEMO-B").images[0].variant_id, id.v2);
  const clear = run({ "product_images.csv": [{ operation: "update", product_code: "DEMO-B", image_id: id.i2, sku: "__CLEAR__", role: "detail" }] }, current);
  assert.equal(clear.valid, true, JSON.stringify(clear.issues)); assert.equal(final(clear, "DEMO-B").images[0].variant_id, null);
});
test("resolver conflicts and retired transition prohibit entire batch", () => {
  has(run({ "product_variants.csv": [skuCreate("DEMO-B", "SKU-A")] }), "SKU_OWNERSHIP_CONFLICT");
  has(run({ "product_variants.csv": [skuCreate("DEMO-B", "SKU-C"), skuCreate("DEMO-B", "SKU-C")] }), "DUPLICATE_SKU");
  has(run({ "products.csv": [create("DEMO-C"), create("DEMO-C")] }), "DUPLICATE_PRODUCT_CODE");
  has(run({ "product_categories.csv": [{ operation: "create", product_code: "DEMO-B", category_id: "99999999-9999-4999-8999-999999999999" }] }), "CATEGORY_NOT_FOUND");
  has(run({ "product_images.csv": [{ operation: "update", product_code: "DEMO-B", image_id: id.i1 }] }), "IMAGE_OWNERSHIP_CONFLICT");
  const retired = snapshot((data) => { data.products[1].status = "retired"; });
  has(run({ "products.csv": [update("DEMO-B", { status: "draft" })] }, retired), "RETIRED_REACTIVATION_FORBIDDEN");
});
test("unsupported relation removal is rejected rather than simulated", () => {
  const result = run({ "product_categories.csv": [{ operation: "delete", product_code: "DEMO-A", category_id: id.c1 }] });
  assert.equal(result.can_apply, false); assert.equal(final(result), undefined);
  assert.equal(snapshot().product_categories.length, 1);
});
test("published slug remains stable and one bad product blocks a multi-product batch", () => {
  has(run({ "products.csv": [update("DEMO-A", { slug: "new-slug" })] }), "PUBLISHED_SLUG_IMMUTABLE");
  const result = run({ "products.csv": [create("DEMO-C"), update("DEMO-A", { status: "published" })],
    "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", moq_quantity: 0 }] });
  assert.equal(result.can_apply, false); assert.equal(result.products.length, 2); assert.ok(result.issues.length > 0);
});
test("two updates cannot converge on one new slug or image storage key", () => {
  const source = snapshot((data) => { data.products[0].status = "draft"; data.products[0].published_at = null; });
  const slugs = run({ "products.csv": [update("DEMO-A", { slug: "shared-slug" }), update("DEMO-B", { slug: "shared-slug" })] }, source);
  has(slugs, "FINAL_SLUG_CONFLICT"); assert.equal(slugs.can_apply, false);
  const images = run({ "product_images.csv": [
    { operation: "update", product_code: "DEMO-A", image_id: id.i1, storage_key: "shared.webp" },
    { operation: "update", product_code: "DEMO-B", image_id: id.i2, storage_key: "shared.webp" },
  ] });
  has(images, "FINAL_STORAGE_KEY_CONFLICT"); assert.equal(images.can_apply, false);
});
test("multiple valid products, source trace and immutable snapshot", () => {
  const trusted = snapshot(); const digest = catalogSnapshotDigest(trusted);
  const result = run({ "products.csv": [update("DEMO-A", { oem: true }), create("DEMO-C")] }, trusted);
  assert.equal(result.valid, true, JSON.stringify(result.issues)); assert.equal(result.products.length, 2);
  assert.deepEqual(result.changes.find((change) => change.field_path === "oem"), {
    entity: "product", identity: "DEMO-A", operation: "update", field_path: "oem", before: false, after: true,
    cell_state: "value", file_name: "products.csv", row_number: 2, product_code: "DEMO-A",
  });
  assert.equal(trusted.products[0].oem, false); assert.equal(catalogSnapshotDigest(trusted), digest);
});
test("B3 final-state errors retain CSV and optional Excel source location", () => {
  const current = snapshot();
  const input = parse({ "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", reference_price: "9.9900" }] }, current);
  const result = mergeCatalogImport(input, current, () => ({ sheet_name: "Variants", column_name: "Price" }));
  const issue = result.issues.find((entry) => entry.error_code === "PRICE_CURRENCY_PAIR");
  assert.deepEqual([issue.file_name, issue.row_number, issue.sheet_name, issue.column_name, issue.product_code],
    ["product_variants.csv", 2, "Variants", "Price", "DEMO-A"]);
});
test("B4.3 Excel parsed output reaches the same final state as canonical CSV", async () => {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Products");
  sheet.addRow(["operation", "product_code", "slug", "product_type", "oem"]);
  sheet.addRow(["update", "DEMO-A", "", "", true]);
  const mapped = await convertCatalogWorkbook(new Uint8Array(await book.xlsx.writeBuffer()), { sheets: [{ sheet: "Products", target: "products.csv",
    columns: ["operation", "product_code", "slug", "product_type", "oem"].map((name) => ({ source: name, target: name })) }] });
  assert.equal(mapped.valid, true, JSON.stringify(mapped.issues));
  const current = snapshot();
  const excel = mergeCatalogImport(mapped.parsed, current);
  const csv = run({ "products.csv": [update("DEMO-A", { oem: true })] }, current);
  assert.deepEqual(excel.products, csv.products);
  assert.deepEqual(excel.changes, csv.changes);
});
test("no-op MOQ, name, semantic SKU attributes, translation, category and image update is unchanged", () => {
  const current = snapshot((data) => { data.variants[0].attributes = { nail_shape: "almond", finish: "glossy" }; });
  const batch = {
    "products.csv": [update("DEMO-A", { status: "published" })],
    "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", moq_quantity: 100, attributes: { finish: "glossy", nail_shape: "almond" } }],
    "product_translations.csv": [{ operation: "update", product_code: "DEMO-A", locale: "en", name: "Name", description: "Detail" }],
    "product_categories.csv": [{ operation: "update", product_code: "DEMO-A", category_id: id.c1, is_primary: true }],
    "product_images.csv": [{ operation: "update", product_code: "DEMO-A", image_id: id.i1, storage_key: "a.webp", alt_en: "Image" }],
  };
  const result = run(batch, current);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.outcome, "unchanged"); assert.equal(result.can_apply, true);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(final(result).variants[0].attributes, current.variants[0].attributes);
});
test("a complete no-op batch is stable across runs and object key order", () => {
  const current = snapshot();
  const firstInput = parse({ "products.csv": [update("DEMO-A", { oem: false })] }, current);
  const first = mergeCatalogImport(firstInput, current);
  const reordered = structuredClone(firstInput);
  reordered.rows = Object.fromEntries(Object.entries(reordered.rows).reverse());
  for (const rows of Object.values(reordered.rows)) for (const row of rows) {
    row.fields = Object.fromEntries(Object.entries(row.fields).reverse());
    row.data = Object.fromEntries(Object.entries(row.data).reverse());
  }
  const second = mergeCatalogImport(reordered, current);
  assert.deepEqual(first, second);
  assert.equal(first.outcome, "unchanged"); assert.deepEqual(first.changes, []);
});
test("changed and failed batches are deterministic; forged identity cannot enable a write", () => {
  const current = snapshot();
  const source = parse({ "products.csv": [update("DEMO-A", { oem: true })], "product_variants.csv": [{ operation: "update", product_code: "DEMO-A", sku: "SKU-A", reference_price: "9.99" }] }, current);
  const first = mergeCatalogImport(source, current);
  const second = mergeCatalogImport(source, current);
  assert.deepEqual(first, second);
  assert.equal(first.outcome, "invalid"); assert.equal(first.can_apply, false);
  assert.equal(Object.hasOwn(first, "plan"), false);
  const forged = structuredClone(source);
  forged.rows["products.csv"][0].data.id = id.p2;
  const conflict = mergeCatalogImport(forged, current);
  has(conflict, "IMMUTABLE_PRODUCT_IDENTITY"); assert.equal(conflict.can_apply, false);
  assert.equal(current.products[0].id, id.p1);
});
test("changed JSON Patch has deterministic final state and change order", () => {
  const current = snapshot();
  const input = parse({ "products.csv": [update("DEMO-A", { attributes: { material: "gel", design: "Floral" }, oem: true })] }, current);
  const first = mergeCatalogImport(input, current);
  const reordered = structuredClone(input);
  const row = reordered.rows["products.csv"][0];
  row.fields = Object.fromEntries(Object.entries(row.fields).reverse());
  row.data = Object.fromEntries(Object.entries(row.data).reverse());
  row.data.attributes = Object.fromEntries(Object.entries(row.data.attributes).reverse());
  const second = mergeCatalogImport(reordered, current);
  assert.equal(first.outcome, "changed");
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first.products), JSON.stringify(second.products));
});
