import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRequire = createRequire(import.meta.url);
function load(relativePath) {
  const filePath = path.join(root, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(filePath, "utf8"), {
    fileName: filePath, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const record = { exports: {} };
  new Function("require", "exports", compiled)((id) => {
    if (id === "react" || id === "react/jsx-runtime") return runtimeRequire(id);
    throw new Error(`Unexpected runtime dependency in filter test: ${id}`);
  }, record.exports);
  return record.exports;
}

const { mockProducts } = load("src/lib/catalog/mock-products.ts");
const { categories, attributeDefinitions } = load("src/lib/catalog/taxonomy.ts");
const { getFilterGroups, parseFilterSelection, filterProducts, filterQuery, filterHref, toggleFilter } = load("src/lib/catalog/filter.ts");
const category = (id) => categories.find((item) => item.id === id);
const press = category("press-on-nails");
const groups = getFilterGroups(press, mockProducts, attributeDefinitions);
const filtered = (target, selection = {}) => filterProducts(mockProducts, target, selection).map((product) => product.id);

assert.equal(filtered(press).length, 5, "top-level category");
assert.equal(filtered(category("press-on-shapes")).length, 3, "second-level category");
assert.deepEqual(filtered(category("shape-almond")), ["concept-almond-nails"], "third-level category");
assert.deepEqual(filtered(press, { shape: ["almond"] }), ["concept-almond-nails"], "single attribute");
assert.equal(filtered(press, { shape: ["almond", "square"] }).length, 2, "OR within one attribute");
assert.deepEqual(filtered(press, { shape: ["almond"], color: ["dusty-rose"] }), ["concept-almond-nails"], "AND across attributes and category");
assert.deepEqual(filtered(category("shape-square"), { color: ["dusty-rose"] }), [], "empty result");
assert.deepEqual(parseFilterSelection({ shape: ["bogus", "almond", "almond"], unknown: "x" }, groups), { shape: ["almond"] }, "invalid and duplicate values removed");
const chosen = { shape: ["almond"], color: ["dusty-rose", "neutral"] };
assert.equal(filterQuery(chosen, groups), "shape=almond&color=dusty-rose&color=neutral", "stable URL ordering and multiple values");
assert.equal(filterHref("/products/press-on-nails", chosen, groups), "/products/press-on-nails?shape=almond&color=dusty-rose&color=neutral", "URL restoration");
assert.deepEqual(toggleFilter(chosen, "shape", "almond"), { color: ["dusty-rose", "neutral"] }, "remove one condition");
assert.equal(filterQuery({}, groups), "", "clear all conditions");
const gel = category("gel-polish");
assert.deepEqual(filtered(gel, { color: ["soft-rose"], volume: ["15-ml"] }), [], "do not combine attributes across different variants");
assert.deepEqual(filtered(gel, { color: ["soft-rose"], volume: ["10-ml"] }), ["concept-gel-color"], "match one purchasable variant");
const { MobileFilterDrawer } = load("src/components/mobile-filter-drawer.tsx");
const drawerMarkup = renderToStaticMarkup(createElement(MobileFilterDrawer, { label: "Filter products", closeLabel: "Close filters" }, createElement("a", { href: "/products/press-on-nails?shape=almond" }, "Almond")));
assert.match(drawerMarkup, /<button[^>]*type="button"[^>]*>Filter products<\/button>/, "mobile filter trigger is a keyboard-accessible button");
assert.match(drawerMarkup, /<dialog[^>]*aria-label="Filter products"/, "mobile filters use a native modal dialog");
assert.match(drawerMarkup, /aria-label="Close filters"/, "mobile dialog has an accessible close control");

console.log("Product filter tests passed: category depths, OR/AND, variants, invalid values, empty results, URLs, clear actions, mobile dialog semantics.");
