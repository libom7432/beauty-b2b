import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { createPostgresCatalogReadSource } from "../src/lib/catalog-read/postgres-core.ts";
import { adminCursorQueryFingerprint, createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createAdminCursorCodec } from "../src/lib/catalog-read/admin-cursor.ts";
import { requireLocalCatalogReadUrl } from "../src/lib/catalog-read/postgres-local-config.ts";

const id = (number) => `${String(number).padStart(8, "0")}-0000-4000-8000-000000000000`;
const stamp = "2026-10-01T12:00:00.123456Z";
const product = (number, status = "published") => ({ id: id(number), product_code: `FAMILY-${number}`,
  slug: `family-${number}`, product_type: "press-on", status, attributes: {},
  customization_options: [], oem: false, odm: false, lead_time_min_days: null,
  lead_time_max_days: null, seo_indexable: false, featured: false, new_arrival: false,
  published_at: status === "published" ? stamp : null, created_at: stamp, updated_at: stamp });
const variant = (number) => ({ id: id(number + 100), product_id: id(number), sku: `SKU-${number}`,
  status: "published", attributes: {}, moq_quantity: "100", moq_unit: "pieces",
  order_multiple: null, package_quantity: null, package_unit: null, reference_price: "12.3400",
  reference_currency: "USD", sort_order: 0, created_at: stamp, updated_at: stamp });

const account = { admin_id: id(900), identity_provider: "test", provider_subject: "admin",
  status: "active", created_at: stamp, disabled_at: null, permissions: ["catalog.read"] };
const auth = (session = "admin") => ({ session, dependencies: {
  provider: { async verifySession(value) { return value === "admin" || value === "no-grant"
    ? { identity_provider: "test", provider_subject: value } : null; } },
  directory: { async findByProviderIdentity(identity) { return identity.provider_subject === "admin"
    ? account : { ...account, provider_subject: "no-grant", permissions: [] }; } },
} });
const codec = () => createAdminCursorCodec(randomBytes(32).toString("base64url"));

function fixture(products = [product(1), product(2)], publicOnly = false) {
  const calls = [];
  let candidateRows = products;
  const snapshot = async (work) => work({ async select(sql, values) {
    calls.push({ sql, values });
    if (/FROM catalog_(?:private|public)\.products p/.test(sql)) {
      if (/p\.id = \$1::uuid/.test(sql)) return products.filter((row) => row.id === values[0]);
      return candidateRows;
    }
    if (/\.product_translations t/.test(sql)) return publicOnly ? [] : products.map((row) => ({
      product_id: row.id, locale: "en", name: `Family ${row.product_code}`,
      short_description: "", description: "", seo_title: "", seo_description: "",
      created_at: stamp, updated_at: stamp }));
    if (/\.product_variants v/.test(sql)) return publicOnly ? [] : products.map((row) =>
      variant(Number(row.product_code.split("-")[1])));
    if (/\.product_categories l/.test(sql) && !/WITH RECURSIVE/.test(sql)) return [];
    if (/WITH RECURSIVE/.test(sql)) return [];
    if (/\.product_images i/.test(sql)) return [];
    if (/FROM catalog_private\.categories c/.test(sql)) return [];
    throw Error("Unexpected query shape");
  } });
  const source = createPostgresCatalogReadSource(snapshot);
  const signing = codec();
  const repository = createCatalogReadRepository(source, auth(), signing);
  return { calls, source, repository, signing, setCandidates(rows) { candidateRows = rows; } };
}

test("Admin source runs bounded, parameterized list SQL before detail hydration", async () => {
  const sample = fixture();
  const result = await sample.repository.listAdminProducts({ limit: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].productCode, "FAMILY-1");
  assert.ok(result.nextCursor);
  assert.match(sample.calls[0].sql, /FROM catalog_private\.products p/);
  assert.match(sample.calls[0].sql, /ORDER BY p\.updated_at DESC, p\.id ASC LIMIT \$1::integer/);
  assert.deepEqual(sample.calls[0].values, [2]);
  assert.ok(sample.calls.slice(1).every((call) => call.sql.includes("ANY($1::uuid[])")));
  assert.ok(sample.calls.every((call) => !/\bINSERT\b|\bUPDATE\b|\bDELETE\b|\bTRUNCATE\b|\bEXECUTE\b/i.test(call.sql)));
});

