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
  new Function("require", "exports", compiled)(() => { throw new Error("Unexpected runtime dependency in sort test"); }, record.exports);
  return record.exports;
}

const { mockProducts } = load("src/lib/catalog/mock-products.ts");
const { categories, attributeDefinitions } = load("src/lib/catalog/taxonomy.ts");
const { searchProducts } = load("src/lib/catalog/search.ts");
const { getFilterGroups, parseFilterSelection, filterProducts, filterHref, toggleFilter } = load("src/lib/catalog/filter.ts");
const { parseProductSort, sortProducts, searchSortHref } = load("src/lib/catalog/sort.ts");
const press = categories.find((item) => item.id === "press-on-nails");
const sample = [
  { id: "z", name: { en: "Alpha", zh: "甲" }, featured: false },
  { id: "c", name: { en: "Beta", zh: "乙" }, featured: true },
  { id: "b", name: { en: "Alpha", zh: "甲" }, featured: true },
  { id: "a", name: { en: "Alpha", zh: "甲" }, featured: false },
];
const ids = (items) => items.map((item) => item.id);

assert.deepEqual(ids(sortProducts(sample, "featured", "en")), ["b", "c", "a", "z"], "featured first, then stable ID");
assert.deepEqual(ids(sortProducts(sample, "name-asc", "en")), ["a", "b", "z", "c"], "name ascending and ID tie breaker");
assert.deepEqual(ids(sortProducts(sample, "name-desc", "en")), ["c", "a", "b", "z"], "name descending and ID tie breaker");
assert.deepEqual(ids(sample), ["z", "c", "b", "a"], "source array is untouched");
assert.deepEqual(ids(sortProducts(sample, "name-asc", "en")), ids(sortProducts(sample, "name-asc", "en")), "repeatable result");
assert.equal(parseProductSort("invalid"), "featured", "invalid sort falls back to default");
assert.equal(parseProductSort(["name-asc", "name-desc"]), "featured", "duplicate sort is invalid");
assert.deepEqual(ids(sortProducts([], "name-asc", "zh")), [], "empty result");

const search = searchProducts("press-on", mockProducts, categories);
const sortedSearch = sortProducts(search, "name-asc", "en");
assert.equal(sortedSearch.length, search.length, "search matching remains unchanged");
assert.equal(sortedSearch[0].name.en, "Almond Press-On Concept", "search results are sorted");

const groups = getFilterGroups(press, mockProducts, attributeDefinitions);
const selected = parseFilterSelection({ shape: ["almond", "square"] }, groups);
const filtered = filterProducts(mockProducts, press, selected);
assert.deepEqual(ids(sortProducts(filtered, "name-desc", "en")), ["mock-square-french-press-ons", "concept-almond-nails"], "filter followed by sort");
assert.equal(filterHref("/products/press-on-nails", selected, groups, undefined, "name-asc"), "/products/press-on-nails?shape=almond&shape=square&sort=name-asc", "filter and sort URL");
assert.equal(filterHref("/products/press-on-nails", toggleFilter(selected, "shape", "almond"), groups, undefined, "name-asc"), "/products/press-on-nails?shape=square&sort=name-asc", "removing one filter keeps sort");
assert.equal(filterHref("/products/press-on-nails", {}, groups, undefined, "name-asc"), "/products/press-on-nails?sort=name-asc", "clearing filters keeps sort");
assert.equal(filterHref("/products/press-on-nails", selected, groups, 2, "name-asc"), "/products/press-on-nails?shape=almond&shape=square&sort=name-asc&page=2", "page parameter is last");
assert.equal(filterHref("/zh/products/press-on-nails", selected, groups, undefined, "name-asc"), "/zh/products/press-on-nails?shape=almond&shape=square&sort=name-asc", "localized filter URL");
assert.equal(searchSortHref("/search", "almond", "name-asc"), "/search?q=almond&sort=name-asc", "search query preserved");
assert.equal(searchSortHref("/zh/search", "almond", "name-asc"), "/zh/search?q=almond&sort=name-asc", "localized search query preserved");
assert.equal(searchSortHref("/search", "", "name-asc"), "/search", "empty query clears sort");

console.log("Product sort tests passed: featured, names, stable IDs, immutability, invalid input, search, filters, URLs, locales, empty results.");
