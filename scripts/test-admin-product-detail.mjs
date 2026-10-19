import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createOfflineCatalogSource, notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";
import { loadAdminProductDetail } from "../src/lib/admin/product-detail-state.ts";
import { adminProductDetailHref, safeProductsReturnHref } from "../src/lib/admin/product-detail-navigation.ts";
import { toAdminProductDetailView } from "../src/lib/admin/product-detail-view.ts";

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
const { ProductDetailPanel, ProductDetailStatePanel } = loadComponent(
  "src/components/admin/product-detail-panel.tsx", { "./ui": ui });
const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const date = "2026-10-01T00:00:00.000Z";
const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const account = { admin_id: id(999), identity_provider: "test", provider_subject: "active",
  status: "active", created_at: date, disabled_at: null, permissions: ["catalog.read"] };
const dependencies = {
  provider: { async verifySession(session) { return session === "active" || session === "no-grant"
    ? { identity_provider: "test", provider_subject: session } : null; } },
  directory: { async findByProviderIdentity(identity) { return identity.provider_subject === "active"
    ? account : { ...account, provider_subject: "no-grant", permissions: [] }; } },
};
const repo = (source, session = "active") => createCatalogReadRepository(source, { session, dependencies });
function bundle() {
  const productId = id(1);
  const variants = [
    { id: id(101), product_id: productId, sku: "SKU-BLUE", status: "published", attributes: { color: "blue" },
      moq_quantity: "100", moq_unit: "pieces", order_multiple: null, package_quantity: null, package_unit: null,
      reference_price: null, reference_currency: null, sort_order: 0, created_at: date, updated_at: date },
    { id: id(102), product_id: productId, sku: "SKU-DRAFT", status: "draft", attributes: {},
      moq_quantity: "250", moq_unit: "pieces", order_multiple: null, package_quantity: null, package_unit: null,
      reference_price: null, reference_currency: null, sort_order: 1, created_at: date, updated_at: date },
  ];
  const categories = [301, 302].map((n) => ({ id: id(n), parent_id: null, slug: `category-${n}`,
    status: "published", name_en: `Category ${n}`, name_zh: `分类 ${n}`,
    description_en: "", description_zh: "", sort_order: n, created_at: date, updated_at: date }));
  return { product: { id: productId, product_code: "FAMILY-1", slug: "family-1", product_type: "press-on",
    status: "published", attributes: {}, customization_options: [], oem: false, odm: false,
    lead_time_min_days: null, lead_time_max_days: null, seo_indexable: false,
    featured: false, new_arrival: false, published_at: date, created_at: date, updated_at: date },
    translations: [
      { product_id: productId, locale: "en", name: "English Family", short_description: "",
        description: "English description", seo_title: "English SEO", seo_description: "English SEO description",
        created_at: date, updated_at: date },
      { product_id: productId, locale: "zh", name: "中文商品", short_description: "",
        description: "中文描述", seo_title: "", seo_description: "", created_at: date, updated_at: date },
    ],
    variants,
    categoryLinks: [
      { product_id: productId, category_id: id(301), is_primary: true, sort_order: 0, created_at: date, updated_at: date },
      { product_id: productId, category_id: id(302), is_primary: false, sort_order: 1, created_at: date, updated_at: date },
    ], categories,
    images: [
      { id: id(401), product_id: productId, variant_id: null, storage_key: "private/secret.webp",
        public_url: "https://example.invalid/image.webp", role: "primary", status: "published", sort_order: 0,
        width: null, height: null, format: "webp", alt_en: "Front view", alt_zh: "正面",
        created_at: date, updated_at: date },
      { id: id(402), product_id: productId, variant_id: id(102), storage_key: "private/draft.webp",
        public_url: "https://example.invalid/draft.webp", role: "variant", status: "draft", sort_order: 1,
        width: null, height: null, format: "webp", alt_en: "Draft variant", alt_zh: "",
        created_at: date, updated_at: date },
    ] };
}

test("configured Product Code lookup returns the B1 Admin detail DTO and never searches the whole list", async () => {
  const source = createOfflineCatalogSource([bundle()]);
  const detail = await loadAdminProductDetail(repo(source), "FAMILY-1");
  assert.equal(detail.kind, "success");
  assert.equal(detail.product.basic.product_code, "FAMILY-1");
  assert.deepEqual(detail.product.variants.map((item) => item.sku), ["SKU-BLUE", "SKU-DRAFT"]);
  assert.equal(detail.product.categories.primary.name.en, "Category 301");
  assert.equal(detail.product.categories.additional[0].name.zh, "分类 302");
  assert.equal(detail.product.translations.en.value.name, "English Family");
  assert.equal(detail.product.translations.zh.value.name, "中文商品");
  assert.equal(detail.product.images[1].variantId, id(102));
  assert.equal(detail.product.variants[0].referencePrice.kind, "not_provided");
  assert.equal(detail.product.priceTiers.state, "unavailable");
  assert.equal(detail.product.variants[0].moq.quantity, 100);
  const view = toAdminProductDetailView(detail.product);
  assert.deepEqual(Object.keys(view.images[0]).sort(),
    ["id", "variantId", "role", "status", "sortOrder", "alt", "width", "height", "format"].sort());
  assert.equal(JSON.stringify(view).includes("storageKey"), false);
  assert.equal(JSON.stringify(view).includes("publicUrl"), false);
  assert.equal(JSON.stringify(view).includes("private/secret.webp"), false);
  assert.equal(JSON.stringify(view).includes("https://example.invalid/image.webp"), false);
  const html = render(ProductDetailPanel, { product: view, testData: true });
  for (const text of ["FAMILY-1", "SKU-BLUE", "SKU-DRAFT", "English Family", "中文商品", "English SEO",
    "Category 301", "Category 302", "Front view", "Draft variant", "100", "250", "TEST DATA"])
    assert.ok(html.includes(text), text);
  for (const privateValue of ["private/secret.webp", "private/draft.webp", "https://example.invalid/image.webp"])
    assert.equal(html.includes(privateValue), false, privateValue);
  assert.equal(render(ProductDetailPanel, { product: view }).includes("TEST DATA"), false);
});

