import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
function load(relativePath) {
  const filePath = path.resolve(root, relativePath.endsWith(".ts") ? relativePath : `${relativePath}.ts`);
  if (cache.has(filePath)) return cache.get(filePath).exports;
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    fileName: filePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const record = { exports: {} };
  cache.set(filePath, record);
  const requireLocal = (specifier) => {
    const target = specifier.startsWith("@/") ? path.join(root, "src", specifier.slice(2)) : path.resolve(path.dirname(filePath), specifier);
    return load(path.relative(root, target));
  };
  new Function("require", "exports", compiled)(requireLocal, record.exports);
  return record.exports;
}

const { mockProducts } = load("src/lib/catalog/mock-products");
const { validateRFQDraft, RFQ_FIELD_LIMITS } = load("src/lib/rfq/validation");
const { inquiryItemsToRFQDraftItems, snapshotRFQItems, snapshotRFQItemsFromPublicCatalog } = load("src/lib/rfq/items");
const { canonicalRFQDraft, createInitialRFQFormValues, isRFQFormDirty } = load("src/lib/rfq/form-state");
const product = mockProducts[0];
const variant = product.variants[0];
const base = {
  contact: { fullName: "Jane Buyer", email: "jane@example.com", companyName: "Nail Studio Ltd", country: "US" },
  buyerType: "wholesaler", requirements: "Please quote the selected product for our stores.",
  customization: ["oem"], purchaseTimeline: "within_3_months",
  items: [{ productId: product.id, sku: variant.sku, quantity: 100 }],
};
const contact = (patch) => ({ ...base, contact: { ...base.contact, ...patch } });
const item = (patch) => ({ ...base, items: [{ ...base.items[0], ...patch }] });
let passed = 0;
function test(name, run) { run(); passed += 1; }
function expectError(input, field, code, source = mockProducts) {
  const result = validateRFQDraft(input, source);
  assert.equal(result.ok, false, `${field}: ${code} should fail`);
  assert.ok(result.errors.some((error) => error.field === field && error.code === code), `${field}: ${code} missing from ${JSON.stringify(result.errors)}`);
}

