import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import { createAdminCursorCodec } from "../src/lib/catalog-read/admin-cursor.ts";
import { createOfflineCatalogSource } from "../src/lib/catalog-read/offline.ts";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { adminProductIdDetailHref, safeProductsReturnHref } from "../src/lib/admin/product-detail-navigation.ts";
import { adminProductsHref, parseAdminProductsUrl } from "../src/lib/admin/products-query.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const date = "2026-10-01T00:00:00.000Z";
const category = id(700);
function bundle(n, code, status = "draft") {
  const productId = id(n);
  return {
    product: { id: productId, product_code: code, slug: `item-${n}`, product_type: "nails",
      status, attributes: {}, customization_options: [], oem: false, odm: false,
      lead_time_min_days: null, lead_time_max_days: null, seo_indexable: false,
      featured: false, new_arrival: false, published_at: null, created_at: date, updated_at: date },
    translations: [{ product_id: productId, locale: "en", name: `Family ${n}`,
      short_description: "", description: "", seo_title: "", seo_description: "",
      created_at: date, updated_at: date }],
    variants: [], categoryLinks: [{ product_id: productId, category_id: category,
      is_primary: true, sort_order: 0, created_at: date, updated_at: date }],
    categories: [{ id: category, parent_id: null, slug: "nails", status: "published",
      name_en: "Nails", name_zh: "美甲", description_en: "", description_zh: "",
      sort_order: 0, created_at: date, updated_at: date }], images: [],
  };
}
const deps = {
  provider: { async verifySession(session) {
    return session === "editor" || session === "no-grant"
      ? { identity_provider: "test", provider_subject: session } : null;
  } },
  directory: { async findByProviderIdentity(identity) {
    return { admin_id: id(900), identity_provider: "test", provider_subject: identity.provider_subject,
      status: "active", created_at: date, disabled_at: null,
      permissions: identity.provider_subject === "editor" ? ["catalog.read"] : [] };
  } },
};
const key = randomBytes(32).toString("base64url");
const codec = createAdminCursorCodec(key);
const repository = (source, session = "editor", signer = codec) =>
  createCatalogReadRepository(source, { session, dependencies: deps }, signer);

test("UUID detail is bounded, authorized and keeps Product Code identity", async () => {
  for (const code of ["CN-甲", "A/B", "A B", "A!", "甲".repeat(32_768)]) {
    const source = createOfflineCatalogSource([bundle(1, code)]);
    const path = adminProductIdDetailHref(id(1), "/admin/products");
    assert.equal(path, `/admin/products/id/${id(1)}`);
    assert.equal((await repository(source).getAdminProductById(id(1))).basic.product_code, code);
  }
  let reads = 0;
  const source = { ...createOfflineCatalogSource([bundle(1, "CN-甲")]),
    async getAdminById(value) { reads++; return bundle(1, value); } };
  await assert.rejects(repository(source, "no-grant").getAdminProductById(id(1)), { code: "FORBIDDEN" });
  await assert.rejects(repository(source, null).getAdminProductById(id(1)), { code: "FORBIDDEN" });
  await assert.rejects(repository(source).getAdminProductById("not-a-uuid"), { code: "INVALID_INPUT" });
  assert.equal(reads, 0);
  assert.throws(() => adminProductIdDetailHref("not-a-uuid", "/admin/products"), { code: "INVALID_INPUT" });
});

test("V2 is fixed-size for all legal code lengths and retains four-sort Next/Previous", async () => {
  for (const length of [128, 1024, 4096, 8192, 32_768]) {
    const rows = [bundle(1, "A"), bundle(2, "甲".repeat(length)), bundle(3, "龥")];
    for (const sort of ["updated_desc", "updated_asc", "product_code_asc", "product_code_desc"]) {
      const reader = repository(createOfflineCatalogSource(rows));
      const first = await reader.listAdminProducts({ sort, limit: 1 });
      assert.ok(first.nextCursor && first.nextCursor.length < 512);
      const second = await reader.listAdminProducts({ sort, limit: 1, cursor: first.nextCursor });
      assert.ok(second.previousCursor && second.previousCursor.length < 512);
      const back = await reader.listAdminProducts({ sort, limit: 1,
        cursor: second.previousCursor, direction: "before" });
      assert.deepEqual(back.items.map((item) => item.id), first.items.map((item) => item.id));
    }
  }
});

test("maximum Chinese search and filters preserve bounded list and return URLs", async () => {
  const search = "甲".repeat(100);
  const reader = repository(createOfflineCatalogSource([
    bundle(1, `${search}A`), bundle(2, `${search}B`),
  ]));
  const query = parseAdminProductsUrl({ q: search, status: "draft", category,
    sort: "product_code_asc" });
  const first = await reader.listAdminProducts({ ...query.repositoryQuery, limit: 1 });
  assert.ok(first.nextCursor);
  const listUrl = adminProductsHref(query, first.nextCursor, "after", 2);
  assert.equal(safeProductsReturnHref(listUrl), listUrl);
  const detailUrl = adminProductIdDetailHref(id(1), listUrl);
  assert.ok(listUrl.length < 2048);
  assert.ok(detailUrl.length < 4096);
  assert.ok(!detailUrl.includes(`${search}A`));
  const second = await reader.listAdminProducts({ ...query.repositoryQuery,
    limit: 1, cursor: first.nextCursor });
  assert.equal(second.items[0].id, id(2));
});

