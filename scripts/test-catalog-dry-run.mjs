import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { parseCatalogCsvBundle } from "../src/lib/catalog-import/csv.ts";
import { convertCatalogWorkbook } from "../src/lib/catalog-import/excel.ts";
import { captureTrustedCatalogSnapshot } from "../src/lib/catalog-import/snapshot.ts";
import { compareCatalogSnapshotVersion, createCatalogDryRunReport } from "../src/lib/catalog-import/dry-run.ts";
import { assertNoPreviewCatalogIds } from "../src/lib/catalog-import/merge.ts";

const id = {
  a: "11111111-1111-4111-8111-111111111111", b: "22222222-2222-4222-8222-222222222222",
  c1: "33333333-3333-4333-8333-333333333333", c2: "44444444-4444-4444-8444-444444444444",
  va: "55555555-5555-4555-8555-555555555555", vb: "66666666-6666-4666-8666-666666666666",
  ia: "77777777-7777-4777-8777-777777777777", ib: "88888888-8888-4888-8888-888888888888",
};
const ts = { created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" };
const product = (uuid, code) => ({ ...ts, id: uuid, product_code: code, slug: code.toLowerCase(), product_type: "press_on_nails", status: "draft",
  attributes: { design: "Floral" }, customization_options: [], oem: false, odm: false, lead_time_min_days: null, lead_time_max_days: null,
  seo_indexable: false, featured: false, new_arrival: false, published_at: null });
const variant = (uuid, product_id, sku) => ({ ...ts, id: uuid, product_id, sku, status: "draft", attributes: { nail_shape: "almond" },
  moq_quantity: 100, moq_unit: "sets", order_multiple: null, package_quantity: null, package_unit: null,
  reference_price: null, reference_currency: null, sort_order: 0 });
const category = (uuid, slug) => ({ ...ts, id: uuid, parent_id: null, slug, status: "published", name_en: slug, name_zh: slug,
  description_en: "", description_zh: "", sort_order: 0 });
const image = (uuid, product_id, key) => ({ ...ts, id: uuid, product_id, variant_id: null, storage_key: key, public_url: `/images/${key}`,
  role: "primary", status: "draft", sort_order: 0, width: 800, height: 800, format: "webp", alt_en: "Image", alt_zh: "图片" });
const translation = (product_id, locale) => ({ ...ts, product_id, locale, name: "Name", short_description: "Short",
  description: "Detail", seo_title: "SEO", seo_description: "SEO detail" });
const snapshot = (mutate = () => {}) => {
  const rows = { products: [product(id.a, "DEMO-A"), product(id.b, "DEMO-B")],
    variants: [variant(id.va, id.a, "SKU-A"), variant(id.vb, id.b, "SKU-B")], categories: [category(id.c1, "nails"), category(id.c2, "polish")],
    product_categories: [{ ...ts, product_id: id.a, category_id: id.c1, is_primary: true, sort_order: 0 }],
    images: [image(id.ia, id.a, "a.webp"), image(id.ib, id.b, "b.webp")], translations: [translation(id.a, "en"), translation(id.a, "zh")] };
  mutate(rows);
  return captureTrustedCatalogSnapshot(rows, "templates-v1");
};
const HEAD = {
  "products.csv": ["operation", "product_code", "slug", "product_type", "status", "attributes", "oem"],
  "product_variants.csv": ["operation", "product_code", "sku", "status", "attributes", "moq_quantity", "moq_unit"],
  "product_translations.csv": ["operation", "product_code", "locale", "name", "short_description", "description", "seo_title", "seo_description"],
  "product_categories.csv": ["operation", "product_code", "category_id", "is_primary"],
  "product_images.csv": ["operation", "product_code", "image_id", "sku", "storage_key", "public_url", "role", "status", "alt_en", "alt_zh"],
};
const cell = (value) => `"${(value && typeof value === "object" ? JSON.stringify(value) : String(value ?? "")).replaceAll('"', '""')}"`;
const parse = (batch, current) => {
  const files = Object.fromEntries(Object.entries(batch).map(([name, rows]) => [name,
    `${HEAD[name].join(",")}\n${rows.map((row) => HEAD[name].map((field) => cell(row[field])).join(",")).join("\n")}\n`]));
  return parseCatalogCsvBundle(files, { knownProductCodes: new Set(current.products.map((row) => row.product_code)) });
};
const create = (code, other = {}) => ({ operation: "create", product_code: code, slug: code.toLowerCase(), product_type: "press_on_nails", ...other });
const update = (code, other = {}) => ({ operation: "update", product_code: code, ...other });
const report = (batch, current = snapshot(), source = "csv", locate) => createCatalogDryRunReport(parse(batch, current), current, source, locate);

test("all-new products derive created statistics from final states", () => {
  const result = report({ "products.csv": [create("DEMO-C"), create("DEMO-D")] });
  assert.deepEqual([result.report_status, result.total_products, result.created_count, result.updated_count, result.unchanged_count, result.invalid_count],
    ["ready", 2, 2, 0, 0, 0]);
  assert.equal(result.can_proceed_to_review, true);
  assert.deepEqual(result.product_results.map((row) => [row.product_code, row.result_status, row.action]),
    [["DEMO-C", "created", "create"], ["DEMO-D", "created", "create"]]);
  assert.ok(result.field_changes.length < 10, "create defaults should not fill the report");
});
test("all-updated and mixed batches have accurate product counts", () => {
  const updated = report({ "products.csv": [update("DEMO-A", { oem: true }), update("DEMO-B", { oem: true })] });
  assert.deepEqual([updated.created_count, updated.updated_count, updated.unchanged_count], [0, 2, 0]);
  const mixed = report({ "products.csv": [create("DEMO-C"), update("DEMO-A", { oem: true }), update("DEMO-B", { oem: false })] });
  assert.deepEqual([mixed.total_products, mixed.created_count, mixed.updated_count, mixed.unchanged_count], [3, 1, 1, 1]);
});
test("one product with multiple SKU and field changes counts as one updated product", () => {
  const result = report({
    "products.csv": [update("DEMO-A", { oem: true, attributes: { design: "New" } })],
    "product_variants.csv": [
      { operation: "update", product_code: "DEMO-A", sku: "SKU-A", moq_quantity: 120 },
      { operation: "create", product_code: "DEMO-A", sku: "SKU-C", status: "draft", attributes: { nail_shape: "oval" }, moq_quantity: 50, moq_unit: "sets" },
    ],
  });
  assert.deepEqual([result.total_products, result.updated_count, result.product_results.length], [1, 1, 1]);
  assert.deepEqual(result.product_results[0].sku_changes, { created: 1, updated: 1 });
  assert.ok(result.field_changes.length >= 3);
  assert.equal(result.total_products, result.created_count + result.updated_count + result.unchanged_count + result.invalid_count);
});
test("no-op batch is explicit and contains no update action or field change", () => {
  const result = report({ "products.csv": [update("DEMO-A", { oem: false })] });
  assert.equal(result.report_status, "no_changes"); assert.equal(result.can_proceed_to_review, false);
  assert.deepEqual([result.created_count, result.updated_count, result.invalid_count, result.unchanged_count], [0, 0, 0, 1]);
  assert.equal(result.product_results[0].action, "none"); assert.deepEqual(result.field_changes, []);
});
test("field diff includes safe values, source and redacts translation and JSON content", () => {
  const result = report({ "products.csv": [update("DEMO-A", { oem: true, attributes: { design: "Internal Sample" } })],
    "product_translations.csv": [{ operation: "update", product_code: "DEMO-A", locale: "en", name: "Private wording" }] });
  const oem = result.field_changes.find((change) => change.field_path === "oem");
  assert.deepEqual([oem.entity_type, oem.previous_value, oem.next_value, oem.change_type, oem.source_location.file_name, oem.source_location.row_number],
    ["product", false, true, "updated", "products.csv", 2]);
  assert.ok(result.field_changes.some((change) => change.entity_type === "translation"));
  assert.equal(JSON.stringify(result).includes("Private wording"), false);
  assert.equal(JSON.stringify(result).includes("Internal Sample"), false);
});
test("SKU, translation, category and image summaries use final relationships", () => {
  const result = report({
    "product_variants.csv": [{ operation: "create", product_code: "DEMO-B", sku: "SKU-C", status: "draft", attributes: { nail_shape: "oval" }, moq_quantity: 50, moq_unit: "sets" }],
    "product_translations.csv": [{ operation: "create", product_code: "DEMO-B", locale: "en", name: "Name" }],
    "product_categories.csv": [{ operation: "create", product_code: "DEMO-B", category_id: id.c2, is_primary: true }],
    "product_images.csv": [{ operation: "create", product_code: "DEMO-B", sku: "SKU-C", storage_key: "c.webp", public_url: "/images/c.webp", role: "variant" }],
  });
  assert.equal(result.report_status, "ready", JSON.stringify(result.errors));
  const item = result.product_results[0];
  assert.deepEqual([item.sku_changes.created, item.translation_changes.created, item.category_changes.created, item.image_changes.created], [1, 1, 1, 1]);
  assert.ok(item.field_changes.some((change) => change.entity_type === "variant"));
  assert.ok(item.source_locations.every((source) => source.file_name && source.row_number && source.product_code === "DEMO-B"));
});
test("parser, resolver and B3 errors block review without a write plan", () => {
  const invalid = report({ "products.csv": [create("DEMO-C", { status: "published" })] });
  assert.equal(invalid.report_status, "invalid"); assert.equal(invalid.can_proceed_to_review, false);
  assert.deepEqual([invalid.invalid_count, invalid.error_count], [1, invalid.errors.length]);
  assert.equal(Object.hasOwn(invalid, "plan"), false);
  assert.ok(invalid.errors.some((issue) => issue.error_code === "MISSING_PUBLISHED_SKU"));
  const badRef = report({ "product_categories.csv": [{ operation: "create", product_code: "DEMO-A", category_id: "99999999-9999-4999-8999-999999999999" }] });
  assert.equal(badRef.report_status, "invalid"); assert.equal(badRef.can_proceed_to_review, false);
});
test("file-level error has no invented product identity or SKU count", () => {
  const parsed = parseCatalogCsvBundle({ "products.csv": "" });
  const result = createCatalogDryRunReport(parsed, snapshot(), "csv");
  assert.equal(result.report_status, "invalid");
  assert.equal(result.can_proceed_to_review, false);
  assert.deepEqual([result.total_products, result.invalid_count, result.product_results.length], [0, 0, 0]);
  assert.ok(result.error_count > 0);
  assert.ok(result.errors.some((issue) => issue.error_code === "EMPTY_FILE" && !Object.hasOwn(issue, "product_code")));
  assert.equal(result.field_changes.length, 0);
});
test("draft warning is counted and raw attribute key or value is not exposed", () => {
  const result = report({ "products.csv": [update("DEMO-A", { attributes: { secret_supplier_token: "hidden-value" } })] });
  assert.equal(result.report_status, "ready"); assert.ok(result.warning_count > 0);
  assert.equal(result.warning_count, result.warnings.length);
  assert.ok(result.warnings.some((issue) => issue.error_code === "UNDEFINED_ATTRIBUTE"));
  assert.equal(JSON.stringify(result).includes("secret_supplier_token"), false);
  assert.equal(JSON.stringify(result).includes("hidden-value"), false);
});
test("serialized report hides raw translation, JSON, image URL and error text", () => {
  const current = snapshot();
  const parsed = parse({
    "products.csv": [update("DEMO-A", { attributes: { private_key: "hidden-json-value" } })],
    "product_translations.csv": [{ operation: "update", product_code: "DEMO-A", locale: "en", description: "hidden-excel-cell" }],
    "product_images.csv": [{ operation: "update", product_code: "DEMO-A", image_id: id.ia, public_url: "/images/hidden-image-url.webp" }],
  }, current);
  parsed.issues.push({ error_code: "TEST_WARNING", field_path: 'products[0].attributes["private_key"]',
    message: "hidden-error-value", severity: "warning", product_code: "DEMO-A" });
  const result = createCatalogDryRunReport(parsed, current, "csv");
  const serialized = JSON.stringify(result);
  for (const secret of ["private_key", "hidden-json-value", "hidden-excel-cell", "hidden-image-url", "hidden-error-value"])
    assert.equal(serialized.includes(secret), false, secret);
  assert.ok(result.warnings.some((issue) => issue.error_code === "TEST_WARNING" && issue.field_path === "products[0].attributes.*"));
});
test("CSV and Excel provenance keeps only known coordinates", () => {
  const current = snapshot();
  const batch = parse({ "products.csv": [update("DEMO-A", { oem: true })] }, current);
  const csv = createCatalogDryRunReport(batch, current, "csv");
  assert.deepEqual(csv.product_results[0].source_locations[0], { file_name: "products.csv", row_number: 2, product_code: "DEMO-A" });
  const excel = createCatalogDryRunReport(batch, current, "excel", () => ({ sheet_name: "Products", column_name: "Code" }));
  assert.deepEqual(excel.product_results[0].source_locations[0], { file_name: "products.csv", sheet_name: "Products", row_number: 2, column_name: "Code", product_code: "DEMO-A" });
  assert.equal(excel.import_source.kind, "excel");
  const spoofed = createCatalogDryRunReport(batch, current, "excel", () => ({ sheet_name: "Products", file_name: "forged.csv", row_number: 999 }));
  assert.equal(spoofed.product_results[0].source_locations[0].file_name, "products.csv");
  assert.equal(spoofed.product_results[0].source_locations[0].row_number, 2);
});
test("B4.3 workbook conversion feeds the same report business statistics", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");
  sheet.addRow(["operation", "product_code", "slug", "product_type", "oem"]);
  sheet.addRow(["update", "DEMO-A", "", "", true]);
  const conversion = await convertCatalogWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()), { sheets: [{
    sheet: "Products", target: "products.csv", columns: ["operation", "product_code", "slug", "product_type", "oem"].map((field) => ({ source: field, target: field })),
  }] });
  assert.equal(conversion.valid, true, JSON.stringify(conversion.issues));
  const result = createCatalogDryRunReport(conversion, snapshot(), "excel");
  assert.deepEqual([result.report_status, result.updated_count, result.total_products], ["ready", 1, 1]);
});
test("Excel conversion errors block review even when a parsed CSV result exists", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Products");
  sheet.addRow(["operation", "product_code", "slug", "product_type", "oem"]);
  sheet.addRow(["update", "DEMO-A", "", "", { formula: "1=1", result: true }]);
  const conversion = await convertCatalogWorkbook(new Uint8Array(await workbook.xlsx.writeBuffer()), { sheets: [{
    sheet: "Products", target: "products.csv", columns: ["operation", "product_code", "slug", "product_type", "oem"].map((field) => ({ source: field, target: field })),
  }] });
  assert.equal(conversion.valid, false);
  const result = createCatalogDryRunReport(conversion, snapshot(), "excel");
  assert.equal(result.report_status, "invalid"); assert.equal(result.can_proceed_to_review, false);
  assert.ok(result.errors.some((issue) => issue.error_code === "FORMULA_CELL"));
  const broken = await convertCatalogWorkbook(new Uint8Array([1, 2, 3]), { sheets: [{ sheet: "Products", target: "products.csv", columns: [] }] });
  const fatal = createCatalogDryRunReport(broken, snapshot(), "excel");
  assert.equal(fatal.report_status, "invalid"); assert.equal(fatal.total_products, 0);
});
test("fabricated uploaded aggregate counts cannot alter report statistics", () => {
  const current = snapshot();
  const batch = parse({ "products.csv": [update("DEMO-A", { oem: true })] }, current);
  batch.products.push({ operation: "create", product_code: "FAKE", product: {}, variants: [], translations: [], categories: [], images: [], source: {} });
  const result = createCatalogDryRunReport(batch, current, "csv");
  assert.deepEqual([result.total_products, result.created_count, result.updated_count], [1, 0, 1]);
});
test("report ID and business output are deterministic across object key order", () => {
  const current = snapshot();
  const batch = parse({ "products.csv": [update("DEMO-A", { oem: true, attributes: { material: "gel", design: "Floral" } })] }, current);
  const first = createCatalogDryRunReport(batch, current, "csv");
  const second = createCatalogDryRunReport(batch, current, "csv");
  assert.deepEqual(first, second); assert.match(first.report_id, /^[a-f0-9]{64}$/);
  const reordered = structuredClone(batch);
  reordered.rows = Object.fromEntries(Object.entries(reordered.rows).reverse());
  for (const rows of Object.values(reordered.rows)) for (const row of rows) {
    row.fields = Object.fromEntries(Object.entries(row.fields).reverse());
    row.data = Object.fromEntries(Object.entries(row.data).reverse());
    if (row.data.attributes) row.data.attributes = Object.fromEntries(Object.entries(row.data.attributes).reverse());
  }
  assert.deepEqual(first, createCatalogDryRunReport(reordered, current, "csv"));
  const semantic = report({ "products.csv": [update("DEMO-A", { oem: true, attributes: { design: "Floral", material: "gel" } })] }, current);
  assert.deepEqual(first, semantic);
  const different = report({ "products.csv": [update("DEMO-A", { oem: false, attributes: { design: "Floral", material: "gel" } })] }, current);
  assert.notEqual(first.report_id, different.report_id);
  const newerSnapshot = snapshot((rows) => { rows.products[1].oem = true; });
  assert.notEqual(first.report_id, report({ "products.csv": [update("DEMO-A", { oem: true, attributes: { design: "Floral", material: "gel" } })] }, newerSnapshot).report_id);
});
test("new image uses a preview identity that is not a database UUID or persistence DTO", () => {
  const result = report({ "product_images.csv": [{ operation: "create", product_code: "DEMO-A", storage_key: "preview-only.webp",
    public_url: "/images/preview-only.webp", role: "detail" }] });
  const identity = result.field_changes.find((change) => change.entity_type === "image")?.entity_identity;
  assert.match(identity, /^preview:image:[a-f0-9]{64}$/);
  assert.doesNotMatch(identity, /^[a-f0-9-]{36}$/i);
  assert.throws(() => assertNoPreviewCatalogIds(result), /Preview catalog identity cannot be persisted/);
  assert.equal(Object.hasOwn(result, "sql"), false);
  assert.equal(Object.hasOwn(result, "write_plan"), false);
});
test("trusted snapshot version comparator distinguishes current, stale and invalid", () => {
  const first = snapshot();
  assert.equal(compareCatalogSnapshotVersion(first.version, first), "current");
  const changed = snapshot((rows) => { rows.products[0].oem = true; });
  assert.equal(compareCatalogSnapshotVersion(first.version, changed), "stale");
  assert.equal(compareCatalogSnapshotVersion({ ...first.version, digest: "wrong" }, first), "invalid");
  assert.equal(compareCatalogSnapshotVersion({ ...first.version, contract: "unknown" }, first), "invalid");
  assert.equal(compareCatalogSnapshotVersion(null, first), "invalid");
  assert.equal(compareCatalogSnapshotVersion(first.version, { ...first }), "invalid");
});