test("valid draft", () => assert.equal(validateRFQDraft(base, mockProducts).ok, true));
test("empty RFQ form is clean and restored text becomes clean again", () => {
  const initial = createInitialRFQFormValues();
  assert.equal(isRFQFormDirty(initial), false);
  assert.equal(isRFQFormDirty({ ...initial, contact: { ...initial.contact, fullName: "Jane" } }), true);
  assert.equal(isRFQFormDirty({ ...initial, contact: { ...initial.contact, fullName: "" } }), false);
});
test("optional selections and requirements track dirty state", () => {
  const initial = createInitialRFQFormValues();
  assert.equal(isRFQFormDirty({ ...initial, buyerType: "wholesaler" }), true);
  assert.equal(isRFQFormDirty({ ...initial, customization: ["oem"] }), true);
  assert.equal(isRFQFormDirty({ ...initial, purchaseTimeline: "planning" }), true);
  assert.equal(isRFQFormDirty({ ...initial, requirements: "Please quote" }), true);
  assert.equal(isRFQFormDirty({ ...initial, customization: [] }), false);
});
test("browser draft identity includes contact and ignores item or customization order", () => {
  const withTwo = { ...base, customization: ["oem", "private_label"], items: [base.items[0],
    { productId: mockProducts[1].id, sku: mockProducts[1].variants[0].sku, quantity: 200 }] };
  const reordered = { ...withTwo, customization: [...withTwo.customization].reverse(), items: [...withTwo.items].reverse() };
  assert.equal(canonicalRFQDraft(withTwo), canonicalRFQDraft(reordered));
  assert.notEqual(canonicalRFQDraft(withTwo), canonicalRFQDraft({ ...withTwo,
    contact: { ...withTwo.contact, email: "different@example.invalid" } }));
});
test("missing full name", () => expectError(contact({ fullName: " " }), "contact.fullName", "REQUIRED"));
test("invalid email", () => expectError(contact({ email: "not-an-email" }), "contact.email", "INVALID_EMAIL"));
test("empty company name", () => expectError(contact({ companyName: "  " }), "contact.companyName", "REQUIRED"));
test("invalid country", () => expectError(contact({ country: "ZZ" }), "contact.country", "INVALID_COUNTRY"));
test("short requirements", () => expectError({ ...base, requirements: "Too short" }, "requirements", "TOO_SHORT"));
test("long requirements", () => expectError({ ...base, requirements: "x".repeat(RFQ_FIELD_LIMITS.requirements.max + 1) }, "requirements", "TOO_LONG"));
test("empty inquiry", () => expectError({ ...base, items: [] }, "items", "EMPTY_INQUIRY"));
test("zero quantity", () => expectError(item({ quantity: 0 }), "items[0].quantity", "INVALID_QUANTITY"));
test("negative quantity", () => expectError(item({ quantity: -1 }), "items[0].quantity", "INVALID_QUANTITY"));
test("fractional quantity", () => expectError(item({ quantity: 1.5 }), "items[0].quantity", "INVALID_QUANTITY"));
test("duplicate SKU", () => expectError({ ...base, items: [base.items[0], { ...base.items[0] }] }, "items[1]", "DUPLICATE_PRODUCT"));
test("invalid buyer type", () => expectError({ ...base, buyerType: "unknown" }, "buyerType", "INVALID_ENUM"));
test("invalid customization", () => expectError({ ...base, customization: ["oem", "unknown"] }, "customization[1]", "INVALID_ENUM"));
test("invalid timeline", () => expectError({ ...base, purchaseTimeline: "someday" }, "purchaseTimeline", "INVALID_ENUM"));
test("invalid website URL", () => expectError(contact({ website: "example.com" }), "contact.website", "INVALID_WEBSITE"));
test("optional fields may be empty", () => {
  const result = validateRFQDraft({ ...base, contact: { ...base.contact, whatsapp: "  ", website: " " }, buyerType: " ", purchaseTimeline: " ", customization: [] }, mockProducts);
  assert.equal(result.ok, true);
  assert.equal(result.value.contact.whatsapp, undefined);
  assert.equal(result.value.contact.website, undefined);
});
test("trims text and normalizes country code", () => {
  const result = validateRFQDraft({ ...base, contact: { fullName: "  Jane Buyer  ", email: " jane@example.com ", companyName: " Nail Studio Ltd ", country: " us " }, requirements: "  Please quote the selected product.  " }, mockProducts);
  assert.equal(result.ok, true);
  assert.equal(result.value.contact.country, "US");
  assert.equal(result.value.contact.fullName, "Jane Buyer");
  assert.equal(result.value.requirements, "Please quote the selected product.");
});
test("missing product", () => expectError(item({ productId: "missing" }), "items[0].sku", "INVALID_PRODUCT"));
test("SKU does not belong to product", () => expectError(item({ sku: mockProducts[1].variants[0].sku }), "items[0].sku", "INVALID_PRODUCT"));
test("multiple field errors are returned together", () => {
  const result = validateRFQDraft({ ...contact({ fullName: "", email: "bad" }), items: [] }, mockProducts);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 3);
});
test("other field limits are enforced", () => {
  expectError(contact({ fullName: "x".repeat(101) }), "contact.fullName", "TOO_LONG");
  expectError(contact({ companyName: "A" }), "contact.companyName", "TOO_SHORT");
  expectError(contact({ whatsapp: "x".repeat(31) }), "contact.whatsapp", "TOO_LONG");
  expectError(contact({ email: `${"x".repeat(250)}@a.co` }), "contact.email", "TOO_LONG");
});
test("valid website and enum options", () => {
  const result = validateRFQDraft({ ...base, contact: { ...base.contact, website: "https://example.com" }, customization: ["oem", "odm", "private_label", "custom_packaging"] }, mockProducts);
  assert.equal(result.ok, true);
});
test("inquiry conversion copies data without mutating state", () => {
  const inquiry = [{ productId: product.id, sku: variant.sku, quantity: 250, addedAt: "2026-10-10T00:00:00.000Z" }];
  const before = JSON.stringify(inquiry);
  const converted = inquiryItemsToRFQDraftItems(inquiry, mockProducts);
  assert.equal(converted.ok, true);
  assert.deepEqual(converted.value, [{ productId: product.id, sku: variant.sku, quantity: 250 }]);
  assert.equal(JSON.stringify(inquiry), before);
  assert.notEqual(converted.value[0], inquiry[0]);
});
test("stale inquiry SKU is rejected during conversion", () => {
  const converted = inquiryItemsToRFQDraftItems([{ productId: product.id, sku: "STALE", quantity: 100, addedAt: "2026-10-10T00:00:00.000Z" }], mockProducts);
  assert.equal(converted.ok, false);
  assert.ok(converted.errors.some((error) => error.code === "INVALID_PRODUCT"));
});
test("snapshot uses trusted catalog name, slug and variant", () => {
  const result = snapshotRFQItems([{ ...base.items[0], productName: "spoofed", productSlug: "fake", selectedVariant: null }], mockProducts);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value[0].productName, product.name);
  assert.equal(result.value[0].productSlug, product.slug);
  assert.equal(result.value[0].selectedVariant.id, variant.id);
});
test("products without variants can be requested without SKU", () => {
  const noVariant = { ...product, id: "standalone", slug: "standalone", variants: [] };
  const result = validateRFQDraft({ ...base, items: [{ productId: noVariant.id, quantity: 3 }] }, [noVariant]);
  assert.equal(result.ok, true);
  const snapshot = snapshotRFQItems(result.value.items, [noVariant]);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.value[0].selectedVariant, null);
});
test("variantless SKU accepts absent or empty text and rejects other types", () => {
  const noVariant = { ...product, id: "standalone", slug: "standalone", variants: [] };
  const candidate = { productId: noVariant.id, quantity: 3 };
  const empty = validateRFQDraft({ ...base, items: [{ ...candidate, sku: "" }] }, [noVariant]);
  assert.equal(empty.ok, true);
  assert.deepEqual(empty.value.items, [candidate]);
  for (const sku of [0, false, null, {}, []]) {
    expectError({ ...base, items: [{ ...candidate, sku }] }, "items[0].sku", "INVALID_FORMAT", [noVariant]);
  }
});