test("missing translation and SEO are explicit; no false price or SKU-derived product identity", async () => {
  const data = bundle();
  const source = createOfflineCatalogSource([{ ...data, translations: data.translations.slice(0, 1) }]);
  const result = await loadAdminProductDetail(repo(source), "FAMILY-1");
  assert.equal(result.product.translations.zh.state, "unavailable");
  assert.equal(result.product.seo.zh.state, "unavailable");
  const html = render(ProductDetailPanel, { product: toAdminProductDetailView(result.product) });
  assert.match(html, /Translation not available/);
  assert.match(html, /Tiered pricing: Not Available/);
  assert.doesNotMatch(html, /stock quantity|inventory|<td>USD<\/td>/i);
  assert.deepEqual(await loadAdminProductDetail(repo(source), "SKU-BLUE"), { kind: "not_found" });
});

test("not configured, not found, source unavailable and invalid input stay distinct", async () => {
  assert.equal((await loadAdminProductDetail(repo(notConfiguredCatalogSource), "FAMILY-1")).kind, "not_connected");
  assert.equal((await loadAdminProductDetail(repo(createOfflineCatalogSource([])), "FAMILY-1")).kind, "not_found");
  const failed = { mode: "offline", async getAdminByCode() { throw Error("postgres://secret.invalid"); },
    async listAdmin() { return { rows: [], hasMore: false }; }, async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  assert.equal((await loadAdminProductDetail(repo(failed), "FAMILY-1")).kind, "source_unavailable");
  assert.doesNotMatch(render(ProductDetailStatePanel, { state: "source_unavailable" }), /postgres|secret\.invalid/i);
  for (const state of ["not_connected", "not_found", "source_unavailable"])
    assert.ok(render(ProductDetailStatePanel, { state }).length > 0);
  await assert.rejects(loadAdminProductDetail(repo(failed), "../private"), { code: "INVALID_INPUT" });
});

test("anonymous and unauthorized detail reads call the source zero times", async () => {
  let reads = 0;
  const source = { mode: "offline", async getAdminByCode() { reads++; return bundle(); },
    async listAdmin() { return { rows: [], hasMore: false }; }, async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  for (const session of [null, "no-grant"])
    await assert.rejects(loadAdminProductDetail(repo(source, session), "FAMILY-1"), { code: "FORBIDDEN" });
  assert.equal(reads, 0);
});

test("return target is a validated same-site product list URL", () => {
  assert.equal(safeProductsReturnHref("/admin/products"), "/admin/products");
  assert.equal(adminProductDetailHref("FAMILY-1", "/admin/products"), "/admin/products/FAMILY-1");
  assert.equal(adminProductDetailHref("FAMILY-1", "/admin/products?status=published"),
    "/admin/products/FAMILY-1?returnTo=%2Fadmin%2Fproducts%3Fstatus%3Dpublished");
  assert.equal(safeProductsReturnHref("/admin/products?status=published&sort=product_code_desc"),
    "/admin/products?status=published&sort=product_code_desc");
  assert.equal(safeProductsReturnHref("/admin/products?q=test"), "/admin/products?q=test");
  for (const target of ["https://evil.invalid/", "//evil.invalid/", "/admin/products/../login?x=1",
    "%2F%2Fevil.invalid%2F", "%68ttps%3A%2F%2Fevil.invalid%2F",
    "/admin/products?q=a\\b", "/admin/products?q=a\nb", "/admin/products?q=a%0Ab",
    "/admin/products?q=a%00b", "/admin/products?q=a%7Fb", "/admin/products?q=a%5Cb",
    "/admin/login?x=1", "/admin/categories?x=1", "/admin/products/other?q=1",
    "/admin/products?cursor=bad&page=2", "/admin/products?status=draft&status=published",
    "/admin/products?unknown=1", `/admin/products?q=${"x".repeat(2050)}`])
    assert.equal(safeProductsReturnHref(target), "/admin/products");
});

test("route authorizes before Repository; Public projection remains published-only", async () => {
  const page = readFileSync(new URL("src/app/admin/(workspace)/products/[productCode]/page.tsx", root), "utf8");
  const server = readFileSync(new URL("src/lib/catalog-read/server.ts", root), "utf8");
  const loading = readFileSync(new URL("src/app/admin/(workspace)/products/[productCode]/loading.tsx", root), "utf8");
  assert.ok(page.indexOf('requireAdminPage("catalog.read")') < page.indexOf("createServerCatalogReadRepository()"));
  assert.match(server, /^import "server-only";/);
  assert.match(loading, /Loading product detail/);
  assert.doesNotMatch(page + server, /request\.url|ADMIN_UI_FIXTURE|TEST_DATA|service_role/);
  const publicResult = await repo(createOfflineCatalogSource([bundle()])).getPublishedProductBySlug("family-1");
  assert.deepEqual(publicResult.variants.map((item) => item.sku), ["SKU-BLUE"]);
  assert.equal(publicResult.images.length, 1);
  assert.equal(JSON.stringify(publicResult).includes("storageKey"), false);
});