test("four Admin sorts and both signed keyset directions use fixed SQL and UUID ties", async () => {
  for (const sort of ["updated_desc", "updated_asc", "product_code_asc", "product_code_desc"]) {
    const sample = fixture();
    const first = await sample.repository.listAdminProducts({ sort, limit: 1 });
    assert.ok(first.nextCursor);
    sample.setCandidates([product(2)]);
    await sample.repository.listAdminProducts({ sort, limit: 1, cursor: first.nextCursor, direction: "after" });
    const after = sample.calls.findLast((call) => /FROM catalog_private\.products p/.test(call.sql));
    assert.match(after.sql, /p\.id > \$\d+::uuid/);
    assert.ok(after.values.includes(id(1)));
    assert.ok(after.values.includes(sort.startsWith("product_code") ? "FAMILY-1" : stamp));
    const previous = sample.repository.listAdminProducts({ sort, limit: 1,
      cursor: first.nextCursor, direction: "before" });
    await assert.rejects(previous, { code: "INVALID_INPUT" }); // direction is signed, never reused.
    const beforeCursor = sample.signing.issue({ sort, filter: adminCursorQueryFingerprint({ sort }), direction: "before" },
      product(2));
    sample.setCandidates([product(1)]);
    await sample.repository.listAdminProducts({ sort, limit: 1, cursor: beforeCursor, direction: "before" });
    const before = sample.calls.findLast((call) => /FROM catalog_private\.products p/.test(call.sql));
    assert.match(before.sql, /p\.id < \$\d+::uuid/);
    assert.match(before.sql, /p\.id DESC LIMIT/);
    assert.ok(before.values.includes(id(2)));
    const key = sort.startsWith("product_code") ? 'p.product_code COLLATE "C"' : "p.updated_at";
    const normalOrder = sort.endsWith("asc") ? "ASC" : "DESC";
    assert.ok(after.sql.includes(`ORDER BY ${key} ${normalOrder}, p.id ASC`));
    assert.ok(before.sql.includes(`ORDER BY ${key} ${normalOrder === "ASC" ? "DESC" : "ASC"}, p.id DESC`));
  }
});

test("search and primary category use bound values, escaped LIKE and is_primary", async () => {
  const sample = fixture([]);
  const term = "  A%_\\' OR 1=1  ";
  await sample.repository.listAdminProducts({ search: term, status: "draft",
    primaryCategoryId: id(701), limit: 2 });
  const { sql, values } = sample.calls[0];
  assert.match(sql, /p\.product_code ILIKE \$\d+ ESCAPE '\\'/);
  assert.match(sql, /t\.locale IN \('en','zh'\) AND t\.name ILIKE/);
  assert.match(sql, /l\.is_primary AND l\.category_id = \$\d+::uuid/);
  assert.doesNotMatch(sql, /OR 1=1/);
  assert.ok(values.includes("draft"));
  assert.ok(values.includes(id(701)));
  assert.ok(values.includes("%a\\%\\_\\\\' or 1=1%"));
});

test("direct detail uses exact Product Code, precise timestamp and decimal text", async () => {
  const sample = fixture([product(1)]);
  const detail = await sample.repository.getAdminProductByCode("FAMILY-1");
  assert.equal(detail.basic.product_code, "FAMILY-1");
  assert.equal(detail.basic.updated_at, stamp);
  assert.equal(detail.variants[0].referencePrice.amount, "12.3400");
  assert.equal(detail.variants[0].moq.quantity, 100);
  assert.match(sample.calls[0].sql, /WHERE p\.product_code = \$1 LIMIT 1/);
  assert.match(sample.calls[0].sql, /HH24:MI:SS\.US/);
  assert.deepEqual(sample.calls[0].values, ["FAMILY-1"]);
});