test("V2 tampering, old signed cursor, cross-sort, cross-direction and key rotation fail closed", async () => {
  const original = createOfflineCatalogSource([bundle(1, "A"), bundle(2, "B")]);
  let calls = 0;
  const source = { ...original, async listAdmin(query) { calls++; return original.listAdmin(query); } };
  const first = await repository(source).listAdminProducts({ limit: 1, sort: "product_code_asc" });
  const cursor = first.nextCursor;
  const count = calls;
  const [encoded, signature] = cursor.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  for (const [index, value] of [[0, 1], [1, "public"], [2, "updated_desc"], [3, "wrong"],
    [4, "before"], [5, id(2)], [6, "0".repeat(64)]]) {
    const changed = [...payload]; changed[index] = value;
    await assert.rejects(repository(source).listAdminProducts({ limit: 1, sort: "product_code_asc",
      cursor: `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}` }),
    { code: "INVALID_INPUT" });
  }
  const oldPayload = JSON.stringify([2, "admin", "product_code_asc", JSON.stringify([null, null, null]),
    "after", id(1), null, "A"]);
  const oldCursor = `${Buffer.from(oldPayload).toString("base64url")}.${createHmac("sha256",
    Buffer.from(key, "base64url")).update(oldPayload).digest("base64url")}`;
  for (const bad of [oldCursor, encoded, "random-json", cursor.slice(0, -1) + "Z", "A".repeat(1025)]) {
    await assert.rejects(repository(source).listAdminProducts({ limit: 1, sort: "product_code_asc",
      cursor: bad }), { code: "INVALID_INPUT" });
  }
  await assert.rejects(repository(source).listAdminProducts({ limit: 1, sort: "updated_asc",
    cursor }), { code: "INVALID_INPUT" });
  await assert.rejects(repository(source).listAdminProducts({ limit: 1, sort: "product_code_asc",
    cursor, direction: "before" }), { code: "INVALID_INPUT" });
  await assert.rejects(repository(source, "editor", createAdminCursorCodec(randomBytes(32).toString("base64url")))
    .listAdminProducts({ limit: 1, sort: "product_code_asc", cursor }), { code: "INVALID_INPUT" });
  await assert.rejects(repository(source, "no-grant").listAdminProducts({ limit: 1,
    sort: "product_code_asc", cursor }), { code: "FORBIDDEN" });
  await assert.rejects(repository(source, "editor", null).listAdminProducts({ limit: 1,
    sort: "product_code_asc", cursor }), { code: "NOT_CONFIGURED" });
  assert.equal(calls, count);
});

test("boundary deletion, code/time/status changes and filter mismatch invalidate V2", async () => {
  for (const change of ["deleted", "code", "time", "status", "category", "translation"]) {
    const rows = [bundle(1, "A"), bundle(2, "B")];
    const reader = repository(createOfflineCatalogSource(rows));
    const filters = change === "category" ? { primaryCategoryId: category } :
      change === "translation" ? { search: "family" } : {};
    const first = await reader.listAdminProducts({ sort: "product_code_asc", limit: 1, ...filters });
    if (change === "deleted") rows.splice(0, 1);
    if (change === "code") rows[0].product.product_code = "AA";
    if (change === "time") rows[0].product.updated_at = "2026-10-02T00:00:00.000Z";
    if (change === "status") rows[0].product.status = "retired";
    if (change === "category") rows[0].categoryLinks = [];
    if (change === "translation") rows[0].translations[0].name = "Different";
    await assert.rejects(reader.listAdminProducts({ sort: "product_code_asc", limit: 1,
      cursor: first.nextCursor, ...filters }), { code: "INVALID_INPUT" });
  }
});

test("Public cursor is not accepted by Admin and Admin V2 is not accepted by Public", async () => {
  const rows = [bundle(1, "A", "published"), bundle(2, "B", "published")];
  for (const row of rows) row.product.published_at = date;
  const reader = repository(createOfflineCatalogSource(rows));
  const admin = await reader.listAdminProducts({ limit: 1 });
  const published = await reader.listPublishedProducts({ limit: 1 });
  await assert.rejects(reader.listAdminProducts({ limit: 1, cursor: published.nextCursor }),
    { code: "INVALID_INPUT" });
  await assert.rejects(reader.listPublishedProducts({ limit: 1, cursor: admin.nextCursor }),
    { code: "INVALID_INPUT" });
});