const publicId = "00000001-0000-4000-8000-000000000000";
const publicVariantId = "00000101-0000-4000-8000-000000000000";
const publicProduct = (moq = 100, unit = "pieces") => ({ id: publicId, slug: "published-product",
  translations: { en: { state: "available", value: { name: "Published product" } },
    zh: { state: "available", value: { name: "已发布商品" } } },
  variants: [{ id: publicVariantId, sku: "PUBLIC-SKU", moq: { quantity: moq, unit }, attributes: { color: "red" } }],
});
const publicLookup = (product = publicProduct()) => ({ async getPublishedProductsByIds(ids) {
  assert.deepEqual(ids, [publicId]);
  if (!product) throw Object.assign(Error("unavailable"), { code: "NOT_FOUND" });
  return [product];
} });
const publicItem = (quantity, extra = {}) => [{ productId: publicId, sku: "PUBLIC-SKU", quantity, ...extra }];
async function asyncTest(name, run) { await run(); passed += 1; }
await asyncTest("trusted MOQ snapshots mark below, equal and above without blocking", async () => {
  for (const [quantity, expected] of [[99, true], [100, false], [101, false]]) {
    const result = await snapshotRFQItemsFromPublicCatalog(publicItem(quantity), publicLookup());
    assert.equal(result.ok, true);
    assert.deepEqual([result.value[0].moqAtSubmission, result.value[0].moqUnitAtSubmission,
      result.value[0].belowMoq], [100, "pieces", expected]);
    assert.deepEqual(result.value[0].selectedVariant,
      { id: publicVariantId, attributes: { color: "red" } });
  }
});
await asyncTest("trusted MOQ ignores client-provided MOQ, price and below flag", async () => {
  const result = await snapshotRFQItemsFromPublicCatalog(publicItem(50,
    { moqAtSubmission: 1, moqUnitAtSubmission: "fake", belowMoq: false, price: 1 }), publicLookup());
  assert.equal(result.ok, true);
  assert.equal(result.value[0].moqAtSubmission, 100);
  assert.equal(result.value[0].moqUnitAtSubmission, "pieces");
  assert.equal(result.value[0].belowMoq, true);
  assert.equal(Object.hasOwn(result.value[0], "price"), false);
});
await asyncTest("trusted MOQ rejects missing, invalid SKU, quantity, MOQ and unit", async () => {
  for (const candidate of [null])
    await assert.rejects(snapshotRFQItemsFromPublicCatalog(publicItem(1), publicLookup(candidate)), { code: "NOT_FOUND" });
  for (const candidate of [publicItem(1, { sku: "OTHER" }), publicItem(0), publicItem(1.5)]) {
    const result = await snapshotRFQItemsFromPublicCatalog(candidate, publicLookup());
    assert.equal(result.ok, false);
  }
  for (const [moq, unit] of [[0, "pieces"], [1.5, "pieces"], [null, "pieces"],
    [100, ""], [100, " pieces"], [100, null]]) {
    const result = await snapshotRFQItemsFromPublicCatalog(publicItem(50), publicLookup(publicProduct(moq, unit)));
    assert.equal(result.ok, false);
  }
});
await asyncTest("a later MOQ change affects only a newly constructed candidate snapshot", async () => {
  const first = await snapshotRFQItemsFromPublicCatalog(publicItem(50), publicLookup(publicProduct(100)));
  const later = await snapshotRFQItemsFromPublicCatalog(publicItem(50), publicLookup(publicProduct(40)));
  assert.equal(first.value[0].belowMoq, true);
  assert.equal(later.value[0].belowMoq, false);
  assert.deepEqual(first.value[0].moqAtSubmission, 100);
  assert.deepEqual(later.value[0].moqAtSubmission, 40);
});
test("both locale dictionaries provide the approved, nonblocking MOQ message", () => {
  const zh = load("src/i18n/zh").default;
  const en = load("src/i18n/en").default;
  assert.equal(zh.rfqForm.belowMoqHint,
    "您的询盘数量低于常规起订量，仍可提交询价，是否接受由供应商最终确认。");
  assert.equal(en.rfqForm.belowMoqHint,
    "Your requested quantity is below the standard MOQ. You can still submit an inquiry; acceptance is subject to supplier confirmation.");
  assert.match(zh.rfqForm.moqPreviewNote, /测试数据/);
  assert.match(en.rfqForm.moqPreviewNote, /test data/);
});
console.log(`RFQ validation: ${passed} passed, 0 failed, 0 skipped`);
