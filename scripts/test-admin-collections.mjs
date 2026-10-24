import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createCollectionCursorCodec, COLLECTION_CURSOR_MAX_LENGTH } from
  "../src/lib/catalog-read/collections-cursor.ts";
import { notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const date = "2026-10-01T00:00:00.000Z";
const created = "2026-09-01T00:00:00.000Z";
const collection = (n, status = "published", order = n) => ({ id: id(n), slug: `group-${n}`,
  name_en: `Group ${n}`, name_zh: `集合 ${n}`, description_en: "English description",
  description_zh: "中文描述", status, sort_order: order,
  published_at: status === "published" ? date : null, created_at: created, updated_at: date });
const member = (n, collectionId = id(1), status = "published", order = n) => ({
  collection_id: collectionId, product_id: id(n), sort_order: order,
  product_code: `编码/${n}`, name_en: `Product ${n}`, name_zh: `商品 ${n}`,
  product_status: status });
const auth = (permission = true) => ({ session: "test", dependencies: {
  provider: { async verifySession() { return { identity_provider: "fixture", provider_subject: "test" }; } },
  directory: { async findByProviderIdentity() { return { admin_id: id(999),
    identity_provider: "fixture", provider_subject: "test", status: "active",
    created_at: date, disabled_at: null, permissions: permission ? ["catalog.read"] : [] }; } },
} });
const codec = createCollectionCursorCodec(randomBytes(32).toString("base64url"));
const evidence = (rows, limit = 25, exhausted = rows.length < limit + 1) => ({
  requestedRowCount: limit + 1, returnedRowCount: rows.length, exhausted });
const compare = (a, b) => a.sort_order - b.sort_order ||
  (a.id ?? a.product_id).localeCompare(b.id ?? b.product_id);
function fixtureSource(collections = [collection(1)], members = [member(10)]) {
  const calls = { list: 0, detail: 0, members: 0 };
  const source = { ...notConfiguredCatalogSource, mode: "offline",
    async listAdminCollections(query) {
      calls.list++;
      const filtered = collections.filter((row) => !query.status || row.status === query.status);
      const current = query.boundary ? filtered.find((row) => row.id === query.boundary.id) : null;
      const rows = filtered
        .filter((row) => !query.boundary || (compare({ ...row, id: row.id },
          { sort_order: query.boundary.sortOrder, id: query.boundary.id }) *
          (query.direction === "before" ? -1 : 1)) >= (query.includeBoundary ? 0 : 1))
        .sort(compare);
      const windowRows = query.direction === "before" ? rows.slice(-query.limit - 1) : rows.slice(0, query.limit + 1);
      return { rows: windowRows, window: { requestedRowCount: query.limit + 1,
        returnedRowCount: windowRows.length, exhausted: windowRows.length < query.limit + 1 },
      boundary: current ? { id: current.id, sortOrder: current.sort_order } : null };
    },
    async getAdminCollectionById(collectionId) {
      calls.detail++;
      return { row: collections.find((row) => row.id === collectionId) ?? null, complete: true };
    },
    async listAdminCollectionMembers(query) {
      calls.members++;
      const filtered = members.filter((row) => row.collection_id === query.collectionId);
      const current = query.boundary ? filtered.find((row) => row.product_id === query.boundary.id) : null;
      const rows = filtered
        .filter((row) => !query.boundary || (compare(row,
          { sort_order: query.boundary.sortOrder, product_id: query.boundary.id }) *
          (query.direction === "before" ? -1 : 1)) >= (query.includeBoundary ? 0 : 1))
        .sort(compare);
      const windowRows = query.direction === "before" ? rows.slice(-query.limit - 1) : rows.slice(0, query.limit + 1);
      return { rows: windowRows, window: { requestedRowCount: query.limit + 1,
        returnedRowCount: windowRows.length, exhausted: windowRows.length < query.limit + 1 },
        boundary: current ? { id: current.product_id, sortOrder: current.sort_order } : null,
        collectionExists: collections.some((row) => row.id === query.collectionId) };
    },
  };
  return { source, calls };
}
const repo = (source, allowed = true) => createCatalogReadRepository(source, auth(allowed), null, codec);
const blocked = (promise, code) => assert.rejects(promise, (error) => error?.code === code);

test("catalog.read is checked before every Collections source call", async () => {
  const { source, calls } = fixtureSource();
  const denied = repo(source, false);
  await blocked(denied.listAdminCollections(), "FORBIDDEN");
  await blocked(denied.getAdminCollectionById(id(1)), "FORBIDDEN");
  await blocked(denied.listAdminCollectionMembers(id(1)), "FORBIDDEN");
  await blocked(createCatalogReadRepository(source, null, null, codec).listAdminCollections(), "FORBIDDEN");
  assert.deepEqual(calls, { list: 0, detail: 0, members: 0 });
});

test("default wiring is NOT_CONNECTED, failures are ERROR, missing detail is NOT_FOUND", async () => {
  const disconnected = repo(notConfiguredCatalogSource);
  assert.equal((await disconnected.listAdminCollections()).state, "NOT_CONNECTED");
  assert.equal((await disconnected.getAdminCollectionById(id(1))).state, "NOT_CONNECTED");
  assert.equal((await disconnected.listAdminCollectionMembers(id(1))).state, "NOT_CONNECTED");
  const { source } = fixtureSource();
  const failing = { ...source, async listAdminCollections() { throw Error("private database password"); },
    async getAdminCollectionById() { throw Error("private database password"); },
    async listAdminCollectionMembers() { throw Error("private database password"); } };
  for (const result of [await repo(failing).listAdminCollections(),
    await repo(failing).getAdminCollectionById(id(1)),
    await repo(failing).listAdminCollectionMembers(id(1))]) {
    assert.equal(result.state, "ERROR");
    assert.doesNotMatch(JSON.stringify(result), /password/);
  }
  assert.equal((await repo(source).getAdminCollectionById(id(9999))).state, "NOT_FOUND");
  assert.equal((await repo(source).listAdminCollectionMembers(id(9999))).state, "NOT_FOUND");
});

test("all three statuses are visible to Admin and DTOs are explicit allowlists", async () => {
  const secret = { ...collection(1), storage_key: "private/object", database_password: "secret" };
  const privateMember = { ...member(10), storage_key: "private/product", reference_price: "999" };
  const { source } = fixtureSource([secret, collection(2, "draft"), collection(3, "retired")], [privateMember]);
  const reader = repo(source);
  const list = await reader.listAdminCollections();
  assert.deepEqual(list.items.map((item) => item.status), ["published", "draft", "retired"]);
  assert.equal(list.state, "COMPLETE");
  assert.equal(list.origin, "OFFLINE_FIXTURE");
  assert.equal(Object.hasOwn(list.items[0], "descriptionEn"), false);
  assert.deepEqual(Object.keys(list.items[0]).sort(),
    ["id", "slug", "nameEn", "nameZh", "status", "sortOrder", "publishedAt", "updatedAt"].sort());
  const detail = await reader.getAdminCollectionById(id(1));
  assert.equal(detail.item.descriptionEn, "English description");
  assert.equal(detail.item.createdAt, created);
  assert.notEqual(detail.item.createdAt, detail.item.updatedAt);
  assert.deepEqual(Object.keys(detail.item).sort(),
    ["id", "slug", "nameEn", "nameZh", "descriptionEn", "descriptionZh", "status",
      "sortOrder", "publishedAt", "createdAt", "updatedAt"].sort());
  const members = await reader.listAdminCollectionMembers(id(1));
  assert.equal(members.items[0].productCode, "编码/10");
  assert.equal(members.items[0].productStatus, "published");
  assert.deepEqual(Object.keys(members.items[0]).sort(),
    ["productId", "productCode", "nameEn", "nameZh", "productStatus", "sortOrder"].sort());
  for (const result of [list, detail, members])
    assert.doesNotMatch(JSON.stringify(result), /storage_key|private\/|database_password|reference_price|secret/);
});

test("list defaults to 25, caps at 50, probes the next row and restores previous pages", async () => {
  const rows = Array.from({ length: 102 }, (_, index) => collection(index + 1, "published", 0));
  const { source, calls } = fixtureSource(rows);
  const reader = repo(source);
  const first = await reader.listAdminCollections();
  assert.equal(first.items.length, 25);
  assert.equal(first.items[0].id, id(1));
  assert.ok(first.nextCursor && first.nextCursor.length <= COLLECTION_CURSOR_MAX_LENGTH);
  assert.equal(first.previousCursor, null);
  const second = await reader.listAdminCollections({ cursor: first.nextCursor });
  assert.deepEqual(second.items.map((item) => item.id), rows.slice(25, 50).map((row) => row.id));
  assert.deepEqual((await reader.listAdminCollections({ cursor: first.nextCursor })).items, second.items,
    "replaying a cursor is deterministic and does not duplicate a page boundary");
  const back = await reader.listAdminCollections({ cursor: second.previousCursor, direction: "before" });
  assert.deepEqual(back.items, first.items);
  const wide = await reader.listAdminCollections({ limit: 50 });
  assert.equal(wide.items.length, 50);
  assert.ok(wide.nextCursor);
  await blocked(reader.listAdminCollections({ limit: 51 }), "INVALID_INPUT");
  await blocked(reader.listAdminCollections({ limit: 0 }), "INVALID_INPUT");
  assert.equal(calls.list, 5);
});

test("same sort_order uses UUID and empty terminal pages cannot loop", async () => {
  const rows = [collection(3, "draft", 0), collection(1, "published", 0),
    collection(2, "retired", 0)];
  const { source } = fixtureSource(rows);
  const reader = repo(source);
  const first = await reader.listAdminCollections({ limit: 1 });
  const second = await reader.listAdminCollections({ limit: 1, cursor: first.nextCursor });
  assert.equal(first.items[0].id, id(1));
  assert.equal(second.items[0].id, id(2));
  const terminal = await reader.listAdminCollections({ limit: 1, cursor: second.nextCursor });
  assert.equal(terminal.items[0].id, id(3));
  assert.equal(terminal.nextCursor, null);
  const empty = await reader.listAdminCollections({ limit: 1,
    cursor: codec.issue({ kind: "collections", status: null, collectionId: null,
      direction: "after" }, { sortOrder: 0, id: id(3) }) });
  assert.equal(empty.state, "EMPTY_PAGE");
  assert.deepEqual(empty.items, []);
  assert.equal(empty.nextCursor, null);
  assert.ok(empty.previousCursor);
  const recovered = await reader.listAdminCollections({ limit: 1,
    cursor: empty.previousCursor, direction: "before" });
  assert.equal(recovered.state, "COMPLETE");
  assert.equal(recovered.items[0].id, id(3));
  assert.equal(recovered.nextCursor, null);
});

test("signed cursors reject tampering, changed filters, directions and member scope before source call", async () => {
  const { source, calls } = fixtureSource([collection(1), collection(2)]);
  const reader = repo(source);
  const first = await reader.listAdminCollections({ limit: 1 });
  const cursor = first.nextCursor;
  const tampered = `${cursor.slice(0, -1)}${cursor.endsWith("A") ? "B" : "A"}`;
  await blocked(reader.listAdminCollections({ cursor: tampered }), "INVALID_INPUT");
  await blocked(reader.listAdminCollections({ cursor, status: "published" }), "INVALID_INPUT");
  await blocked(reader.listAdminCollections({ cursor, direction: "before" }), "INVALID_INPUT");
  await blocked(reader.listAdminCollectionMembers(id(1), { cursor }), "INVALID_INPUT");
  await blocked(reader.listAdminCollections({ cursor: "a".repeat(513) }), "INVALID_INPUT");
  assert.equal(calls.list, 1);
  assert.equal(calls.members, 0);
});

test("a deleted, re-sorted or filtered-out boundary cannot produce a COMPLETE page", async () => {
  const rows = [collection(1), collection(2), collection(3)];
  const { source } = fixtureSource(rows);
  const first = await repo(source).listAdminCollections({ limit: 1 });
  const cursor = first.nextCursor;
  for (const changed of [rows.slice(1), [{ ...rows[0], sort_order: 99 }, ...rows.slice(1)]]) {
    const candidate = fixtureSource(changed).source;
    const result = await repo(candidate).listAdminCollections({ limit: 1, cursor });
    assert.equal(result.state, "INCOMPLETE");
    assert.ok(result.issues.some((entry) => entry.code === "STALE_CURSOR"));
    assert.equal(result.nextCursor, null);
  }
  const filtered = fixtureSource([{ ...rows[0], status: "draft", published_at: null }, ...rows.slice(1)]).source;
  const publishedFirst = await repo(source).listAdminCollections({ limit: 1, status: "published" });
  const invalidated = await repo(filtered).listAdminCollections({ limit: 1,
    status: "published", cursor: publishedFirst.nextCursor });
  assert.equal(invalidated.state, "INCOMPLETE");
  assert.ok(invalidated.issues.some((entry) => entry.code === "STALE_CURSOR"));
});

test("source incompleteness, over-limit pages and anomalies never become COMPLETE", async () => {
  const base = fixtureSource();
  const cases = [
    [{ rows: [collection(1)], window: evidence([collection(1)], 25, false) }, "WINDOW_MISMATCH"],
    [{ rows: Array.from({ length: 27 }, (_, index) => collection(index + 1)),
      window: evidence(Array.from({ length: 27 }, (_, index) => collection(index + 1))) }, "OVER_LIMIT"],
    [{ rows: [collection(1), collection(1)], window: evidence([collection(1), collection(1)]) }, "DUPLICATE_ID"],
    [{ rows: [collection(2), collection(1)], window: evidence([collection(2), collection(1)]) }, "UNSORTED"],
    [{ rows: [{ ...collection(1), sort_order: 2.5 }],
      window: evidence([{ ...collection(1), sort_order: 2.5 }]) }, "INVALID_ROW"],
  ];
  for (const [page, expected] of cases) {
    const source = { ...base.source, async listAdminCollections() { return { ...page, boundary: null }; } };
    const result = await repo(source).listAdminCollections({ limit: 25 });
    assert.equal(result.state, "INCOMPLETE", expected);
    assert.ok(result.issues.some((entry) => entry.code === expected), expected);
    assert.equal(result.nextCursor, null);
    assert.ok(result.items.length <= 25);
  }
  const invalidSource = { ...base.source, async listAdminCollections() {
    return { rows: null, window: null, boundary: null }; } };
  assert.equal((await repo(invalidSource).listAdminCollections()).state, "ERROR");
});

test("window evidence rejects missing, contradictory and legacy boolean claims", async () => {
  const { source } = fixtureSource();
  const one = [collection(1)];
  const two = [collection(1), collection(2)];
  const cases = [
    [{ rows: one, window: evidence(one, 1, false) }, "WINDOW_MISMATCH"],
    [{ rows: two, window: evidence(two, 1, true) }, "WINDOW_MISMATCH"],
    [{ rows: one, window: { ...evidence(one, 1), requestedRowCount: 1 } }, "WINDOW_MISMATCH"],
    [{ rows: one, window: { ...evidence(one, 1), returnedRowCount: 2 } }, "WINDOW_MISMATCH"],
    [{ rows: one, window: { ...evidence(one, 1), exhausted: null } }, "MISSING_WINDOW_EVIDENCE"],
    [{ rows: one }, "MISSING_WINDOW_EVIDENCE"],
    [{ rows: one, complete: true }, "MISSING_WINDOW_EVIDENCE"],
  ];
  for (const [page, expected] of cases) {
    const result = await repo({ ...source, async listAdminCollections() {
      return { ...page, boundary: null }; } }).listAdminCollections({ limit: 1 });
    assert.equal(result.state, "INCOMPLETE", expected);
    assert.ok(result.issues.some((entry) => entry.code === expected), expected);
    assert.equal(result.nextCursor, null);
  }
});

test("the probe row is checked for order, duplicate identity and page cap", async () => {
  const { source } = fixtureSource();
  const cases = [
    [[collection(2), collection(1)], "UNSORTED"],
    [[collection(1), collection(1)], "DUPLICATE_ID"],
    [[collection(1), collection(2), collection(3)], "OVER_LIMIT"],
  ];
  for (const [rows, expected] of cases) {
    const result = await repo({ ...source, async listAdminCollections() {
      return { rows, window: evidence(rows, 1), boundary: null }; } })
      .listAdminCollections({ limit: 1 });
    assert.equal(result.state, "INCOMPLETE", expected);
    assert.ok(result.issues.some((entry) => entry.code === expected), expected);
    assert.equal(result.nextCursor, null);
  }
});

test("a consistent but false source attestation is impossible to disprove from returned rows", async () => {
  // The adapter hides collection(2) and falsely claims exhaustion. Only future SQL
  // implementation review and PostgreSQL tests can reject this dishonest behavior.
  const { source } = fixtureSource([collection(1), collection(2)]);
  const hidden = { ...source, async listAdminCollections() {
    const rows = [collection(1)];
    return { rows, window: evidence(rows, 1), boundary: null };
  } };
  const result = await repo(hidden).listAdminCollections({ limit: 1 });
  assert.equal(result.state, "COMPLETE");
  assert.equal(result.nextCursor, null);
});

test("empty before-cursor pages recover forward without a cursor loop", async () => {
  const { source } = fixtureSource([collection(1), collection(2), collection(3)]);
  const reader = repo(source);
  const empty = await reader.listAdminCollections({ limit: 1, direction: "before",
    cursor: codec.issue({ kind: "collections", status: null, collectionId: null,
      direction: "before" }, { sortOrder: 1, id: id(1) }) });
  assert.equal(empty.state, "EMPTY_PAGE");
  assert.equal(empty.previousCursor, null);
  assert.ok(empty.nextCursor);
  const recovered = await reader.listAdminCollections({ limit: 1, cursor: empty.nextCursor });
  assert.equal(recovered.state, "COMPLETE");
  assert.equal(recovered.items[0].id, id(1));
  assert.equal(recovered.previousCursor, null);
});

test("missing recovery anchor never becomes a normal empty first page", async () => {
  const { source } = fixtureSource([collection(1)]);
  const cursor = codec.issue({ kind: "collections", status: null, collectionId: null,
    direction: "before" }, { sortOrder: 1, id: id(1) }, true);
  const broken = { ...source, async listAdminCollections() {
    const rows = [];
    return { rows, window: evidence(rows, 1), boundary: { sortOrder: 1, id: id(1) } };
  } };
  const result = await repo(broken).listAdminCollections({ limit: 1, cursor, direction: "before" });
  assert.equal(result.state, "INCOMPLETE");
  assert.ok(result.issues.some((entry) => entry.code === "NAVIGATION_UNAVAILABLE"));
  assert.equal(result.previousCursor, null);
  assert.equal(result.nextCursor, null);
});

test("detail invalid source row, mismatch and incomplete read are reported", async () => {
  const { source } = fixtureSource();
  for (const [response, state, problem] of [
    [{ row: collection(2), complete: true }, "INCOMPLETE", "ID_MISMATCH"],
    [{ row: { ...collection(1), status: "other" }, complete: true }, "INCOMPLETE", "INVALID_ROW"],
    [{ row: null, complete: false }, "INCOMPLETE", "SOURCE_INCOMPLETE"],
  ]) {
    const result = await repo({ ...source, async getAdminCollectionById() { return response; } })
      .getAdminCollectionById(id(1));
    assert.equal(result.state, state);
    assert.equal(result.issues[0].code, problem);
  }
});

test("missing or invalid created_at cannot yield COMPLETE or a fabricated detail time", async () => {
  const missing = { ...collection(1) };
  delete missing.created_at;
  for (const row of [missing,
    { ...collection(1), created_at: null },
    { ...collection(1), created_at: "not-a-date" },
    { ...collection(1), created_at: "2026-02-30T00:00:00.000Z" },
    { ...collection(1), created_at: "2026-02-29T00:00:00.000Z" }]) {
    const reader = repo(fixtureSource([row]).source);
    const detail = await reader.getAdminCollectionById(id(1));
    assert.equal(detail.state, "INCOMPLETE");
    assert.equal(detail.item, null);
    assert.deepEqual(detail.issues.map((entry) => entry.code), ["INVALID_ROW"]);
    const list = await reader.listAdminCollections();
    assert.equal(list.state, "INCOMPLETE");
    assert.ok(list.issues.some((entry) => entry.code === "INVALID_ROW"));
  }
});

test("members are bounded, paged and unpublished products remain visible to Admin", async () => {
  const members = Array.from({ length: 61 }, (_, index) =>
    member(index + 10, id(1), index === 0 ? "draft" : "published", 0));
  const { source } = fixtureSource([collection(1)], members);
  const reader = repo(source);
  const first = await reader.listAdminCollectionMembers(id(1), { limit: 50 });
  assert.equal(first.state, "COMPLETE");
  assert.equal(first.items.length, 50);
  assert.equal(first.items[0].productStatus, "draft");
  assert.ok(first.nextCursor);
  const second = await reader.listAdminCollectionMembers(id(1), { limit: 50, cursor: first.nextCursor });
  assert.equal(second.items.length, 11);
  assert.equal(second.nextCursor, null);
  const previous = await reader.listAdminCollectionMembers(id(1),
    { limit: 50, cursor: second.previousCursor, direction: "before" });
  assert.deepEqual(previous.items, first.items);
  await blocked(reader.listAdminCollectionMembers(id(2), { cursor: first.nextCursor }), "INVALID_INPUT");
  await blocked(reader.listAdminCollectionMembers(id(1), { limit: 51 }), "INVALID_INPUT");
});

test("Repository rejects same-page duplicate member UUID before a COMPLETE result", async () => {
  for (const second of [member(10), { ...member(10), sort_order: 20 }]) {
    const { source } = fixtureSource([collection(1)], [member(10), second]);
    const result = await repo(source).listAdminCollectionMembers(id(1));
    assert.equal(result.state, "INCOMPLETE");
    assert.ok(result.issues.some((entry) => entry.code === "DUPLICATE_ID"));
  }
});

test("member empty page recovers the boundary product and missing evidence cannot prove absence", async () => {
  const { source } = fixtureSource([collection(1)], [member(10), member(11)]);
  const reader = repo(source);
  const empty = await reader.listAdminCollectionMembers(id(1), { limit: 1,
    cursor: codec.issue({ kind: "members", status: null, collectionId: id(1),
      direction: "after" }, { sortOrder: 11, id: id(11) }) });
  assert.equal(empty.state, "EMPTY_PAGE");
  assert.ok(empty.previousCursor);
  const recovered = await reader.listAdminCollectionMembers(id(1), { limit: 1,
    cursor: empty.previousCursor, direction: "before" });
  assert.equal(recovered.state, "COMPLETE");
  assert.equal(recovered.items[0].productId, id(11));
  assert.equal(recovered.nextCursor, null);
  const missing = { ...source, async listAdminCollectionMembers() {
    return { rows: [], boundary: null, collectionExists: false }; } };
  const result = await repo(missing).listAdminCollectionMembers(id(1));
  assert.equal(result.state, "INCOMPLETE");
  assert.ok(result.issues.some((entry) => entry.code === "MISSING_WINDOW_EVIDENCE"));
});

test("member cursor becomes INCOMPLETE when its association moves", async () => {
  const rows = [member(10), member(11), member(12)];
  const first = await repo(fixtureSource([collection(1)], rows).source)
    .listAdminCollectionMembers(id(1), { limit: 1 });
  const moved = fixtureSource([collection(1)], [{ ...rows[0], sort_order: 99 }, ...rows.slice(1)]).source;
  const result = await repo(moved).listAdminCollectionMembers(id(1),
    { limit: 1, cursor: first.nextCursor });
  assert.equal(result.state, "INCOMPLETE");
  assert.ok(result.issues.some((entry) => entry.code === "STALE_CURSOR"));
  assert.equal(result.nextCursor, null);
});

test("missing member product and wrong collection association are explicit", async () => {
  const { source } = fixtureSource([collection(1)], [
    { ...member(10), product_code: null, name_en: null, name_zh: null, product_status: null },
    { ...member(11), collection_id: id(2) },
  ]);
  const missing = await repo(source).listAdminCollectionMembers(id(1));
  assert.equal(missing.state, "INCOMPLETE");
  assert.ok(missing.issues.some((entry) => entry.code === "MISSING_PRODUCT"));
  const wrong = await repo({ ...source, async listAdminCollectionMembers() {
    return { rows: [member(11, id(2))], complete: true, boundary: null, collectionExists: true }; } })
    .listAdminCollectionMembers(id(1));
  assert.equal(wrong.state, "INCOMPLETE");
  assert.ok(wrong.issues.some((entry) => entry.code === "ID_MISMATCH"));
  const over = await repo({ ...source, async listAdminCollectionMembers() {
    return { rows: Array.from({ length: 27 }, (_, index) => member(index + 10)),
      complete: true, boundary: null, collectionExists: true }; } }).listAdminCollectionMembers(id(1));
  assert.equal(over.state, "INCOMPLETE");
  assert.ok(over.issues.some((entry) => entry.code === "OVER_LIMIT"));
  assert.equal(over.items.length, 25);
});
