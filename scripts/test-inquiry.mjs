import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function load(relativePath) {
  const filePath = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    fileName: filePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const record = { exports: {} };
  new Function("require", "exports", compiled)(() => { throw new Error("Unexpected runtime dependency in inquiry test"); }, record.exports);
  return record.exports;
}

const { mockProducts } = load("src/lib/catalog/mock-products.ts");
const { addInquiryItem, readInquiry, removeInquiryItem, restoreInquiryItem, updateInquiryQuantity, validQuantity } = load("src/lib/catalog/inquiry.ts");
const product = mockProducts[0];
const [first, second] = product.variants;
const date = "2026-10-10T00:00:00.000Z";
const added = addInquiryItem([], mockProducts, product.id, first.sku, date);
assert.equal(added.length, 1, "first add succeeds");
assert.equal(added[0].quantity, first.moq.quantity, "default purchase quantity is variant MOQ");
assert.equal(added[0].addedAt, date);
assert.equal(addInquiryItem(added, mockProducts, product.id, first.sku, date).length, 1, "duplicate SKU is not added");
const changed = updateInquiryQuantity(added, first.sku, 250);
assert.equal(addInquiryItem(changed, mockProducts, product.id, first.sku, date)[0].quantity, 250, "duplicate add retains quantity");
const two = addInquiryItem(changed, mockProducts, product.id, second.sku, date);
assert.equal(two.length, 2, "two variants of one product are separate inquiry items");
assert.equal(two.filter((item) => item.sku !== first.sku).length, 1, "SKU removal leaves the other variant");
assert.equal(updateInquiryQuantity(two, first.sku, 0)[0].quantity, 250, "zero is rejected");
assert.equal(updateInquiryQuantity(two, first.sku, 1.5)[0].quantity, 250, "fraction is rejected");
assert.equal(updateInquiryQuantity(two, first.sku, Number.MAX_SAFE_INTEGER + 1)[0].quantity, 250, "unsafe integer is rejected");
assert.equal(validQuantity(1), true);
assert.equal(readInquiry(JSON.stringify(two), mockProducts).length, 2, "serialized list reloads");
assert.deepEqual(readInquiry("broken json", mockProducts), [], "corrupt JSON recovers safely");
assert.deepEqual(readInquiry(JSON.stringify({ items: two }), mockProducts), [], "unexpected storage shape recovers safely");
assert.equal(readInquiry(JSON.stringify([...two, two[0], { ...two[0], sku: "UNKNOWN" }]), mockProducts).length, 2, "duplicate and stale SKU are discarded");
assert.equal(addInquiryItem(two, mockProducts, "wrong-product", "wrong-sku", date).length, 2, "unknown product and SKU cannot be added");
const removedFirst = removeInquiryItem(two, first.sku);
assert.equal(removedFirst.items.length, 1, "single remove leaves the other SKU");
assert.equal(removedFirst.removed.item.quantity, 250, "remove captures the latest purchase quantity");
const removedSecond = removeInquiryItem(removedFirst.items, second.sku);
assert.equal(removedSecond.items.length, 0, "consecutive removals leave an empty list");
const undoSecond = restoreInquiryItem(removedSecond.items, removedSecond.removed);
const undoBoth = restoreInquiryItem(undoSecond, removedFirst.removed);
assert.deepEqual(undoBoth, two, "reverse order undo restores both items, quantities, timestamps and positions");
assert.equal(restoreInquiryItem(undoBoth, removedFirst.removed).length, 2, "undo never duplicates an existing SKU");
assert.deepEqual(removeInquiryItem(two, "UNKNOWN").items, two, "unknown SKU cannot remove another item");
console.log("Inquiry model: 21 passed, 0 failed, 0 skipped");
