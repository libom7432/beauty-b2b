import assert from "node:assert/strict";
import test from "node:test";
import { inspectAdminCategories } from "../src/lib/catalog-read/admin-categories.ts";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createOfflineCatalogSource, notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";
import { createPostgresCatalogReadSource } from "../src/lib/catalog-read/postgres-core.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const row = (n, parent = null, order = 0) => ({ id: id(n), parent_id: parent === null ? null : id(parent),
  slug: `cat-${n}`, status: "published", name_en: `Category ${n}`, name_zh: `分类 ${n}`,
  description_en: "Description", description_zh: "描述", sort_order: order,
  created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
const data = (rows, totalCount = rows.length, allCategories = true) => ({ rows, totalCount, allCategories });
const auth = (permission = true) => ({ session: "test", dependencies: {
  provider: { async verifySession() { return { identity_provider: "fixture", provider_subject: "test" }; } },
  directory: { async findByProviderIdentity() { return { admin_id: id(999),
    identity_provider: "fixture", provider_subject: "test", status: "active",
    created_at: "2026-10-01T00:00:00Z", disabled_at: null,
    permissions: permission ? ["catalog.read"] : [] }; } },
} });

test("complete set requires unfiltered source, count agreement and valid parents", () => {
  const rows = [row(1), row(2, 1), row(3, 2), row(4, 3)];
  const result = inspectAdminCategories(data(rows));
  assert.equal(result.state, "COMPLETE");
  assert.deepEqual(result.treeIds, rows.map((item) => item.id));
  assert.deepEqual(result.issues.map((issue) => issue.code), ["DEPTH_OVER_3"]);
  assert.equal(inspectAdminCategories(data(rows, 5)).state, "INCOMPLETE");
  assert.equal(inspectAdminCategories(data(rows, 4, false)).state, "INCOMPLETE");
  assert.equal(inspectAdminCategories(data([], 0)).state, "COMPLETE");
  assert.equal(inspectAdminCategories(data([], null)).state, "INCOMPLETE");
});

test("0, 499, 500, 501 and 800 categories preserve the 500-item display boundary", async () => {
  for (const size of [0, 499, 500, 501, 800]) {
    const rows = Array.from({ length: size }, (_, index) => row(index + 1, null, index));
    const source = createOfflineCatalogSource([], rows);
    const fetched = await source.listAdminCategories();
    const result = await createCatalogReadRepository(source, auth()).listAdminCategories();
    const visible = Math.min(size, 500);
    assert.equal(fetched.rows.length, Math.min(size, 501));
    assert.equal(fetched.totalCount, size);
    assert.equal(result.state, size <= 500 ? "COMPLETE" : "INCOMPLETE", `size=${size}`);
    assert.equal(result.items.length, visible, `DTO size=${size}`);
    assert.equal(result.treeIds.length, visible, `tree size=${size}`);
    assert.deepEqual(result.items.map((item) => item.id), rows.slice(0, visible).map((item) => item.id));
    assert.equal(new Set(result.treeIds).size, result.treeIds.length);
    if (size > 500) {
      assert.ok(result.issues.some((issue) => issue.code === "COUNT_MISMATCH"));
      assert.equal(result.items.some((item) => item.id === id(501)), false);
      assert.equal(result.treeIds.includes(id(501)), false);
    }
  }
});

test("a parent in the 501st probe row cannot make the visible tree complete", () => {
  const roots = Array.from({ length: 499 }, (_, index) => row(index + 1));
  const result = inspectAdminCategories(data([...roots, row(500, 501), row(501)]));
  assert.equal(result.state, "INCOMPLETE");
  assert.equal(result.items.length, 500);
  assert.equal(result.treeIds.length, 499);
  assert.equal(result.items.some((item) => item.id === id(501)), false);
  assert.equal(result.treeIds.includes(id(500)), false);
  assert.ok(result.issues.some((issue) => issue.code === "MISSING_PARENT" && issue.categoryId === id(500)));
  assert.ok(result.issues.some((issue) => issue.code === "COUNT_MISMATCH"));
  const malformed = inspectAdminCategories(data([...roots, { ...row(500), status: "invalid" }, row(501)]));
  assert.equal(malformed.state, "INCOMPLETE");
  assert.equal(malformed.items.length, 499);
  assert.equal(malformed.treeIds.length, 499);
  assert.ok(malformed.issues.some((issue) => issue.code === "INVALID_ROW" && issue.categoryId === id(500)));
  assert.ok(malformed.issues.some((issue) => issue.code === "COUNT_MISMATCH"));
});

