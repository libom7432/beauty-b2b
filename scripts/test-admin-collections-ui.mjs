import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseAdminCollectionsUrl, adminCollectionsHref } from "../src/lib/admin/collections-query.ts";

const require = createRequire(import.meta.url);
const root = new URL("../", import.meta.url);
const loadComponent = (path, extra = {}) => {
  const source = readFileSync(new URL(path, root), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  const compiledModule = { exports: {} };
  const localRequire = (name) => extra[name] ?? (name === "next/link"
    ? { default: ({ href, children, ...props }) => createElement("a", { href, ...props }, children) }
    : require(name));
  new Function("module", "exports", "require", js)(compiledModule, compiledModule.exports, localRequire);
  return compiledModule.exports;
};
const ui = loadComponent("src/components/admin/ui.tsx");
const { CollectionListPanel } = loadComponent("src/components/admin/collection-list-panel.tsx", {
  "./ui": ui, "@/lib/admin/collections-query": { adminCollectionsHref },
});
const { default: Loading } = loadComponent("src/app/admin/(workspace)/collections/loading.tsx", {
  "@/components/admin/ui": ui,
});
const date = "2026-10-01T00:00:00.000Z";
const id = "00000001-0000-4000-8000-000000000000";
const query = parseAdminCollectionsUrl({});
const row = { id, slug: "sample", nameEn: "Sample", nameZh: "样本", status: "published",
  sortOrder: 1, publishedAt: date, updatedAt: date };
const result = (state, overrides = {}) => ({ state, items: [], issues: [], nextCursor: null,
  previousCursor: null, origin: "NONE", ...overrides });
const render = (value, parsed = query) => renderToStaticMarkup(createElement(CollectionListPanel,
  { result: value, query: parsed }));

test("URL parsing rejects ambiguous, malformed or unbounded queries", () => {
  for (const input of [{ status: ["draft", "published"] }, { status: "other" },
    { q: "sample" }, { cursor: "" }, { cursor: "abc" },
    { cursor: "x".repeat(513) + ".a" }, { direction: "before" },
    { direction: "after" }])
    assert.throws(() => parseAdminCollectionsUrl(input), (error) => error.code === "INVALID_INPUT");
  assert.equal(parseAdminCollectionsUrl({ status: "draft" }).repositoryQuery.status, "draft");
  assert.deepEqual(parseAdminCollectionsUrl({ status: "all" }).repositoryQuery, {});
  assert.equal(adminCollectionsHref("published", "a.b"), "/admin/collections?status=published&cursor=a.b");
  assert.equal(adminCollectionsHref("all"), "/admin/collections");
});

test("disconnected, error, incomplete and empty states remain distinct", () => {
  assert.match(render(result("NOT_CONNECTED")), /Collections 数据源尚未连接/);
  assert.doesNotMatch(render(result("NOT_CONNECTED")), /No collections/);
  assert.match(render(result("ERROR")), /Collections unavailable/);
  assert.match(render(result("INCOMPLETE", { items: [row] })), /Collection data incomplete/);
  assert.doesNotMatch(render(result("INCOMPLETE", { items: [row] })), /View details for Sample/);
  assert.match(render(result("COMPLETE")), /No collections/);
  assert.match(render(result("COMPLETE"), parseAdminCollectionsUrl({ status: "draft" })),
    /No collections match this status/);
  assert.match(render(null, null), /Invalid collection query/);
});

test("safe table renders approved fields, accessible details and status without fake counts", () => {
  const html = render(result("COMPLETE", { items: [row], origin: "OFFLINE_FIXTURE" }));
  assert.match(html, /TEST DATA/);
  assert.match(html, /<summary>View details for Sample<\/summary>/);
  assert.match(html, /样本/);
  assert.match(html, /sample/);
  assert.match(html, /published/);
  assert.match(html, /2026-10-01/);
  assert.doesNotMatch(html, /storage_key|reference_price|private:\/\//);
  assert.doesNotMatch(html, /Search collections|Save collection|product count: [0-9]/i);
});

test("pagination uses repository cursors and preserves status, including both empty-page recovery directions", () => {
  const filtered = parseAdminCollectionsUrl({ status: "retired" });
  const html = render(result("COMPLETE", { items: [row], nextCursor: "a.b",
    previousCursor: "c.d" }), filtered);
  assert.match(html, /\/admin\/collections\?status=retired&amp;cursor=a.b/);
  assert.match(html, /\/admin\/collections\?status=retired&amp;cursor=c.d&amp;direction=before/);
  const afterEmpty = render(result("EMPTY_PAGE", { previousCursor: "c.d" }), filtered);
  assert.match(afterEmpty, /No records beyond this cursor/);
  assert.match(afterEmpty, /direction=before/);
  assert.doesNotMatch(afterEmpty, /cursor=a.b/);
  const beforeEmpty = render(result("EMPTY_PAGE", { nextCursor: "a.b" }), filtered);
  assert.match(beforeEmpty, /cursor=a.b/);
  assert.doesNotMatch(beforeEmpty, /direction=before/);
});

test("production source has no Collections fixture import or mock collection fallback", () => {
  const server = readFileSync(new URL("src/lib/catalog-read/server.ts", root), "utf8");
  const page = readFileSync(new URL("src/app/admin/(workspace)/collections/page.tsx", root), "utf8");
  assert.doesNotMatch(server + page, /collections-fixture-source|mockCollections|MOCK_COLLECTIONS/);
  assert.match(page, /createServerCatalogReadRepository/);
  assert.match(page, /requireAdminPage\("catalog.read"\)/);
});

test("loading state is announced without private data or a false empty result", () => {
  const html = renderToStaticMarkup(createElement(Loading));
  assert.match(html, /role="status"/);
  assert.match(html, /Loading collections/);
  assert.doesNotMatch(html, /No collections|storage_key/);
});
