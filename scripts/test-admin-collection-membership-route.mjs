import assert from "node:assert/strict";
import test from "node:test";
import { createCollectionMembershipCheckGET,
  membershipCheckMethodNotAllowed } from "../src/lib/admin/collection-membership-check-handler.ts";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const url = (query = `productId=${id(2)}`) =>
  `https://admin.example.test/api/admin/collections/${id(1)}/membership-check${query ? `?${query}` : ""}`;
const request = (query) => new Request(url(query));
const auth = (allowed = true) => ({ session: "test", dependencies: {
  provider: { async verifySession() { return { identity_provider: "fixture", provider_subject: "test" }; } },
  directory: { async findByProviderIdentity() { return { admin_id: id(999),
    identity_provider: "fixture", provider_subject: "test", status: "active",
    created_at: "2026-10-01T00:00:00.000Z", disabled_at: null,
    permissions: allowed ? ["catalog.read"] : [] }; } },
} });
const evidence = (overrides = {}) => ({ collectionId: id(1), productId: id(2),
  complete: true, collectionExists: true, productExists: true, membershipExists: false,
  ...overrides });
function fixture({ access = "allowed", mode = "offline", read = async () => evidence(),
  repositoryAllowed = true } = {}) {
  let sourceCalls = 0;
  let repositoryCalls = 0;
  const source = { ...notConfiguredCatalogSource, mode,
    async checkAdminCollectionMembership(collectionId, productId) {
      sourceCalls++;
      return read(collectionId, productId);
    } };
  const handler = createCollectionMembershipCheckGET({
    access: async () => access,
    repository: async () => {
      repositoryCalls++;
      return createCatalogReadRepository(source, auth(repositoryAllowed));
    },
  });
  return { handler, sourceCalls: () => sourceCalls, repositoryCalls: () => repositoryCalls };
}
async function body(response) {
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  return response.json();
}

test("authorized exact GET returns only whitelisted MEMBER and NOT_MEMBER DTO fields", async () => {
  const { handler, sourceCalls } = fixture({ read: async (_collectionId, productId) =>
    evidence({ productId, membershipExists: productId === id(2), storage_key: "private/fixture",
      database_password: "fixture-secret" }) });
  const member = await handler(request(), id(1));
  assert.equal(member.status, 200);
  assert.deepEqual(await body(member), { collectionId: id(1), productId: id(2),
    status: "MEMBER", origin: "OFFLINE_FIXTURE" });
  const nonmember = await handler(request(`productId=${id(3)}`), id(1));
  assert.equal(nonmember.status, 200);
  assert.deepEqual(await body(nonmember), { collectionId: id(1), productId: id(3),
    status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE" });
  assert.equal(sourceCalls(), 2);
});

test("NOT_CONNECTED, ERROR and INCOMPLETE remain distinct from NOT_MEMBER", async () => {
  for (const [options, expected] of [
    [{ mode: "not_configured" }, "NOT_CONNECTED"],
    [{ read: async () => { throw Error("private://database-secret"); } }, "ERROR"],
    [{ read: async () => evidence({ complete: false }) }, "INCOMPLETE"],
  ]) {
    const { handler } = fixture(options);
    const response = await handler(request(), id(1));
    assert.equal(response.status, 200);
    const result = await body(response);
    assert.equal(result.status, expected);
    assert.doesNotMatch(JSON.stringify(result), /private|secret|storage_key/);
  }
});

test("anonymous and forbidden requests do not construct a Repository or call its source", async () => {
  for (const [access, status, error] of [
    ["anonymous", 401, "UNAUTHORIZED"], ["forbidden", 403, "FORBIDDEN"],
  ]) {
    const state = fixture({ access });
    const response = await state.handler(request(), id(1));
    assert.equal(response.status, status);
    assert.deepEqual(await body(response), { error });
    assert.equal(state.repositoryCalls(), 0);
    assert.equal(state.sourceCalls(), 0);
  }
});

test("Repository second authorization can still forbid access with zero source calls", async () => {
  const state = fixture({ repositoryAllowed: false });
  const response = await state.handler(request(), id(1));
  assert.equal(response.status, 403);
  assert.deepEqual(await body(response), { error: "FORBIDDEN" });
  assert.equal(state.sourceCalls(), 0);
});

test("invalid UUIDs, missing or repeated productId and unknown keys never reach the source", async () => {
  const cases = [
    [request(), "invalid"], [request(`productId=invalid`), id(1)],
    [request(""), id(1)], [request("productId="), id(1)],
    [request(`productId=${id(2)}&productId=${id(3)}`), id(1)],
    [request(`productId=${id(2)}&cursor=anything`), id(1)],
    [request(`productId=${id(2)}&search=foo`), id(1)],
    [request(`productId=${id(2)}&unknown=x`), id(1)],
    [request(`productId=${id(2)}&%GG=x`), id(1)],
    [request(`productId=%E0%A4%A`), id(1)],
  ];
  const state = fixture();
  for (const [input, collectionId] of cases) {
    const response = await state.handler(input, collectionId);
    assert.equal(response.status, 400, input.url);
    assert.deepEqual(await body(response), { error: "INVALID_INPUT" });
  }
  assert.equal(state.repositoryCalls(), 0);
  assert.equal(state.sourceCalls(), 0);
});

test("unavailable authorization and Repository exceptions are sanitized and uncached", async () => {
  const noAccess = createCollectionMembershipCheckGET({
    access: async () => { throw Error("private://auth-secret"); },
    repository: async () => { throw Error("must not run"); },
  });
  const denied = await noAccess(request(), id(1));
  assert.equal(denied.status, 500);
  assert.deepEqual(await body(denied), { error: "UNAVAILABLE" });
  const broken = createCollectionMembershipCheckGET({
    access: async () => "allowed",
    repository: async () => { throw Error("private://repository-secret"); },
  });
  const failed = await broken(request(), id(1));
  assert.equal(failed.status, 500);
  assert.deepEqual(await body(failed), { error: "UNAVAILABLE" });
});

test("Route projection rejects mismatched identity and drops unexpected private DTO fields", async () => {
  const fake = (result) => createCollectionMembershipCheckGET({
    access: async () => "allowed",
    repository: async () => ({ checkAdminCollectionMembership: async () => result }),
  });
  const safe = await fake({ collectionId: id(1), productId: id(2), status: "MEMBER",
    origin: "OFFLINE_FIXTURE", storage_key: "private/object" })(request(), id(1));
  assert.deepEqual(await body(safe), { collectionId: id(1), productId: id(2),
    status: "MEMBER", origin: "OFFLINE_FIXTURE" });
  for (const result of [
    { collectionId: id(9), productId: id(2), status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE" },
    { collectionId: id(1), productId: id(2), status: "UNKNOWN", origin: "OFFLINE_FIXTURE" },
  ]) {
    const response = await fake(result)(request(), id(1));
    assert.equal(response.status, 500);
    assert.deepEqual(await body(response), { error: "UNAVAILABLE" });
  }
});

test("non-GET methods are rejected without a verification call and have no-store headers", async () => {
  const state = fixture();
  for (const method of ["HEAD", "OPTIONS", "POST", "PUT", "PATCH", "DELETE"]) {
    const response = membershipCheckMethodNotAllowed();
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("Allow"), "GET");
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  }
  assert.equal(state.repositoryCalls(), 0);
  assert.equal(state.sourceCalls(), 0);
});
