import assert from "node:assert/strict";
import test from "node:test";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const created = "2026-10-01T00:00:00.000Z";
const auth = (allowed = true) => ({ session: "test", dependencies: {
  provider: { async verifySession() { return { identity_provider: "fixture", provider_subject: "test" }; } },
  directory: { async findByProviderIdentity() { return { admin_id: id(999),
    identity_provider: "fixture", provider_subject: "test", status: "active",
    created_at: created, disabled_at: null, permissions: allowed ? ["catalog.read"] : [] }; } },
} });
const evidence = (overrides = {}) => ({ collectionId: id(1), productId: id(2),
  complete: true, collectionExists: true, productExists: true, membershipExists: false,
  ...overrides });
function changingEvidence(field, first, second) {
  const value = evidence();
  let reads = 0;
  Object.defineProperty(value, field, { enumerable: true, get() {
    reads++;
    return reads === 1 ? first : second;
  } });
  return { value, readCount: () => reads };
}
function fixture(read = async () => evidence(), mode = "offline") {
  const calls = [];
  const source = { ...notConfiguredCatalogSource, mode,
    async checkAdminCollectionMembership(collectionId, productId) {
      calls.push([collectionId, productId]);
      return read(collectionId, productId);
    } };
  return { calls, source };
}
const reader = (source, allowed = true) => createCatalogReadRepository(source, auth(allowed));
const invalid = (promise, code) => assert.rejects(promise, (error) => error?.code === code);

