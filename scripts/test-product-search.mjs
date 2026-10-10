import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadModule(relativePath) {
  const filePath = path.join(projectRoot, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    fileName: filePath,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("require", "exports", compiled)((id) => {
    if (id.startsWith("./")) return loadModule(path.join(path.dirname(relativePath), `${id}.ts`));
    throw new Error(`Unexpected runtime dependency in search test: ${id}`);
  }, moduleRecord.exports);
  return moduleRecord.exports;
}

const { mockProducts } = loadModule("src/lib/catalog/mock-products.ts");
const { categories } = loadModule("src/lib/catalog/taxonomy.ts");
const { normalizeSearchQuery, searchProducts } = loadModule("src/lib/catalog/search.ts");
const { getProductSuggestions, suggestionKeyAction } = loadModule("src/lib/catalog/suggestions.ts");
const { localizedPath } = loadModule("src/lib/site/paths.ts");
const { searchSortHref } = loadModule("src/lib/catalog/sort.ts");

const find = (query, source = mockProducts, taxonomy = categories) => searchProducts(query, source, taxonomy).map((product) => product.slug);
const almond = "almond-press-on-concept";

assert(find("almond").includes(almond), "English product name");
assert(find("杏仁形穿戴甲").includes(almond), "Chinese product name");
assert.deepEqual(find("DEMO-PO-001-N"), [almond], "exact variant SKU");
assert.deepEqual(find("po-001-n"), [almond], "partial variant SKU");
assert(find("private label").includes(almond), "description keywords");
assert(find("美甲灯配件").includes("nail-lamp-power-adapter-mock"), "category name");
assert.deepEqual(find("aLmOnD"), find("almond"), "mixed case");
assert.deepEqual(find(" almond   neutral "), [almond], "multiple terms and whitespace");
assert.equal(normalizeSearchQuery("  almond   neutral  "), "almond neutral", "query normalization");
assert.deepEqual(find(""), [], "empty query");
assert.deepEqual(find("   "), [], "whitespace only");
assert.deepEqual(find("no-such-nail-product"), [], "no results");
assert.deepEqual(find("DEMO-PO-002-S", mockProducts.slice(0, 1)), [], "replaceable product source");

const exactSku = { ...mockProducts[0], id: "exact-sku", name: { en: "Other concept", zh: "其他款" }, variants: [{ ...mockProducts[0].variants[0], sku: "TEST-01" }] };
const prefixSku = { ...mockProducts[1], id: "prefix-sku", name: { en: "Another concept", zh: "另一款" }, variants: [{ ...mockProducts[1].variants[0], sku: "TEST-010" }] };
const namePrefix = { ...mockProducts[2], id: "name-prefix", name: { en: "Test-01 Concept", zh: "测试款" }, variants: [{ ...mockProducts[2].variants[0], sku: "OTHER-01" }] };
const nameContains = { ...mockProducts[3], id: "name-contains", name: { en: "A Test-01 Concept", zh: "测试方向" }, variants: [{ ...mockProducts[3].variants[0], sku: "OTHER-02" }] };
const descriptionOnly = { ...mockProducts[4], id: "description-only", name: { en: "Unrelated", zh: "无关" }, shortDescription: { en: "A TEST-01 idea", zh: "其他" }, description: { en: "A TEST-01 idea", zh: "其他" }, variants: [{ ...mockProducts[4].variants[0], sku: "OTHER-03" }] };
const ranked = getProductSuggestions("test-01", [descriptionOnly, nameContains, namePrefix, prefixSku, exactSku], categories, "en");
assert.deepEqual(ranked.map((item) => item.product.id), ["exact-sku", "prefix-sku", "name-prefix", "name-contains", "description-only"], "suggestion relevance priority");
assert.equal(ranked[0].sku, "TEST-01", "exact matching purchasable SKU shown");
assert.deepEqual(getProductSuggestions("po-001", mockProducts, categories, "en").map((item) => item.product.id), ["concept-almond-nails"], "partial SKU suggestion");
assert.equal(getProductSuggestions("almond neutral", mockProducts, categories, "en")[0]?.product.id, "concept-almond-nails", "multi-keyword suggestion");
assert.equal(getProductSuggestions("gel", mockProducts, categories, "en").length, 5, "at most five suggestions");
const categoryHit = { ...mockProducts[0], id: "category-hit", slug: "other-category-item", name: { en: "Other item", zh: "其他商品" }, shortDescription: { en: "Other", zh: "其他" }, description: { en: "Other", zh: "其他" } };
const descriptionHit = { ...mockProducts[1], id: "description-hit", slug: "other-description-item", name: { en: "Other item", zh: "其他商品" }, categoryId: "nail-tools", subcategoryId: undefined, childCategoryId: undefined, shortDescription: { en: "Press-on idea", zh: "其他" }, description: { en: "Press-on idea", zh: "其他" } };
assert.deepEqual(getProductSuggestions("press-on", [descriptionHit, categoryHit], categories, "en").map((item) => item.product.id), ["category-hit", "description-hit"], "category keyword precedes description");
for (const item of getProductSuggestions("gel", mockProducts, categories, "en")) assert(searchProducts("gel", mockProducts, categories).some((product) => product.id === item.product.id), "suggestion must remain a full search match");
assert.deepEqual(getProductSuggestions("", mockProducts, categories, "en"), [], "empty suggestions");
assert.deepEqual(getProductSuggestions("a", mockProducts, categories, "en"), [], "minimum two characters");
assert.deepEqual(getProductSuggestions("not-a-real-product", mockProducts, categories, "en"), [], "no suggestion result");
assert.equal(localizedPath("en", `/product/${ranked[0].product.slug}`), `/product/${ranked[0].product.slug}`, "English suggestion detail link");
assert.equal(localizedPath("zh", `/product/${ranked[0].product.slug}`), `/zh/product/${ranked[0].product.slug}`, "Chinese suggestion detail link");
assert.equal(searchSortHref(localizedPath("en", "/search"), "almond", "featured"), "/search?q=almond", "view all results link");
assert.equal(searchSortHref(localizedPath("zh", "/search"), "杏仁形", "featured"), "/zh/search?q=%E6%9D%8F%E4%BB%81%E5%BD%A2", "Chinese view all results link");
assert.deepEqual(suggestionKeyAction("ArrowDown", -1, 3), { activeIndex: 0, action: "none" }, "ArrowDown selects first option");
assert.deepEqual(suggestionKeyAction("ArrowUp", -1, 3), { activeIndex: 2, action: "none" }, "ArrowUp selects last option");
assert.deepEqual(suggestionKeyAction("Enter", 1, 3), { activeIndex: 1, action: "navigate" }, "Enter activates current option");
assert.deepEqual(suggestionKeyAction("Escape", 1, 3), { activeIndex: -1, action: "close" }, "Escape closes suggestions");

console.log("Product search tests passed: full results, suggestion relevance, limits, links, locales, keyboard and close actions.");
