import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { convertCatalogWorkbook } from "../src/lib/catalog-import/excel.ts";
import { getImportCsvColumns, parseCatalogCsvBundle } from "../src/lib/catalog-import/csv.ts";

const map = (sheet = "商品") => ({ sheets: [{ sheet, target: "products.csv", columns: [
  { source: "操作", target: "operation" }, { source: "商品编码", target: "product_code" },
  { source: "链接", target: "slug" }, { source: "类型", target: "product_type" },
  { source: "OEM", target: "oem" }, { source: "交期", target: "lead_time_min_days" },
] }] });
async function book(sheets) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const sheet = wb.addWorksheet(name);
    for (const row of rows) sheet.addRow(row);
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
const base = [["操作", "商品编码", "链接", "类型", "OEM", "交期"], ["create", "DEMO-1", "demo-one", "press_on_nails", true, 7]];
const has = (result, code) => assert.ok(result.issues.some((issue) => issue.error_code === code), `${code}: ${JSON.stringify(result.issues)}`);

test("single sheet Chinese headers create canonical CSV accepted by B4.2", async () => {
  const result = await convertCatalogWorkbook(await book({ 商品: base }), map());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.parsed.products[0].product.oem, true);
  assert.equal(result.parsed.products[0].product.lead_time_min_days, 7);
  assert.deepEqual(result.parsed.rows, parseCatalogCsvBundle(result.csvFiles).rows);
});
test("English headers and multiple sheets map to one product with SKU", async () => {
  const bytes = await book({ Products: [["action", "code", "slug", "type"], ["create", "DEMO-1", "demo-one", "press_on_nails"]], Variants: [["action", "code", "sku", "qty", "unit"], ["create", "DEMO-1", "DEMO-1-A", 100, "sets"]] });
  const mapping = { sheets: [
    { sheet: "Products", target: "products.csv", columns: [{ source: "action", target: "operation" }, { source: "code", target: "product_code" }, { source: "slug", target: "slug" }, { source: "type", target: "product_type" }] },
    { sheet: "Variants", target: "product_variants.csv", columns: [{ source: "action", target: "operation" }, { source: "code", target: "product_code" }, { source: "sku", target: "sku" }, { source: "qty", target: "moq_quantity" }, { source: "unit", target: "moq_unit" }] },
  ] };
  const result = await convertCatalogWorkbook(bytes, mapping);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.parsed.products[0].variants[0].sku, "DEMO-1-A");
});
test("blank, clear, value and unmapped missing survive B4.2", async () => {
  const rows = [["操作", "商品编码", "链接", "类型", "OEM", "交期"], ["update", "DEMO-1", "", "", true, "__CLEAR__"]];
  const result = await convertCatalogWorkbook(await book({ 商品: rows }), map());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  const fields = result.parsed.rows["products.csv"][0].fields;
  assert.equal(fields.slug.kind, "blank");
  assert.equal(fields.lead_time_min_days.kind, "clear");
  assert.equal(fields.oem.kind, "value");
  assert.equal(fields.attributes.kind, "missing");
});
test("missing sheet, column, duplicate header and duplicate target mapping", async () => {
  const bytes = await book({ 商品: base });
  has(await convertCatalogWorkbook(bytes, map("不存在")), "MISSING_SHEET");
  const absent = map(); absent.sheets[0].columns[0].source = "不存在";
  has(await convertCatalogWorkbook(bytes, absent), "MISSING_COLUMN");
  const dup = map(); dup.sheets[0].columns.push({ source: "链接", target: "product_code" });
  has(await convertCatalogWorkbook(bytes, dup), "DUPLICATE_TARGET_FIELD");
  const repeated = await book({ 商品: [["操作", "商品编码", "商品编码", "类型", "OEM", "交期"], ...base.slice(1)] });
  has(await convertCatalogWorkbook(repeated, map()), "DUPLICATE_HEADER");
});
test("invalid configuration rejects unknown target and transform", async () => {
  const mapping = map(); mapping.sheets[0].columns.push({ source: "链接", target: "unknown", transform: "eval" });
  const result = await convertCatalogWorkbook(await book({ 商品: base }), mapping);
  has(result, "UNKNOWN_TARGET_FIELD"); has(result, "INVALID_TRANSFORM");
});
test("formula, date and rich text cells are rejected with sheet coordinates", async () => {
  const rows = [["操作", "商品编码", "链接", "类型", "OEM", "交期"], ["create", "DEMO-1", { formula: 'HYPERLINK("https://invalid.example")', result: "demo-one" }, "press_on_nails", true, 7], ["create", "DEMO-2", "demo-two", "press_on_nails", true, new Date("2026-01-01")], ["create", "DEMO-3", "demo-three", "press_on_nails", true, { richText: [{ text: "7" }] }]];
  const result = await convertCatalogWorkbook(await book({ 商品: rows }), map());
  has(result, "FORMULA_CELL"); has(result, "UNSUPPORTED_CELL_TYPE");
  const formula = result.issues.find((issue) => issue.error_code === "FORMULA_CELL");
  assert.deepEqual([formula.sheet_name, formula.row_number, formula.column_number], ["商品", 2, 3]);
});
test("B4.2 errors resolve back to Excel row and column", async () => {
  const rows = [["操作", "商品编码", "链接", "类型", "OEM", "交期"], ["create", "DEMO-1", "demo-one", "press_on_nails", "yes", 7]];
  const result = await convertCatalogWorkbook(await book({ 商品: rows }), map());
  const issue = result.issues.find((item) => item.error_code === "INVALID_VALUE");
  assert.deepEqual([issue.sheet_name, issue.row_number, issue.column_name, issue.column_number, issue.field_path], ["商品", 2, "OEM", 5, "oem"]);
});
test("limits and corrupted workbook fail safely", async () => {
  const bytes = await book({ 商品: base });
  has(await convertCatalogWorkbook(bytes, map(), { maxWorkbookBytes: 4 }), "WORKBOOK_TOO_LARGE");
  has(await convertCatalogWorkbook(bytes, map(), { maxSheets: 0 }), "SHEET_LIMIT");
  has(await convertCatalogWorkbook(bytes, map(), { maxEntries: 1 }), "WORKBOOK_LIMIT");
  has(await convertCatalogWorkbook(new Uint8Array([1, 2, 3]), map()), "INVALID_WORKBOOK");
});
test("fixed defaults and explicit transform are deterministic", async () => {
  const bytes = await book({ Products: [["code", "slug", "type"], ["DEMO-1", " Demo-One ", "PRESS_ON_NAILS"]] });
  const mapping = { sheets: [{ sheet: "Products", target: "products.csv", columns: [
    { target: "operation", defaultValue: "create" }, { target: "product_code", source: "code" },
    { target: "slug", source: "slug", transform: "trim" }, { target: "product_type", source: "type", transform: "lowercase" },
  ] }] };
  const result = await convertCatalogWorkbook(bytes, mapping);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.parsed.products[0].product.slug, "Demo-One");
});
test("all five standard targets use B4.2 field contracts", async () => {
  const specs = {
    "products.csv": { operation: "create", product_code: "DEMO-1", slug: "demo-one", product_type: "press_on_nails" },
    "product_variants.csv": { operation: "create", product_code: "DEMO-1", sku: "DEMO-1-A", moq_quantity: 100, moq_unit: "sets" },
    "product_translations.csv": { operation: "create", product_code: "DEMO-1", locale: "en", name: "Demo" },
    "product_categories.csv": { operation: "create", product_code: "DEMO-1", category_id: "33333333-3333-4333-8333-333333333333", is_primary: true },
    "product_images.csv": { operation: "create", product_code: "DEMO-1", storage_key: "products/demo.webp", public_url: "/images/demo.webp", role: "primary" },
  };
  const sheets = {}, mappings = [];
  for (const [target, data] of Object.entries(specs)) {
    const fields = Object.keys(data);
    assert.ok(fields.every((field) => getImportCsvColumns(target).includes(field)));
    sheets[target] = [fields, fields.map((field) => data[field])];
    mappings.push({ sheet: target, target, columns: fields.map((field) => ({ source: field, target: field })) });
  }
  const result = await convertCatalogWorkbook(await book(sheets), { sheets: mappings });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(Object.keys(result.csvFiles).length, 5);
  assert.equal(result.parsed.products[0].images[0].role, "primary");
});
test("unsafe numeric precision and worksheet row limits are reported", async () => {
  const rows = [["操作", "商品编码", "链接", "类型", "OEM", "交期"], ["create", "DEMO-1", "demo-one", "press_on_nails", true, 9007199254740992]];
  const bytes = await book({ 商品: rows });
  has(await convertCatalogWorkbook(bytes, map()), "UNSUPPORTED_CELL_TYPE");
  has(await convertCatalogWorkbook(bytes, map(), { maxRows: 0 }), "ROW_LIMIT");
});
test("optional B3 create validation runs after B4.2; update remains a patch", async () => {
  const rows = [["操作", "商品编码", "链接", "类型", "OEM", "交期"], ["create", "DEMO-1", "BAD-SLUG", "press_on_nails", true, 7]];
  const create = await convertCatalogWorkbook(await book({ 商品: rows }), map(), { validationContext: {} });
  assert.equal(create.b3Results.length, 1);
  assert.equal(create.valid, false);
  assert.ok(create.issues.some((issue) => issue.sheet_name === "商品" && issue.product_code === "DEMO-1"));
  rows[1][0] = "update";
  const update = await convertCatalogWorkbook(await book({ 商品: rows }), map(), { validationContext: {} });
  assert.equal(update.b3Results.length, 0);
});
test("independent standard CSV and Excel paths yield equivalent five-file update patches", async () => {
  const records = {
    "products.csv": [["operation", "product_code", "slug", "product_type", "attributes", "oem"], ["update", "DEMO-1", "", "", "__CLEAR__", true]],
    "product_variants.csv": [["operation", "product_code", "sku", "moq_quantity", "moq_unit", "order_multiple", "reference_price", "reference_currency"], ["update", "DEMO-1", "DEMO-1-A", 100, "sets", "__CLEAR__", 12.5, "USD"]],
    "product_translations.csv": [["operation", "product_code", "locale", "name", "short_description"], ["update", "DEMO-1", "en", "__CLEAR__", ""]],
    "product_categories.csv": [["operation", "product_code", "category_id", "is_primary", "sort_order"], ["update", "DEMO-1", "33333333-3333-4333-8333-333333333333", "", 1]],
    "product_images.csv": [["operation", "product_code", "image_id", "storage_key", "public_url", "role", "alt_en"], ["update", "DEMO-1", "44444444-4444-4444-8444-444444444444", "", "", "", "__CLEAR__"]],
  };
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  const csv = Object.fromEntries(Object.entries(records).map(([file, rows]) => [file, `${rows[0].join(",")}\n${rows[1].map(escape).join(",")}\n`]));
  const knownProductCodes = new Set(["DEMO-1"]);
  const direct = parseCatalogCsvBundle(csv, { knownProductCodes });
  const mapping = { sheets: Object.entries(records).map(([target, rows]) => ({ sheet: target, target, columns: rows[0].map((name) => ({ source: name, target: name })) })) };
  const converted = await convertCatalogWorkbook(await book(records), mapping, { knownProductCodes });
  assert.equal(direct.valid, true, JSON.stringify(direct.issues));
  assert.equal(converted.valid, true, JSON.stringify(converted.issues));
  assert.deepEqual(converted.parsed.products, direct.products);
  assert.deepEqual(converted.parsed.rows, direct.rows);
  assert.equal(converted.parsed.products[0].source.product.fields.slug.kind, "blank");
  assert.equal(converted.parsed.products[0].source.product.fields.attributes.kind, "clear");
  assert.equal(converted.parsed.products[0].source.product.fields.oem.kind, "value");
  assert.equal(converted.parsed.products[0].source.product.fields.odm.kind, "missing");
});
test("Excel and CSV report the same B4.2 error semantics", async () => {
  const headers = ["operation", "product_code", "sku", "status", "attributes", "moq_quantity", "moq_unit"];
  const values = ["create", "DEMO-1", "DEMO-1-A", "draft", "{}", "bad", "sets"];
  const direct = parseCatalogCsvBundle({ "product_variants.csv": `${headers.join(",")}\n${values.join(",")}\n` }, { knownProductCodes: new Set(["DEMO-1"]) });
  const mapping = { sheets: [{ sheet: "Variants", target: "product_variants.csv", columns: headers.map((name) => ({ source: name, target: name })) }] };
  const converted = await convertCatalogWorkbook(await book({ Variants: [headers, values] }), mapping, { knownProductCodes: new Set(["DEMO-1"]) });
  const semantic = (issues) => issues.map(({ error_code, field_path, severity, product_code, sku }) => ({ error_code, field_path, severity, product_code, sku }));
  assert.deepEqual(semantic(converted.parsed.issues), semantic(direct.issues));
});
test("preparse limits reject worksheet count, cell count and cell text", async () => {
  const bytes = await book({ 商品: base, Other: base });
  has(await convertCatalogWorkbook(bytes, map(), { maxSheets: 1 }), "SHEET_LIMIT");
  has(await convertCatalogWorkbook(bytes, map(), { maxCells: 1 }), "CELL_LIMIT");
  has(await convertCatalogWorkbook(bytes, map(), { maxFieldChars: 2 }), "CELL_TEXT_LIMIT");
});
test("external workbook relationships are rejected before cell conversion", async () => {
  const rows = [["操作", "商品编码", "链接", "类型", "OEM", "交期"], ["create", "DEMO-1", { text: "demo-one", hyperlink: "https://example.invalid/" }, "press_on_nails", true, 7]];
  has(await convertCatalogWorkbook(await book({ 商品: rows }), map()), "EXTERNAL_RELATIONSHIP");
});
