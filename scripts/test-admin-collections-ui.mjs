import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { parseAdminCollectionsUrl, adminCollectionsHref } from "../src/lib/admin/collections-query.ts";
import { parseCollectionMemberQuery, collectionMemberHref } from "../src/lib/admin/collection-detail-query.ts";
import { candidateHref, candidateQueryParams } from "../src/lib/admin/collection-candidate-search.ts";

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
const guardLinks = { GuardedAdminLink: ({ href, children, className }) =>
  createElement("a", { href, className }, children) };
const ui = loadComponent("src/components/admin/ui.tsx", { "./admin-unsaved-changes": guardLinks });
const { CollectionListPanel } = loadComponent("src/components/admin/collection-list-panel.tsx", {
  "./ui": ui, "@/lib/admin/collections-query": { adminCollectionsHref },
  "./admin-unsaved-changes": guardLinks,
  "./collection-list-filters": { CollectionListFilters: ({ query }) => createElement("form",
    { action: "/admin/collections", className: "admin-collection-filters" },
    createElement("select", { name: "status", defaultValue: query.status }),
    createElement("button", { type: "submit" }, "Apply filter")) },
});
const { CollectionDetailPanel } = loadComponent("src/components/admin/collection-detail-panel.tsx", {
  "./ui": ui, "@/lib/admin/collection-detail-query": { collectionMemberHref },
  "@/lib/admin/collection-candidate-search": { candidateHref, candidateQueryParams },
  "./admin-unsaved-changes": guardLinks,
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
const detail = { state: "COMPLETE", item: { ...row, descriptionEn: "", descriptionZh: "",
  createdAt: "2026-09-01T00:00:00.000Z" }, issues: [], origin: "OFFLINE_FIXTURE" };
const member = { productId: "00000002-0000-4000-8000-000000000000", productCode: "FAMILY-2",
  nameEn: "Draft product", nameZh: "草稿商品", productStatus: "draft", sortOrder: 4 };
const memberResult = (state, overrides = {}) => ({ state, items: [], issues: [], nextCursor: null,
  previousCursor: null, origin: "OFFLINE_FIXTURE", ...overrides });
const renderDetail = (value = detail, members = memberResult("COMPLETE"), invalidMemberCursor = false,
  urlPaused = false) =>
  renderToStaticMarkup(createElement(CollectionDetailPanel,
    { detail: value, members, invalidMemberCursor, urlPaused }));

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
  assert.match(html, new RegExp(`/admin/collections/${id}`));
});

test("member query rejects ambiguous input and only generates internal detail links", () => {
  assert.deepEqual(parseCollectionMemberQuery({}), {});
  assert.deepEqual(parseCollectionMemberQuery({ cursor: "a.b", direction: "before" }),
    { cursor: "a.b", direction: "before" });
  for (const raw of [{ cursor: ["a.b", "c.d"] }, { cursor: "" }, { cursor: "invalid" },
    { cursor: "a".repeat(513) + ".b" }, { cursor: "a.b", direction: "else" },
    { direction: "before" }, { direction: "after" }, { returnTo: "https://example.invalid" }])
    assert.throws(() => parseCollectionMemberQuery(raw), (error) => error?.code === "INVALID_INPUT");
  assert.equal(collectionMemberHref(id, "a.b"), `/admin/collections/${id}?cursor=a.b`);
  assert.equal(collectionMemberHref(id, "c.d", "before"),
    `/admin/collections/${id}?cursor=c.d&direction=before`);
});

test("detail renders only approved fields, empty descriptions and draft members", () => {
  const html = renderDetail(detail, memberResult("COMPLETE", { items: [member] }));
  for (const value of [id, "sample", "Sample", "样本", "2026-09-01", "2026-10-01",
    "Not provided", "FAMILY-2", "Draft product", "草稿商品", "TEST DATA"])
    assert.ok(html.includes(value), value);
  assert.match(html, /Not published|2026-10-01/);
  assert.match(html, /<td>.*?draft.*?<\/td>/s);
  assert.doesNotMatch(html, /storage_key|private:\/\/|Save collection|Delete collection|product count/i);
});

test("collection and member states stay distinct and member failure keeps collection fields", () => {
  for (const [state, message] of [["NOT_CONNECTED", "Collections database not connected"],
    ["NOT_FOUND", "Collection not found"], ["ERROR", "Collection unavailable"],
    ["INCOMPLETE", "Collection detail incomplete"]]) {
    const html = renderDetail({ ...detail, state, item: null }, null);
    assert.match(html, new RegExp(message));
    assert.doesNotMatch(html, /Associated products|Sample/);
  }
  for (const [state, message] of [["NOT_CONNECTED", "Members database not connected"],
    ["NOT_FOUND", "Member collection unavailable"], ["ERROR", "Members unavailable"],
    ["INCOMPLETE", "Member data incomplete"], ["EMPTY_PAGE", "No members beyond this cursor"]]) {
    const html = renderDetail(detail, memberResult(state));
    assert.match(html, new RegExp(message));
    assert.match(html, /Sample/);
    assert.doesNotMatch(html, /<td>Draft product/);
  }
  assert.match(renderDetail(detail, memberResult("COMPLETE")), /No associated products on this page/);
  assert.match(renderDetail(detail, null, true), /Invalid member cursor/);
});

test("unsupported URL pauses the member panel without claiming a source completeness failure", () => {
  const html = renderDetail(detail, memberResult("INCOMPLETE"), false, true);
  assert.match(html, /URL_PAUSED/);
  assert.match(html, /Member read paused by URL parameters/);
  assert.doesNotMatch(html, /Member data incomplete|The source could not prove/);
  assert.doesNotMatch(html, /No associated products on this page/);
  assert.match(renderDetail(detail, null, true, true), /Invalid member cursor/);
  assert.doesNotMatch(renderDetail(detail, null, true, true), /URL_PAUSED/);
});

test("member pagination uses supplied signed cursors and empty page recovery", () => {
  const html = renderDetail(detail, memberResult("COMPLETE", { items: [member],
    nextCursor: "a.b", previousCursor: "c.d" }));
  assert.match(html, new RegExp(`/admin/collections/${id}\\?cursor=a.b`));
  assert.match(html, /cursor=c.d&amp;direction=before/);
  const empty = renderDetail(detail, memberResult("EMPTY_PAGE", { previousCursor: "r.s" }));
  assert.match(empty, /cursor=r.s&amp;direction=before/);
  assert.doesNotMatch(empty, /cursor=a.b/);
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
