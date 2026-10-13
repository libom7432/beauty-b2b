import assert from "node:assert/strict";
import test from "node:test";
import { parseCatalogCsvBundle, safeSpreadsheetText } from "../src/lib/catalog-import/csv.ts";
import { validateCatalogProduct } from "../src/lib/catalog-validation/index.ts";

const PRODUCT_HEADER = "operation,product_code,slug,product_type,status,attributes,customization_options,oem,odm,lead_time_min_days,lead_time_max_days,seo_indexable,featured,new_arrival";
const VARIANT_HEADER = "operation,product_code,sku,status,attributes,moq_quantity,moq_unit,order_multiple,package_quantity,package_unit,reference_price,reference_currency,sort_order";
const TRANSLATION_HEADER = "operation,product_code,locale,name,short_description,description,seo_title,seo_description";
const CATEGORY_HEADER = "operation,product_code,category_id,is_primary,sort_order";
const IMAGE_HEADER = "operation,product_code,image_id,sku,source_file,storage_key,public_url,role,status,sort_order,width,height,format,alt_en,alt_zh";
const product = (code = "DEMO-1") => `create,${code},demo-one,press_on_nails,draft,"{""design"":""Floral""}",[],true,false,7,14,false,false,false`;
const variant = (sku = "DEMO-1-A") => `create,DEMO-1,${sku},draft,"{""nail_shape"":""almond""}",100,sets,,,,,,0`;
const files = () => ({
  "products.csv": `${PRODUCT_HEADER}\n${product()}\n`,
  "product_translations.csv": `${TRANSLATION_HEADER}\ncreate,DEMO-1,en,Name,Short,Description,SEO title,SEO description\n`,
  "product_variants.csv": `${VARIANT_HEADER}\n${variant()}\n`,
  "product_categories.csv": `${CATEGORY_HEADER}\ncreate,DEMO-1,33333333-3333-4333-8333-333333333333,true,0\n`,
  "product_images.csv": `${IMAGE_HEADER}\ncreate,DEMO-1,,,DEMO-1--main--01.webp,products/demo-1.webp,/images/demo-1.webp,primary,draft,0,800,800,webp,Demo,示例\n`,
});
const codes = (result) => result.issues.map((i) => i.error_code);
const has = (result, code) => assert.ok(codes(result).includes(code), `${code}: ${JSON.stringify(result.issues)}`);