test("a complete exact pair distinguishes MEMBER from NOT_MEMBER without exposing rows", async () => {
  const { source, calls } = fixture(async (_collectionId, productId) =>
    evidence({ productId, membershipExists: productId === id(2),
      storage_key: "private/object", sort_order: 100, database_password: "secret" }));
  const repository = reader(source);
  const member = await repository.checkAdminCollectionMembership(id(1), id(2));
  const nonmember = await repository.checkAdminCollectionMembership(id(1), id(3));
  assert.deepEqual(member, { collectionId: id(1), productId: id(2),
    status: "MEMBER", origin: "OFFLINE_FIXTURE" });
  assert.deepEqual(nonmember, { collectionId: id(1), productId: id(3),
    status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE" });
  assert.deepEqual(calls, [[id(1), id(2)], [id(1), id(3)]]);
  assert.deepEqual(Object.keys(nonmember).sort(),
    ["collectionId", "productId", "status", "origin"].sort());
  assert.doesNotMatch(JSON.stringify([member, nonmember]), /storage_key|private\/|password|sort_order/);
});

test("authorization runs before validation and no unauthorized request reaches the source", async () => {
  const { source, calls } = fixture();
  await invalid(reader(source, false).checkAdminCollectionMembership("bad", id(2)), "FORBIDDEN");
  await invalid(createCatalogReadRepository(source).checkAdminCollectionMembership(id(1), id(2)), "FORBIDDEN");
  assert.deepEqual(calls, []);
});

test("invalid collection or product UUID never reaches the source", async () => {
  const { source, calls } = fixture();
  for (const pair of [["bad", id(2)], [id(1), "bad"], [null, id(2)], [id(1), 23]])
    await invalid(reader(source).checkAdminCollectionMembership(...pair), "INVALID_INPUT");
  assert.deepEqual(calls, []);
});

test("UUIDs are normalized before source use and matching is case insensitive", async () => {
  const upperCollection = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
  const upperProduct = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";
  const { source, calls } = fixture(async (collectionId, productId) =>
    evidence({ collectionId: collectionId.toUpperCase(), productId: productId.toUpperCase() }));
  const result = await reader(source).checkAdminCollectionMembership(upperCollection, upperProduct);
  assert.equal(result.status, "NOT_MEMBER");
  assert.equal(result.collectionId, upperCollection.toLowerCase());
  assert.equal(result.productId, upperProduct.toLowerCase());
  assert.deepEqual(calls, [[upperCollection.toLowerCase(), upperProduct.toLowerCase()]]);
});

test("unconfigured mode and absent source method stay NOT_CONNECTED", async () => {
  const unconfigured = fixture(async () => { throw Error("must not run"); }, "not_configured");
  assert.equal((await reader(unconfigured.source).checkAdminCollectionMembership(id(1), id(2))).status,
    "NOT_CONNECTED");
  assert.deepEqual(unconfigured.calls, []);
  const absent = { ...notConfiguredCatalogSource, mode: "read_only" };
  assert.deepEqual(await reader(absent).checkAdminCollectionMembership(id(1), id(2)),
    { collectionId: id(1), productId: id(2), status: "NOT_CONNECTED", origin: "NONE" });
  assert.equal((await reader(notConfiguredCatalogSource)
    .checkAdminCollectionMembership(id(1), id(2))).status, "NOT_CONNECTED");
});

test("source failures are ERROR and never expose the internal exception", async () => {
  const { source } = fixture(async () => { throw Error("private://database-password"); });
  const result = await reader(source).checkAdminCollectionMembership(id(1), id(2));
  assert.equal(result.status, "ERROR");
  assert.equal(result.origin, "NONE");
  assert.doesNotMatch(JSON.stringify(result), /private|password/);
  const malformed = fixture(async () => ({ get collectionId() {
    throw Error("private://evidence-secret");
  } }));
  const malformedResult = await reader(malformed.source).checkAdminCollectionMembership(id(1), id(2));
  assert.equal(malformedResult.status, "ERROR");
  assert.doesNotMatch(JSON.stringify(malformedResult), /private|secret/);
});

test("missing endpoints, mismatched identities and incomplete reads cannot prove NOT_MEMBER", async () => {
  const cases = [
    evidence({ collectionExists: false }), evidence({ productExists: false }),
    evidence({ collectionExists: false, membershipExists: true }),
    evidence({ productExists: false, membershipExists: true }),
    evidence({ collectionId: id(9) }), evidence({ productId: id(9) }),
    evidence({ collectionId: "bad" }), evidence({ productId: "bad" }),
    evidence({ complete: false }),
  ];
  for (const value of cases) {
    const { source } = fixture(async () => value);
    const result = await reader(source).checkAdminCollectionMembership(id(1), id(2));
    assert.equal(result.status, "INCOMPLETE", JSON.stringify(value));
  }
});

test("missing evidence and non-boolean values cannot produce MEMBER or NOT_MEMBER", async () => {
  const cases = [null, [], {}, { membershipExists: false },
    ...["complete", "collectionExists", "productExists", "membershipExists"].map((field) => {
      const value = evidence();
      delete value[field];
      return value;
    }),
    ...["collectionExists", "productExists", "membershipExists"].map((field) =>
      evidence({ [field]: "false" })),
    evidence({ complete: "true" }),
  ];
  for (const value of cases) {
    const { source } = fixture(async () => value);
    assert.equal((await reader(source).checkAdminCollectionMembership(id(1), id(2))).status,
      "INCOMPLETE", JSON.stringify(value));
  }
});

test("a bare membershipExists=false does not prove both endpoints exist", async () => {
  const { source } = fixture(async () => ({ membershipExists: false }));
  assert.equal((await reader(source).checkAdminCollectionMembership(id(1), id(2))).status,
    "INCOMPLETE");
});

test("membershipExists is read once: true then false cannot produce NOT_MEMBER", async () => {
  const changing = changingEvidence("membershipExists", true, false);
  const { source } = fixture(async () => changing.value);
  assert.equal((await reader(source).checkAdminCollectionMembership(id(1), id(2))).status, "MEMBER");
  assert.equal(changing.readCount(), 1);
});

test("membershipExists is read once: false then true uses the captured false", async () => {
  const changing = changingEvidence("membershipExists", false, true);
  const { source } = fixture(async () => changing.value);
  assert.equal((await reader(source).checkAdminCollectionMembership(id(1), id(2))).status, "NOT_MEMBER");
  assert.equal(changing.readCount(), 1);
});

test("complete and both endpoint flags are each read once", async () => {
  for (const field of ["complete", "collectionExists", "productExists"]) {
    for (const [first, second, expected] of [
      [false, true, "INCOMPLETE"], [true, false, "NOT_MEMBER"],
    ]) {
      const changing = changingEvidence(field, first, second);
      const { source } = fixture(async () => changing.value);
      assert.equal((await reader(source).checkAdminCollectionMembership(id(1), id(2))).status,
        expected, `${field}: ${first} then ${second}`);
      assert.equal(changing.readCount(), 1, field);
    }
  }
});

test("both echoed UUIDs are each read once and a wrong first identity is rejected", async () => {
  for (const [field, correct] of [["collectionId", id(1)], ["productId", id(2)]]) {
    const changing = changingEvidence(field, id(9), correct);
    const { source } = fixture(async () => changing.value);
    assert.equal((await reader(source).checkAdminCollectionMembership(id(1), id(2))).status,
      "INCOMPLETE", field);
    assert.equal(changing.readCount(), 1, field);
  }
});

test("a throwing evidence getter is sanitized and cannot prove absence", async () => {
  for (const field of ["collectionId", "membershipExists"]) {
    const value = evidence();
    let reads = 0;
    Object.defineProperty(value, field, { get() {
      reads++;
      throw Error("private://evidence-secret");
    } });
    const { source } = fixture(async () => value);
    const result = await reader(source).checkAdminCollectionMembership(id(1), id(2));
    assert.equal(result.status, "ERROR");
    assert.equal(reads, 1);
    assert.doesNotMatch(JSON.stringify(result), /private|secret/);
  }
});

test("frozen scalar evidence still supports MEMBER, NOT_MEMBER and INCOMPLETE", async () => {
  for (const [value, expected] of [
    [evidence({ membershipExists: true }), "MEMBER"],
    [evidence({ membershipExists: false }), "NOT_MEMBER"],
    [evidence({ complete: false }), "INCOMPLETE"],
  ]) {
    const { source } = fixture(async () => Object.freeze(value));
    assert.equal((await reader(source).checkAdminCollectionMembership(id(1), id(2))).status,
      expected);
  }
});