test("stable ordering, missing parents, duplicates, cycles and unreachable nodes", () => {
  const ordered = inspectAdminCategories(data([row(2, null, 1), row(1, null, 1), row(3, null, 0)]));
  assert.deepEqual(ordered.items.map((item) => item.id), [id(3), id(1), id(2)]);
  for (const [rows, code] of [
    [[row(1, 99)], "MISSING_PARENT"],
    [[row(1), row(1)], "DUPLICATE_ID"],
    [[row(1, 2), row(2, 1)], "CYCLE"],
    [[row(1, 99), row(2, 1)], "UNREACHABLE"],
  ]) {
    const result = inspectAdminCategories(data(rows));
    assert.equal(result.state, "INCOMPLETE");
    assert.ok(result.issues.some((issue) => issue.code === code));
  }
});

test("safe DTO strips extra fields, malformed rows cannot become complete", async () => {
  const secret = { ...row(1), storage_key: "private/hidden.webp", database_password: "secret" };
  const source = createOfflineCatalogSource([], [secret]);
  const result = await createCatalogReadRepository(source, auth()).listAdminCategories();
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.origin, "OFFLINE_FIXTURE");
  assert.equal(JSON.stringify(result).includes("private/hidden"), false);
  assert.equal(JSON.stringify(result).includes("database_password"), false);
  assert.equal(inspectAdminCategories(data([{ ...row(1), status: "invalid" }])).state, "INCOMPLETE");
});

test("authorization precedes all source calls and failure states are distinct", async () => {
  let calls = 0;
  const base = createOfflineCatalogSource([], []);
  const source = { ...base, async listAdminCategories() { calls++; return data([row(1)]); } };
  await assert.rejects(createCatalogReadRepository(source, auth(false)).listAdminCategories(),
    (error) => error?.code === "FORBIDDEN");
  assert.equal(calls, 0);
  assert.equal((await createCatalogReadRepository(notConfiguredCatalogSource, auth()).listAdminCategories()).state,
    "NOT_CONNECTED");
  const failed = { ...base, async listAdminCategories() { throw Error("postgres://private.invalid"); } };
  const result = await createCatalogReadRepository(failed, auth()).listAdminCategories();
  assert.equal(result.state, "ERROR");
  assert.equal(JSON.stringify(result).includes("private.invalid"), false);
  const partial = await createCatalogReadRepository(createOfflineCatalogSource([]), auth()).listAdminCategories();
  assert.equal(partial.state, "INCOMPLETE");
});

test("PostgreSQL source uses private SELECT whitelist, bounded rows and count in one snapshot", async () => {
  const statements = [];
  let snapshots = 0;
  const source = createPostgresCatalogReadSource(async (work) => {
    snapshots++;
    return work({ async select(sql, values) {
      statements.push({ sql, values });
      return sql.includes("count(*)") ? [{ total_count: "1" }] : [row(1)];
    } });
  });
  const result = await source.listAdminCategories();
  assert.equal(snapshots, 1);
  assert.equal(result.totalCount, 1);
  assert.equal(result.allCategories, true);
  assert.equal(statements.length, 2);
  assert.match(statements[0].sql, /FROM catalog_private\.categories/);
  assert.match(statements[1].sql, /LIMIT \$1::integer/);
  assert.deepEqual(statements[1].values, [501]);
  for (const statement of statements) {
    assert.doesNotMatch(statement.sql, /INSERT|UPDATE|DELETE|catalog_public|storage_key|password/i);
  }
});