test("five-file normal bundle associates by product code and converts values", () => {
  const result = parseCatalogCsvBundle(files());
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.products.length, 1);
  assert.equal(result.products[0].variants[0].sku, "DEMO-1-A");
  assert.equal(result.products[0].translations[0].locale, "en");
  assert.equal(result.products[0].categories[0].category_id, "33333333-3333-4333-8333-333333333333");
  assert.equal(result.products[0].images[0].storage_key, "products/demo-1.webp");
  assert.equal(result.products[0].product.variants[0].sku, "DEMO-1-A");
  assert.deepEqual(result.products[0].product.attributes, { design: "Floral" });
  assert.equal(result.products[0].product.oem, true);
  assert.equal(result.products[0].variants[0].moq_quantity, 100);
  assert.equal(result.rows["products.csv"][0].row_number, 2);
  const b3 = validateCatalogProduct(result.products[0].product, { categories: [{ id: "33333333-3333-4333-8333-333333333333", parent_id: null, slug: "press-on-nails", status: "published" }] });
  assert.equal(b3.valid, true, JSON.stringify(b3.issues));
});
test("UTF-8 BOM and CRLF are accepted; invalid UTF-8 is reported", () => {
  const source = files()["products.csv"].replaceAll("\n", "\r\n");
  assert.equal(parseCatalogCsvBundle({ "products.csv": new TextEncoder().encode(`\uFEFF${source}`) }).valid, true);
  has(parseCatalogCsvBundle({ "products.csv": new Uint8Array([0xff, 0xfe]) }), "INVALID_UTF8");
  has(parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER}\n${product()}\uFEFF\n` }), "UNEXPECTED_BOM");
  has(parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER}\n${product()}\uD800\n` }), "INVALID_UNICODE");
});
test("RFC quotes, escaped quotes, commas and embedded newline preserve start row", () => {
  const csv = `${TRANSLATION_HEADER}\ncreate,DEMO-1,en,"Name, ""quoted""","Line one\nline two",Description,SEO,Summary\ncreate,DEMO-1,zh,中文,短,详情,标题,描述\n`;
  const result = parseCatalogCsvBundle({ "product_translations.csv": csv }, { knownProductCodes: new Set(["DEMO-1"]) });
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.rows["product_translations.csv"][0].data.name, 'Name, "quoted"');
  assert.equal(result.rows["product_translations.csv"][0].data.short_description, "Line one\nline two");
  assert.equal(result.rows["product_translations.csv"][1].row_number, 4);
});
test("empty file and duplicate, unknown or missing headers", () => {
  has(parseCatalogCsvBundle({}), "NO_FILES");
  has(parseCatalogCsvBundle({ "unexpected.csv": "x" }), "UNKNOWN_FILE");
  has(parseCatalogCsvBundle({ "products.csv": "" }), "EMPTY_FILE");
  const duplicate = parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER},slug\n${product()},extra\n` });
  has(duplicate, "DUPLICATE_HEADER");
  const unknown = parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER},surprise\n${product()},x\n` });
  has(unknown, "UNKNOWN_HEADER");
  const missing = parseCatalogCsvBundle({ "products.csv": "operation,product_code\ncreate,DEMO-1\n" });
  has(missing, "MISSING_REQUIRED_HEADER");
});
test("extra and missing row columns report physical row, later rows continue", () => {
  const source = `${PRODUCT_HEADER}\n${product()},extra\ncreate,DEMO-2\n${product("DEMO-3")}\n`;
  const result = parseCatalogCsvBundle({ "products.csv": source });
  assert.deepEqual(result.issues.filter((i) => i.error_code === "COLUMN_COUNT").map((i) => i.row_number), [2, 3]);
  assert.equal(result.rows["products.csv"].length, 1);
  assert.equal(result.rows["products.csv"][0].product_code, "DEMO-3");
  assert.equal(result.rows["products.csv"][0].row_number, 4);
});
test("invalid JSON and unsafe JSON keys are rejected without executing input", () => {
  const malformed = `${PRODUCT_HEADER}\n${product().replace('"{""design"":""Floral""}"', '"{bad}"')}\n`;
  has(parseCatalogCsvBundle({ "products.csv": malformed }), "INVALID_VALUE");
  const prototype = `${PRODUCT_HEADER}\n${product().replace('"{""design"":""Floral""}"', '"{""__proto__"":{}}"')}\n`;
  has(parseCatalogCsvBundle({ "products.csv": prototype }), "INVALID_VALUE");
});
test("numbers, booleans, enums, UUID and price convert strictly", () => {
  const bad = `${VARIANT_HEADER}\n${variant().replace(',100,sets,', ',1.5,sets,').replace(',draft,', ',live,')}\n`;
  const result = parseCatalogCsvBundle({ "product_variants.csv": bad }, { knownProductCodes: new Set(["DEMO-1"]) });
  assert.ok(result.issues.filter((i) => i.error_code === "INVALID_VALUE").length >= 2);
  const bool = `${PRODUCT_HEADER}\n${product().replace(',true,false,', ',yes,false,')}\n`;
  has(parseCatalogCsvBundle({ "products.csv": bool }), "INVALID_VALUE");
  has(parseCatalogCsvBundle({ "product_categories.csv": `${CATEGORY_HEADER}\ncreate,DEMO-1,bad,true,0\n` }, { knownProductCodes: new Set(["DEMO-1"]) }), "INVALID_VALUE");
});
test("unknown product references and duplicate SKU/business rows are reported", () => {
  const result = parseCatalogCsvBundle({ "product_variants.csv": `${VARIANT_HEADER}\n${variant()}\n${variant()}\n` });
  has(result, "UNKNOWN_PRODUCT_REFERENCE"); has(result, "DUPLICATE_BUSINESS_RECORD");
  assert.equal(result.issues.find((i) => i.error_code === "DUPLICATE_BUSINESS_RECORD")?.row_number, 3);
  assert.equal(result.issues.find((i) => i.error_code === "DUPLICATE_BUSINESS_RECORD")?.sku, "DEMO-1-A");
  assert.equal(result.issues.find((i) => i.error_code === "DUPLICATE_BUSINESS_RECORD")?.conflict_file_name, "product_variants.csv");
  assert.equal(result.issues.find((i) => i.error_code === "DUPLICATE_BUSINESS_RECORD")?.conflict_row_number, 2);
  const products = parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER}\n${product()}\n${product().replace('demo-one', 'other-slug')}\n` });
  const conflict = products.issues.find((i) => i.error_code === "DUPLICATE_BUSINESS_RECORD");
  assert.deepEqual([conflict?.file_name, conflict?.row_number, conflict?.conflict_file_name, conflict?.conflict_row_number], ["products.csv", 3, "products.csv", 2]);
});
test("four patch states preserve missing, blank, clear and value", () => {
  const csv = "operation,product_code,slug,lead_time_min_days,attributes\nupdate,DEMO-1,,__CLEAR__,{\"\"design\"\":\"\"New\"\"}\n";
  // The last JSON field needs CSV quoting, so use a simpler safe value.
  const fixed = csv.replace('{""design"":""New""}', '"{""design"":""New""}"');
  const result = parseCatalogCsvBundle({ "products.csv": fixed });
  const row = result.rows["products.csv"][0];
  assert.equal(row.fields.slug.kind, "blank");
  assert.equal(row.fields.lead_time_min_days.kind, "clear");
  assert.equal(row.fields.attributes.kind, "value");
  assert.equal(row.fields.oem.kind, "missing");
  assert.equal(Object.hasOwn(row.data, "slug"), false);
  assert.equal(row.data.lead_time_min_days, null);
  assert.deepEqual(row.data.attributes, { design: "New" });
  assert.equal(Object.hasOwn(row.data, "oem"), false);
});
test("required values, clear restrictions and image identity rules", () => {
  const p = `${PRODUCT_HEADER}\n${product().replace('demo-one,press_on_nails', ',press_on_nails').replace(',draft,', ',__CLEAR__,')}\n`;
  const result = parseCatalogCsvBundle({ "products.csv": p });
  has(result, "REQUIRED_FIELD"); has(result, "CLEAR_NOT_ALLOWED");
  const images = `${IMAGE_HEADER}\nupdate,DEMO-1,,,,products/x.webp,/x.webp,primary,draft,0,,,,,\n`;
  has(parseCatalogCsvBundle({ "product_images.csv": images }, { knownProductCodes: new Set(["DEMO-1"]) }), "IMAGE_ID_REQUIRED");
});
test("file, row and field limits, invalid quote and NUL input", () => {
  has(parseCatalogCsvBundle({ "products.csv": "x".repeat(100) }, { maxFileBytes: 10 }), "FILE_TOO_LARGE");
  has(parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER}\n${product()}\n${product("DEMO-2")}\n` }, { maxRows: 1 }), "ROW_LIMIT");
  has(parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER}\n${product()}\n` }, { maxFieldChars: 5 }), "FIELD_TOO_LONG");
  has(parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER}\n${product().replace('demo-one', 'bad"quote')}\n` }), "CSV_QUOTE");
  has(parseCatalogCsvBundle({ "products.csv": `${PRODUCT_HEADER}\n${product()}\0\n` }), "NUL_BYTE");
});
test("formula-prone text is flagged and export helper prefixes it", () => {
  const result = parseCatalogCsvBundle({ "product_translations.csv": `${TRANSLATION_HEADER}\ncreate,DEMO-1,en,=1+1,Short,Description,SEO,Summary\n` }, { knownProductCodes: new Set(["DEMO-1"]) });
  has(result, "FORMULA_RISK");
  assert.equal(result.issues.find((i) => i.error_code === "FORMULA_RISK")?.severity, "warning");
  assert.equal(safeSpreadsheetText("=1+1"), "'=1+1");
  assert.equal(safeSpreadsheetText("Normal"), "Normal");
});
test("association uses business keys even when child rows are reversed", () => {
  const input = {
    "products.csv": `${PRODUCT_HEADER}\n${product("DEMO-1")}\n${product("DEMO-2").replace('demo-one', 'demo-two')}\n`,
    "product_variants.csv": `${VARIANT_HEADER}\n${variant("DEMO-2-A").replace('DEMO-1,DEMO-2-A', 'DEMO-2,DEMO-2-A')}\n${variant()}\n`,
  };
  const result = parseCatalogCsvBundle(input);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.products[0].variants[0].sku, "DEMO-1-A");
  assert.equal(result.products[1].variants[0].sku, "DEMO-2-A");
});
test("malicious JSON number and source file traversal are rejected", () => {
  const p = `${PRODUCT_HEADER}\n${product().replace('"{""design"":""Floral""}"', '"{""design"":1e999}"')}\n`;
  has(parseCatalogCsvBundle({ "products.csv": p }), "INVALID_VALUE");
  const image = `${IMAGE_HEADER}\ncreate,DEMO-1,,,../outside.webp,products/demo-1.webp,/x.webp,primary,draft,0,800,800,webp,Demo,示例\n`;
  has(parseCatalogCsvBundle({ "product_images.csv": image }, { knownProductCodes: new Set(["DEMO-1"]) }), "INVALID_SOURCE_FILE");
});
test("four cell states survive grouping for product, SKU, translation, image and category", () => {
  const source = {
    "products.csv": "operation,product_code,slug,product_type,oem,lead_time_min_days\nupdate,DEMO-1,,,true,__CLEAR__\n",
    "product_variants.csv": "operation,product_code,sku,moq_quantity,moq_unit,order_multiple\nupdate,DEMO-1,DEMO-1-A,,,__CLEAR__\n",
    "product_translations.csv": "operation,product_code,locale,name,short_description\nupdate,DEMO-1,en,__CLEAR__,\n",
    "product_categories.csv": "operation,product_code,category_id,is_primary,sort_order\nupdate,DEMO-1,33333333-3333-4333-8333-333333333333,false,\n",
    "product_images.csv": "operation,product_code,image_id,storage_key,public_url,role,alt_en,alt_zh\nupdate,DEMO-1,44444444-4444-4444-8444-444444444444,,,,__CLEAR__,New ALT\n",
  };
  const result = parseCatalogCsvBundle(source);
  assert.equal(result.valid, true, JSON.stringify(result.issues));
  const grouped = result.products[0];
  const original = grouped.source;
  assert.deepEqual([original.product.fields.status.kind, original.product.fields.slug.kind, original.product.fields.lead_time_min_days.kind, original.product.fields.oem.kind], ["missing", "blank", "clear", "value"]);
  assert.deepEqual([original.variants[0].fields.status.kind, original.variants[0].fields.moq_quantity.kind, original.variants[0].fields.order_multiple.kind, original.variants[0].fields.sku.kind], ["missing", "blank", "clear", "value"]);
  assert.deepEqual([original.translations[0].fields.description.kind, original.translations[0].fields.short_description.kind, original.translations[0].fields.name.kind, original.translations[0].fields.locale.kind], ["missing", "blank", "clear", "value"]);
  assert.deepEqual([original.images[0].fields.status.kind, original.images[0].fields.storage_key.kind, original.images[0].fields.alt_en.kind, original.images[0].fields.alt_zh.kind], ["missing", "blank", "clear", "value"]);
  assert.deepEqual([original.categories[0].fields.is_primary.kind, original.categories[0].fields.sort_order.kind, original.categories[0].fields.category_id.kind], ["value", "blank", "value"]);
  assert.equal(Object.hasOwn(grouped.product, "slug"), false);
  assert.equal(grouped.product.lead_time_min_days, null);
  assert.equal(grouped.variants[0].order_multiple, null);
  assert.equal(Object.hasOwn(grouped.variants[0], "moq_quantity"), false);
  assert.equal(grouped.translations[0].name, "");
  assert.equal(grouped.images[0].alt_en, "");
  assert.equal(grouped.categories[0].is_primary, false);
  assert.equal(Object.hasOwn(grouped.categories[0], "sort_order"), false);
  const invalidClear = parseCatalogCsvBundle({ "product_categories.csv": "operation,product_code,category_id,is_primary,sort_order\nupdate,DEMO-1,33333333-3333-4333-8333-333333333333,__CLEAR__,\n" }, { knownProductCodes: new Set(["DEMO-1"]) });
  has(invalidClear, "CLEAR_NOT_ALLOWED");
});
test("boundary precision and range reject unsafe values", () => {
  const header = "operation,product_code,sku,moq_quantity,moq_unit,reference_price,reference_currency";
  const valid = parseCatalogCsvBundle({ "product_variants.csv": `${header}\ncreate,DEMO-1,MAX,9007199254740991,sets,9999999999.9999,USD\n` }, { knownProductCodes: new Set(["DEMO-1"]) });
  assert.equal(valid.valid, true, JSON.stringify(valid.issues));
  for (const row of [
    "create,DEMO-1,OVER,9007199254740992,sets,1.0000,USD",
    "create,DEMO-1,PRICE,100,sets,10000000000,USD",
    "create,DEMO-1,PRECISION,100,sets,0.00001,USD",
  ]) has(parseCatalogCsvBundle({ "product_variants.csv": `${header}\n${row}\n` }, { knownProductCodes: new Set(["DEMO-1"]) }), "INVALID_VALUE");
});
test("B3 accepts a partial draft but blocks incomplete publication and unresolved update", () => {
  const source = "operation,product_code,slug,product_type,status\ncreate,DEMO-1,demo-one,press_on_nails,draft\n";
  const draft = parseCatalogCsvBundle({ "products.csv": source }).products[0].product;
  assert.equal(validateCatalogProduct(draft).valid, true);
  const published = parseCatalogCsvBundle({ "products.csv": source.replace(",draft\n", ",published\n") }).products[0].product;
  const publication = validateCatalogProduct(published);
  for (const code of ["MISSING_PUBLISHED_SKU", "MISSING_PRIMARY_CATEGORY", "MISSING_TRANSLATION", "MISSING_PRIMARY_IMAGE"]) assert.ok(publication.issues.some((i) => i.error_code === code));
  const update = parseCatalogCsvBundle({ "products.csv": "operation,product_code,slug,product_type,status\nupdate,DEMO-1,,,published\n" }).products[0].product;
  assert.ok(validateCatalogProduct(update, { operation: "update" }).issues.some((i) => i.error_code === "MISSING_UPDATE_IDENTITY"));
});
