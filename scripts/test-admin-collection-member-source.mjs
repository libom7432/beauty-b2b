import assert from "node:assert/strict";
import test from "node:test";
import { createCollectionMemberSourceGET } from
  "../src/lib/admin/collection-member-source-handler.ts";

const id = "00000001-0000-4000-8000-000000000000";
const detail = { state: "COMPLETE", origin: "OFFLINE_FIXTURE", issues: [],
  item: { id, slug: "one", nameEn: "One", nameZh: "一", descriptionEn: "",
    descriptionZh: "", status: "draft", sortOrder: 0, publishedAt: null,
    createdAt: "2026-10-01", updatedAt: "2026-10-01" } };
const members = { state: "COMPLETE", origin: "OFFLINE_FIXTURE", issues: [], items: [],
  nextCursor: null, previousCursor: null };
const request = (suffix = "") => new Request(`http://localhost/api/admin/collections/${id}/member-source${suffix}`);

test("authorized member source returns only the requested detail and member page uncached", async () => {
  let received;
  const handler = createCollectionMemberSourceGET({ access: async () => "allowed",
    repository: async () => ({ getAdminCollectionById: async () => detail,
      listAdminCollectionMembers: async (collectionId, query) => {
        received = { collectionId, query }; return members;
      } }) });
  const response = await handler(request(), id);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("Cache-Control"), /private.*no-store/);
  assert.deepEqual(await response.json(), { collectionId: id, pageKey: "first", detail, members });
  assert.deepEqual(received, { collectionId: id, query: {} });
  const cursor = "YWJj.ZGVm";
  const next = await handler(request(`?cursor=${cursor}&direction=before`), id);
  assert.equal(next.status, 200);
  assert.equal((await next.json()).pageKey, `before:${cursor}`);
  assert.deepEqual(received.query, { cursor, direction: "before" });
});

test("member source enforces current catalog authorization before repository access", async () => {
  let calls = 0;
  for (const [access, status] of [["anonymous", 401], ["forbidden", 403]]) {
    const handler = createCollectionMemberSourceGET({ access: async () => access,
      repository: async () => { calls++; throw Error("must not read"); } });
    const response = await handler(request(), id);
    assert.equal(response.status, status);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
  assert.equal(calls, 0);
});

test("invalid or repeated cursor input is rejected without querying members", async () => {
  let calls = 0;
  const handler = createCollectionMemberSourceGET({ access: async () => "allowed",
    repository: async () => ({ getAdminCollectionById: async () => detail,
      listAdminCollectionMembers: async () => { calls++; return members; } }) });
  for (const suffix of ["?cursor=a.b&cursor=c.d", "?direction=before", "?cursor=a.b&extra=1",
    "?cursor=bad", "?cursor=a.b&direction=sideways"]) {
    const response = await handler(request(suffix), id);
    assert.equal(response.status, 400, suffix);
    assert.match(response.headers.get("Cache-Control"), /no-store/);
  }
  assert.equal(calls, 0);
});

test("failed detail cannot become a complete member source", async () => {
  let memberCalls = 0;
  const unavailable = { state: "NOT_CONNECTED", item: null, issues: [], origin: "NONE" };
  const handler = createCollectionMemberSourceGET({ access: async () => "allowed",
    repository: async () => ({ getAdminCollectionById: async () => unavailable,
      listAdminCollectionMembers: async () => { memberCalls++; return members; } }) });
  const response = await handler(request(), id);
  assert.deepEqual(await response.json(), { collectionId: id, pageKey: "first",
    detail: unavailable, members: null });
  assert.equal(memberCalls, 0);
});