test("authorization and bad signed cursors stop before any query", async () => {
  const sample = fixture();
  const anon = createCatalogReadRepository(sample.source, null, codec());
  const noGrant = createCatalogReadRepository(sample.source, auth("no-grant"), codec());
  const noKey = createCatalogReadRepository(sample.source, auth(), null);
  await assert.rejects(anon.getAdminProductByCode("FAMILY-1"), { code: "FORBIDDEN" });
  await assert.rejects(noGrant.listAdminProducts(), { code: "FORBIDDEN" });
  await assert.rejects(sample.repository.listAdminProducts({ cursor: "unsigned" }), { code: "INVALID_INPUT" });
  await assert.rejects(noKey.listAdminProducts(), { code: "NOT_CONFIGURED" });
  assert.equal(sample.calls.length, 0);
});

test("empty, one-row and source failure remain distinct; category options are bounded", async () => {
  const empty = fixture([]);
  assert.deepEqual((await empty.repository.listAdminProducts()).items, []);
  const one = fixture([product(1)]);
  const page = await one.repository.listAdminProducts({ limit: 2 });
  assert.equal(page.items.length, 1);
  assert.equal(page.nextCursor, null);
  await one.repository.listAdminPrimaryCategoryOptions();
  assert.match(one.calls.findLast((call) => /FROM catalog_private\.categories c/.test(call.sql)).sql,
    /l\.is_primary[\s\S]+LIMIT 51/);
  const failed = createPostgresCatalogReadSource(async (work) => work({ async select() {
    throw Error("postgres://secret.invalid/internal-sql");
  } }));
  const repository = createCatalogReadRepository(failed, auth(), codec());
  await assert.rejects(repository.listAdminProducts(), (error) =>
    error.code === "SOURCE_UNAVAILABLE" && !String(error).includes("secret.invalid"));
});

test("Public source selects only catalog_public view columns and excludes private paths", async () => {
  const sample = fixture([product(1)], true);
  const result = await sample.repository.getPublishedProductBySlug("family-1");
  assert.equal(result.productCode, "FAMILY-1");
  assert.ok(sample.calls.every((call) => !call.sql.includes("catalog_private")));
  assert.ok(sample.calls.every((call) => !call.sql.includes("storage_key")));
  assert.equal(JSON.stringify(result).includes("storageKey"), false);
  assert.match(sample.calls[0].sql, /FROM catalog_public\.products p WHERE p\.slug = \$1 LIMIT 1/);
  sample.calls.length = 0;
  await sample.repository.listPublishedProducts({ limit: 1, status: "published" });
  assert.ok(sample.calls.every((call) => !call.sql.includes("catalog_private")));
  assert.doesNotMatch(sample.calls[0].sql, /p\.status/);
});

test("server configuration accepts only the dedicated test cluster TCP target", () => {
  const password = randomBytes(32).toString("base64url");
  const local = `postgres://catalog_read_local:${password}@127.0.0.1:55432/beauty_b2b_catalog_test`;
  assert.equal(requireLocalCatalogReadUrl(local, "test"), local);
  assert.equal(requireLocalCatalogReadUrl(local.replace("postgres:", "postgresql:"), "test"),
    local.replace("postgres:", "postgresql:"));
  for (const candidate of [undefined, "", "not-a-database-url",
    local.replace(":55432/", ":5432/"),
    local.replace("beauty_b2b_catalog_test", "another_database"),
    local.replace("catalog_read_local:", "postgres:"),
    local.replace("127.0.0.1", "db.example.com"),
    local.replace("127.0.0.1", "localhost"),
    local.replace("127.0.0.1", "127.1"),
    local.replace("127.0.0.1", "[::1]"),
    local.replace("127.0.0.1", "%2Ftmp%2Fpg-socket"),
    local.replace(`:${password}@`, "@"),
    local.replace(":55432/", "/"),
    local.replace("/beauty_b2b_catalog_test", "/"),
    `${local}?host=db.example.com`, `${local}?port=5432`,
    `${local}?database=another_database`, `${local}#override`,
    ` ${local}`, `${local} `])
    assert.throws(() => requireLocalCatalogReadUrl(candidate, "test"), { code: "NOT_CONFIGURED" });
  assert.throws(() => requireLocalCatalogReadUrl(local, "production"), { code: "NOT_CONFIGURED" });
  assert.throws(() => requireLocalCatalogReadUrl(local, "development"), { code: "NOT_CONFIGURED" });
  assert.throws(() => requireLocalCatalogReadUrl(local, undefined), { code: "NOT_CONFIGURED" });
});
