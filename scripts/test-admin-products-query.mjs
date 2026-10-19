import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createAdminCursorCodec } from "../src/lib/catalog-read/admin-cursor.ts";
import { createOfflineCatalogSource, notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";
import { loadAdminProductsList } from "../src/lib/admin/products-list-state.ts";
import { adminProductsHref, nextAdminProductsHref, parseAdminProductsUrl,
  previousAdminProductsHref } from "../src/lib/admin/products-query.ts";

const date = "2026-10-01T00:00:00.000Z";
const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const categoryA = id(701);
const categoryB = id(702);
const category = (n) => ({ id: id(n), parent_id: null, slug: n === 701 ? "nails" : "care",
  status: "published", name_en: n === 701 ? "Nails" : "Care",
  name_zh: n === 701 ? "美甲" : "护理", description_en: "", description_zh: "",
  sort_order: 0, created_at: date, updated_at: date });
function bundle(n, code, status, primary) {
  const productId = id(n);
  return {
    product: { id: productId, product_code: code, slug: code.toLowerCase(),
      product_type: "press-on", status, attributes: {}, customization_options: [],
      oem: false, odm: false, lead_time_min_days: null, lead_time_max_days: null,
      seo_indexable: false, featured: false, new_arrival: false,
      published_at: status === "published" ? date : null, created_at: date, updated_at: date },
    translations: [
      { product_id: productId, locale: "en", name: `English ${code}`,
        short_description: "", description: "", seo_title: "", seo_description: "",
        created_at: date, updated_at: date },
      { product_id: productId, locale: "zh", name: `中文商品 ${n}`,
        short_description: "", description: "", seo_title: "", seo_description: "",
        created_at: date, updated_at: date },
    ],
    variants: [{ id: id(n + 100), product_id: productId, sku: `SKU-${n}`, status,
      attributes: {}, moq_quantity: "100", moq_unit: "pieces", order_multiple: null,
      package_quantity: null, package_unit: null, reference_price: null,
      reference_currency: null, sort_order: 0, created_at: date, updated_at: date }],
    categoryLinks: [
      { product_id: productId, category_id: primary, is_primary: true, sort_order: 0,
        created_at: date, updated_at: date },
      ...(n === 1 ? [{ product_id: productId, category_id: categoryB,
        is_primary: false, sort_order: 1, created_at: date, updated_at: date }] : []),
    ],
    categories: [category(701), category(702)],
    images: [],
  };
}
const fixtures = [
  bundle(1, "FAMILY-Z", "draft", categoryA),
  bundle(2, "FAMILY-A", "published", categoryA),
  bundle(3, "FAMILY-C", "retired", categoryA),
  bundle(4, "FAMILY-B", "draft", categoryB),
  bundle(5, "FAMILY-E", "published", categoryB),
  bundle(6, "FAMILY-D", "retired", categoryB),
];
const deps = {
  provider: { async verifySession(session) {
    return session === "editor" || session === "no-grant"
      ? { identity_provider: "test", provider_subject: session } : null;
  } },
  directory: { async findByProviderIdentity(identity) {
    return { admin_id: id(999), identity_provider: "test",
      provider_subject: identity.provider_subject, status: "active",
      created_at: date, disabled_at: null,
      permissions: identity.provider_subject === "editor" ? ["catalog.read"] : [] };
  } },
};
const cursorCodec = createAdminCursorCodec(randomBytes(32).toString("base64url"));
const repo = (source = createOfflineCatalogSource(fixtures), session = "editor", codec = cursorCodec) =>
  createCatalogReadRepository(source, { session, dependencies: deps }, codec);
const codes = (page) => page.items.map((item) => item.productCode);
const params = (href) => Object.fromEntries(new URL(href, "http://local.invalid").searchParams);
const changePayload = (cursor, field, value) => {
  const [encoded, signature] = cursor.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  payload[field] = value;
  return `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${signature}`;
};

test("search executes at the source boundary on code, English and Chinese names", async () => {
  const source = createOfflineCatalogSource(fixtures);
  const reader = repo(source);
  assert.deepEqual(codes(await reader.listAdminProducts({ search: "  family-z  " })), ["FAMILY-Z"]);
  assert.deepEqual(codes(await reader.listAdminProducts({ search: "ENGLISH FAMILY-A" })), ["FAMILY-A"]);
  assert.deepEqual(codes(await reader.listAdminProducts({ search: "中文商品 3" })), ["FAMILY-C"]);
  assert.equal((await reader.listAdminProducts({ search: "   " })).items.length, 6);
  assert.deepEqual(codes(await reader.listAdminProducts({ search: "SKU-1" })), []);
  await assert.rejects(reader.listPublishedProducts({ search: "family" }), { code: "INVALID_INPUT" });
});

test("status and primary category filters combine without treating additional categories as primary", async () => {
  const reader = repo();
  for (const [status, expected] of [
    ["draft", ["FAMILY-Z", "FAMILY-B"]],
    ["published", ["FAMILY-A", "FAMILY-E"]],
    ["retired", ["FAMILY-C", "FAMILY-D"]],
  ])
    assert.deepEqual(codes(await reader.listAdminProducts({ status })), expected);
  assert.deepEqual(codes(await reader.listAdminProducts({ primaryCategoryId: categoryB,
    search: "family-z" })), []);
  assert.deepEqual(codes(await reader.listAdminProducts({ primaryCategoryId: categoryA,
    status: "published", search: "family" })), ["FAMILY-A"]);
  assert.deepEqual((await reader.listAdminPrimaryCategoryOptions()).items.map((item) => item.id),
    [categoryB, categoryA]);
  await assert.rejects(reader.listAdminProducts({ primaryCategoryId: "mock-nails" }), { code: "INVALID_INPUT" });
});

test("four sorts and legacy updated sort are stable with identical timestamps", async () => {
  const reader = repo();
  for (const [sort, expected] of [
    ["updated", ["FAMILY-Z", "FAMILY-A", "FAMILY-C", "FAMILY-B", "FAMILY-E", "FAMILY-D"]],
    ["updated_desc", ["FAMILY-Z", "FAMILY-A", "FAMILY-C", "FAMILY-B", "FAMILY-E", "FAMILY-D"]],
    ["updated_asc", ["FAMILY-Z", "FAMILY-A", "FAMILY-C", "FAMILY-B", "FAMILY-E", "FAMILY-D"]],
    ["product_code_asc", ["FAMILY-A", "FAMILY-B", "FAMILY-C", "FAMILY-D", "FAMILY-E", "FAMILY-Z"]],
    ["product_code_desc", ["FAMILY-Z", "FAMILY-E", "FAMILY-D", "FAMILY-C", "FAMILY-B", "FAMILY-A"]],
  ])
    assert.deepEqual(codes(await reader.listAdminProducts({ sort })), expected);
});

test("updated ascending and descending compare timestamps before the stable id key", async () => {
  const changed = fixtures.map((row, index) => ({
    ...row, product: { ...row.product,
      updated_at: index < 2 ? "2026-10-02T00:00:00.000Z" : date },
  }));
  const reader = repo(createOfflineCatalogSource(changed));
  assert.deepEqual(codes(await reader.listAdminProducts({ sort: "updated_desc" })),
    ["FAMILY-Z", "FAMILY-A", "FAMILY-C", "FAMILY-B", "FAMILY-E", "FAMILY-D"]);
  assert.deepEqual(codes(await reader.listAdminProducts({ sort: "updated_asc" })),
    ["FAMILY-C", "FAMILY-B", "FAMILY-E", "FAMILY-D", "FAMILY-Z", "FAMILY-A"]);
});

test("keyset pages have no duplicates or omissions and bind sort and filters", async () => {
  const reader = repo();
  for (const sort of ["updated_desc", "updated_asc", "product_code_asc", "product_code_desc"]) {
    const seen = [];
    let cursor;
    const pages = [];
    for (let pageNumber = 0; pageNumber < 3; pageNumber++) {
      const page = await reader.listAdminProducts({ sort, limit: 2, cursor });
      pages.push(page);
      seen.push(...codes(page));
      cursor = page.nextCursor ?? undefined;
      if (pageNumber < 2) assert.ok(cursor);
      else assert.equal(cursor, undefined);
    }
    assert.equal(seen.length, 6);
    assert.equal(new Set(seen).size, 6);
    const previousSecond = await reader.listAdminProducts({
      sort, limit: 2, cursor: pages[2].previousCursor, direction: "before",
    });
    assert.deepEqual(codes(previousSecond), codes(pages[1]));
    const previousFirst = await reader.listAdminProducts({
      sort, limit: 2, cursor: previousSecond.previousCursor, direction: "before",
    });
    assert.deepEqual(codes(previousFirst), codes(pages[0]));
    assert.equal(previousFirst.previousCursor ?? null, null);
  }
  const first = await reader.listAdminProducts({ sort: "product_code_asc", limit: 2 });
  await assert.rejects(reader.listAdminProducts({ sort: "updated_desc", cursor: first.nextCursor }), { code: "INVALID_INPUT" });
  await assert.rejects(reader.listAdminProducts({ sort: "product_code_asc", status: "draft",
    cursor: first.nextCursor }), { code: "INVALID_INPUT" });
  await assert.rejects(reader.listAdminProducts({ sort: "product_code_asc", search: "family",
    cursor: first.nextCursor }), { code: "INVALID_INPUT" });
  await assert.rejects(reader.listAdminProducts({ sort: "product_code_asc", primaryCategoryId: categoryA,
    cursor: first.nextCursor }), { code: "INVALID_INPUT" });
});

test("first-row reverse cursors restore Previous without a URL history stack", async () => {
  const reader = repo();
  const firstQuery = parseAdminProductsUrl({ q: " family ", sort: "product_code_asc", status: "all" });
  const first = await reader.listAdminProducts({ ...firstQuery.repositoryQuery, limit: 2 });
  const secondHref = nextAdminProductsHref(firstQuery, first.nextCursor);
  const secondQuery = parseAdminProductsUrl(params(secondHref));
  assert.equal(secondQuery.page, 2);
  const second = await reader.listAdminProducts({ ...secondQuery.repositoryQuery, limit: 2 });
  assert.equal(previousAdminProductsHref(secondQuery, second.previousCursor), adminProductsHref(firstQuery));
  const thirdHref = nextAdminProductsHref(secondQuery, second.nextCursor);
  const thirdQuery = parseAdminProductsUrl(params(thirdHref));
  const third = await reader.listAdminProducts({ ...thirdQuery.repositoryQuery, limit: 2 });
  const reverseHref = previousAdminProductsHref(thirdQuery, third.previousCursor);
  assert.deepEqual(codes(await reader.listAdminProducts({
    ...parseAdminProductsUrl(params(reverseHref)).repositoryQuery, limit: 2,
  })), codes(second));
  assert.equal(parseAdminProductsUrl(params(thirdHref)).cursor, thirdQuery.cursor);
  assert.equal(parseAdminProductsUrl({ q: "different" }).cursor, null);
});

test("invalid URL values, reverse cursor, status, sort and size fail closed", async () => {
  for (const raw of [
    { status: "owner" }, { sort: "id;drop" }, { category: "mock-id" },
    { q: "x".repeat(101) }, { q: ["one", "two"] }, { cursor: "bad" },
    { page: "2" }, { direction: "before" }, { cursor: "bad", page: "2" },
  ]) assert.throws(() => parseAdminProductsUrl(raw), { code: "INVALID_INPUT" });
  await assert.rejects(repo().listAdminProducts({ limit: 51 }), { code: "INVALID_INPUT" });
  await assert.rejects(repo().listAdminProducts({ limit: 0 }), { code: "INVALID_INPUT" });
  await assert.rejects(repo().listAdminProducts({ sort: "sql desc" }), { code: "INVALID_INPUT" });
});

test("signed Admin cursors reject every payload, signature and key substitution before source access", async () => {
  const reader = repo();
  const updated = (await reader.listAdminProducts({ sort: "updated_desc", limit: 2 })).nextCursor;
  const code = (await reader.listAdminProducts({ sort: "product_code_asc", limit: 2 })).nextCursor;
  assert.ok(updated && code);
  const updatedFields = JSON.parse(Buffer.from(updated.split(".")[0], "base64url").toString("utf8"));
  const codeFields = JSON.parse(Buffer.from(code.split(".")[0], "base64url").toString("utf8"));
  const cases = [
    [changePayload(updated, 5, id(99)), "updated_desc"],
    [changePayload(updated, 6, "2026-10-03T00:00:00.000Z"), "updated_desc"],
    [changePayload(code, 7, "FAMILY-Y"), "product_code_asc"],
    [changePayload(updated, 3, JSON.stringify([null, null, "draft"])), "updated_desc"],
    [changePayload(updated, 2, "updated_asc"), "updated_desc"],
    [changePayload(updated, 4, "before"), "updated_desc"],
    [changePayload(updated, 1, "public"), "updated_desc"],
    [changePayload(updated, 0, 1), "updated_desc"],
    [updated.split(".")[0], "updated_desc"],
    [`${updated.split(".")[0]}.${"A".repeat(43)}`, "updated_desc"],
    [Buffer.from(JSON.stringify({ v: 1, scope: "admin", sort: "updated_desc",
      filter: updatedFields[3], id: updatedFields[5], timestamp: updatedFields[6], featured: false })).toString("base64url"), "updated_desc"],
    [Buffer.from(JSON.stringify(updatedFields)).toString("base64url"), "updated_desc"],
    ["a".repeat(1025), "updated_desc"],
    ["not+base64", "updated_desc"],
    [code, "updated_desc"],
    [changePayload(code, 7, codeFields[7] + "X"), "product_code_asc"],
  ];
  let reads = 0;
  const source = { mode: "offline",
    async listAdmin() { reads++; return { rows: [], hasMore: false }; },
    async getAdminByCode() { return null; },
    async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  for (const [cursor, sort] of cases)
    await assert.rejects(repo(source).listAdminProducts({ cursor, sort, limit: 2 }), { code: "INVALID_INPUT" });
  await assert.rejects(repo(source).listAdminProducts({ cursor: updated, sort: "updated_desc",
    direction: "before", limit: 2 }), { code: "INVALID_INPUT" });
  const differentKey = createAdminCursorCodec(randomBytes(32).toString("base64url"));
  await assert.rejects(repo(source, "editor", differentKey).listAdminProducts({ cursor: updated,
    sort: "updated_desc", limit: 2 }), { code: "INVALID_INPUT" });
  const publicCursor = (await reader.listPublishedProducts({ limit: 1 })).nextCursor;
  assert.ok(publicCursor);
  await assert.rejects(repo(source).listAdminProducts({ cursor: publicCursor,
    sort: "updated_desc", limit: 2 }), { code: "INVALID_INPUT" });
  await assert.rejects(reader.listPublishedProducts({ cursor: updated, limit: 1 }), { code: "INVALID_INPUT" });
  assert.equal(reads, 0);
});

test("missing signing key fails closed and a valid cursor never replaces catalog.read", async () => {
  let reads = 0;
  const source = { mode: "offline",
    async listAdmin() { reads++; return { rows: [], hasMore: false }; },
    async getAdminByCode() { return null; },
    async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  const cursor = (await repo().listAdminProducts({ sort: "updated_desc", limit: 2 })).nextCursor;
  assert.ok(cursor);
  await assert.rejects(repo(source, "editor", null).listAdminProducts(), { code: "NOT_CONFIGURED" });
  await assert.rejects(repo(source, "no-grant").listAdminProducts({ cursor,
    sort: "updated_desc", limit: 2 }), { code: "FORBIDDEN" });
  await assert.rejects(repo(source, null).listAdminProducts({ cursor,
    sort: "updated_desc", limit: 2 }), { code: "FORBIDDEN" });
  assert.equal(reads, 0);
  assert.throws(() => createAdminCursorCodec(""), { code: "NOT_CONFIGURED" });
});

test("signing key remains outside cursor and response DTO", async () => {
  const encodedKey = randomBytes(32).toString("base64url");
  const reader = repo(createOfflineCatalogSource(fixtures), "editor", createAdminCursorCodec(encodedKey));
  const result = await reader.listAdminProducts({ limit: 2, sort: "updated_desc" });
  assert.ok(result.nextCursor);
  const payload = JSON.parse(Buffer.from(result.nextCursor.split(".")[0], "base64url").toString("utf8"));
  assert.equal(payload.length, 8);
  assert.equal(payload[1], "admin");
  assert.equal(JSON.stringify(result).includes(encodedKey), false);
  assert.equal(result.nextCursor.includes(encodedKey), false);
});

test("empty and single-product catalog have no pagination links", async () => {
  const empty = await repo(createOfflineCatalogSource([])).listAdminProducts({ limit: 1 });
  assert.deepEqual(empty, { items: [], nextCursor: null });
  const single = await repo(createOfflineCatalogSource([fixtures[0]])).listAdminProducts({ limit: 1 });
  assert.deepEqual(codes(single), ["FAMILY-Z"]);
  assert.equal(single.nextCursor, null);
  assert.equal(single.previousCursor ?? null, null);
});

test("authorization precedes all source reads, including options and existence checks", async () => {
  let reads = 0;
  const source = { mode: "offline",
    async listAdmin() { reads++; return { rows: [], hasMore: false }; },
    async listAdminPrimaryCategoryOptions() { reads++; return { items: [], hasMore: false }; },
    async getAdminByCode() { return null; },
    async listPublished() { return { rows: [], hasMore: false }; },
    async getPublishedBySlug() { return null; } };
  for (const session of [null, "no-grant"]) {
    await assert.rejects(loadAdminProductsList(repo(source, session), { search: "anything" }), { code: "FORBIDDEN" });
    await assert.rejects(repo(source, session).listAdminPrimaryCategoryOptions(), { code: "FORBIDDEN" });
  }
  assert.equal(reads, 0);
});

test("disconnected, empty catalog and no matching products remain distinct", async () => {
  assert.equal((await loadAdminProductsList(repo(notConfiguredCatalogSource))).kind, "not_connected");
  assert.equal((await loadAdminProductsList(repo(createOfflineCatalogSource([])))).kind, "empty");
  assert.equal((await loadAdminProductsList(repo(), { search: "nothing" })).kind, "no_matches");
});
