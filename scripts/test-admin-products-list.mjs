import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createAdminCursorCodec } from "../src/lib/catalog-read/admin-cursor.ts";
import { createOfflineCatalogSource, notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";
import { loadAdminProductsList } from "../src/lib/admin/products-list-state.ts";
import { adminProductsHref } from "../src/lib/admin/products-query.ts";
import { adminProductDetailHref, adminProductIdDetailHref } from "../src/lib/admin/product-detail-navigation.ts";

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
const { ProductListPanel } = loadComponent("src/components/admin/product-list-panel.tsx", {
  "./ui": ui, "@/lib/admin/products-query": { adminProductsHref },
  "@/lib/admin/product-detail-navigation": { adminProductIdDetailHref },
  "./product-list-filters": { ProductListFilters: () => createElement("div") },
});
const render = (props) => renderToStaticMarkup(createElement(ProductListPanel, props));

const date = "2026-10-01T00:00:00.000Z";
const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const account = { admin_id: id(999), identity_provider: "test", provider_subject: "active",
  status: "active", created_at: date, disabled_at: null, permissions: ["catalog.read"] };
const dependencies = {
  provider: { async verifySession(session) { return session === "active" || session === "no-grant"
    ? { identity_provider: "test", provider_subject: session } : null; } },
  directory: { async findByProviderIdentity(identity) { return identity.provider_subject === "active"
    ? account : identity.provider_subject === "no-grant" ? { ...account, provider_subject: "no-grant", permissions: [] } : null; } },
};
const cursorCodec = createAdminCursorCodec(randomBytes(32).toString("base64url"));
const repo = (source, session = "active") => createCatalogReadRepository(source, { session, dependencies }, cursorCodec);
const bundle = (n, status) => {
  const productId = id(n);
  return { product: { id: productId, product_code: `FAMILY-${n}`, slug: `family-${n}`,
    product_type: "press-on", status, attributes: { secret_marker: "not-for-list" },
    customization_options: [], oem: false, odm: false, lead_time_min_days: null,
    lead_time_max_days: null, seo_indexable: false, featured: false, new_arrival: false,
    published_at: status === "published" ? date : null, created_at: date, updated_at: date },
    translations: [{ product_id: productId, locale: "en", name: `Family ${n}`,
      short_description: "", description: "private-description", seo_title: "",
      seo_description: "", created_at: date, updated_at: date }],
    variants: [{ id: id(n + 100), product_id: productId, sku: `SKU-${n}`, status,
      attributes: {}, moq_quantity: "100", moq_unit: "pieces", order_multiple: null,
      package_quantity: null, package_unit: null, reference_price: null,
      reference_currency: null, sort_order: 0, created_at: date, updated_at: date }],
    categoryLinks: [], categories: [], images: [{ id: id(n + 200), product_id: productId,
      variant_id: null, storage_key: "private/secret-key.webp", public_url: "https://example.invalid/image.webp",
      role: "primary", status, sort_order: 0, width: null, height: null, format: "webp",
      alt_en: "", alt_zh: "", created_at: date, updated_at: date }] };
};

test("anonymous and missing catalog.read are denied before source access", async () => {
  let reads = 0;
  const source = { mode: "offline", async listAdmin() { reads++; return { rows: [], hasMore: false }; },
    async getAdminByCode() { return null; }, async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  for (const session of [null, "no-grant"])
    await assert.rejects(loadAdminProductsList(repo(source, session)), (error) => error.code === "FORBIDDEN");
  assert.equal(reads, 0);
});
test("NOT_CONFIGURED, EMPTY and SOURCE_UNAVAILABLE remain distinct", async () => {
  assert.equal((await loadAdminProductsList(repo(notConfiguredCatalogSource))).kind, "not_connected");
  assert.equal((await loadAdminProductsList(repo(createOfflineCatalogSource([])))).kind, "empty");
  const failedSource = { mode: "offline", async listAdmin() { throw Error("postgres://secret.invalid"); },
    async getAdminByCode() { return null; }, async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  assert.deepEqual(await loadAdminProductsList(repo(failedSource)), { kind: "source_unavailable", products: [] });
  assert.match(render({ state: "not_connected" }), /Not Connected/);
  assert.match(render({ state: "empty" }), /No Products/);
  const errorHtml = render({ state: "source_unavailable" });
  assert.match(errorHtml, /Products unavailable/);
  assert.doesNotMatch(errorHtml, /postgres|secret\.invalid|SQL/i);
});
test("SUCCESS displays draft, published, retired and product family links only", async () => {
  const data = [bundle(1, "draft"), bundle(2, "published"), bundle(3, "retired")];
  const state = await loadAdminProductsList(repo(createOfflineCatalogSource(data)));
  assert.equal(state.kind, "success");
  const html = render({ state: state.kind, products: state.products, testData: true });
  for (const label of ["Product Code", "Product Name", "Product Type", "Status", "Primary Category", "Variants", "Updated At",
    "draft", "published", "retired", "TEST DATA", "Unavailable", "2026-10-01"])
    assert.ok(html.includes(label), label);
  for (const n of [1, 2, 3]) {
    assert.match(html, new RegExp(`href="/admin/products/id/${id(n)}"`));
    assert.equal((await repo(createOfflineCatalogSource(data)).getAdminProductById(id(n))).basic.product_code,
      `FAMILY-${n}`);
  }
  assert.doesNotMatch(html, /href="\/admin\/products\/(?:FAMILY-|by-code\/)/);
  for (const secret of ["SKU-1", "private/secret-key", "not-for-list", "private-description", "postgres://"])
    assert.equal(html.includes(secret), false, secret);
  assert.equal(render({ state: state.kind, products: state.products }).includes("TEST DATA"), false);
});
test("UUID list links remain short for Unicode, slash and maximum-length Product Codes", async () => {
  const codes = ["CN-甲", "A/B", "甲".repeat(32_768)];
  const data = codes.map((code, index) => {
    const row = bundle(index + 10, "draft");
    row.product.product_code = code;
    return row;
  });
  const reader = repo(createOfflineCatalogSource(data));
  const state = await loadAdminProductsList(reader);
  assert.equal(state.kind, "success");
  const html = render({ state: "success", products: state.products });
  for (let index = 0; index < codes.length; index++) {
    const productId = id(index + 10);
    const href = adminProductIdDetailHref(productId, "/admin/products");
    assert.ok(href.length < 64);
    assert.ok(html.includes(`href="${href}"`));
    assert.equal((await reader.getAdminProductById(productId)).basic.product_code, codes[index]);
    assert.equal(href.includes(codes[index]), false);
  }
  assert.ok(adminProductDetailHref("CN-甲", "/admin/products").startsWith("/admin/products/by-code/"));
  assert.ok(adminProductDetailHref("A/B", "/admin/products").startsWith("/admin/products/by-code/"));
  let reads = 0;
  const guarded = { ...createOfflineCatalogSource(data), async getAdminById(value) {
    reads++; return data.find((row) => row.product.id === value) ?? null;
  } };
  await assert.rejects(repo(guarded, "no-grant").getAdminProductById(id(10)), { code: "FORBIDDEN" });
  assert.equal(reads, 0);
});
test("default page uses trusted server wiring with no query-controlled source switch", () => {
  const page = readFileSync(new URL("src/app/admin/(workspace)/products/page.tsx", root), "utf8");
  const server = readFileSync(new URL("src/lib/catalog-read/server.ts", root), "utf8");
  const loading = readFileSync(new URL("src/app/admin/(workspace)/products/loading.tsx", root), "utf8");
  assert.ok(page.indexOf('requireAdminPage("catalog.read")') < page.indexOf("createServerCatalogReadRepository()"));
  assert.match(page, /error\.code === "FORBIDDEN"\) redirect\("\/admin\/login\?error=1"\)/);
  assert.match(server, /^import "server-only";/);
  assert.match(server, /notConfiguredCatalogSource/);
  assert.match(page, /parseAdminProductsUrl\(await searchParams\)/);
  assert.doesNotMatch(page, /ADMIN_UI_FIXTURE|TEST_DATA|request\.url|process\.env/);
  assert.doesNotMatch(server, /ADMIN_UI_FIXTURE|TEST_DATA|request\.url/);
  assert.match(server, /process\.env\.CATALOG_READ_SOURCE === "supabase" && process\.env\.NODE_ENV === "production"/);
  assert.match(loading, /state="loading"/);
  assert.match(render({ state: "loading" }), /Loading products/);
});
