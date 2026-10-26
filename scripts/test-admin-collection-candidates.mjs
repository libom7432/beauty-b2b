import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { createAdminCursorCodec } from "../src/lib/catalog-read/admin-cursor.ts";
import { createCatalogReadRepository } from "../src/lib/catalog-read/repository-core.ts";
import { createOfflineCatalogSource, notConfiguredCatalogSource } from "../src/lib/catalog-read/offline.ts";
import { CatalogReadError } from "../src/lib/catalog-read/errors.ts";
import { candidateHref, candidateQueryParams, loadCandidateProducts,
  parseCandidateQuery, candidateQueryError, invalidCandidateResult } from "../src/lib/admin/collection-candidate-search.ts";
import { classifyCollectionDetailParams, clearUnsupportedCollectionParamsHref,
  collectionMemberHref, parseCollectionMemberQuery,
  rawUrlEntries } from "../src/lib/admin/collection-detail-query.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const date = "2026-10-01T00:00:00.000Z";
const codec = createAdminCursorCodec(randomBytes(32).toString("base64url"));
const auth = (allowed = true) => ({ session: "test", dependencies: {
  provider: { async verifySession() { return { identity_provider: "fixture", provider_subject: "test" }; } },
  directory: { async findByProviderIdentity() { return { admin_id: id(999),
    identity_provider: "fixture", provider_subject: "test", status: "active",
    created_at: date, disabled_at: null, permissions: allowed ? ["catalog.read"] : [] }; } },
} });
function product(n) {
  const productId = id(n);
  return { product: { id: productId, product_code: `FAMILY-${n}`, slug: `family-${n}`,
    product_type: "press-on", status: n % 3 === 0 ? "draft" : n % 3 === 1 ? "published" : "retired",
    attributes: {}, customization_options: [], oem: false, odm: false,
    lead_time_min_days: null, lead_time_max_days: null, seo_indexable: false,
    featured: false, new_arrival: false, published_at: null, created_at: date, updated_at: date },
    translations: [{ product_id: productId, locale: "en", name: `Candidate ${n}`,
      short_description: "", description: "", seo_title: "", seo_description: "",
      created_at: date, updated_at: date },
      { product_id: productId, locale: "zh", name: `候选 ${n}`,
        short_description: "", description: "", seo_title: "", seo_description: "",
        created_at: date, updated_at: date }],
    variants: [], categoryLinks: [], categories: [], images: [] };
}
const source = createOfflineCatalogSource(Array.from({ length: 45 }, (_, index) => product(index + 101)));
const repo = createCatalogReadRepository(source, auth(), codec);
const query = (raw = {}) => parseCandidateQuery(raw);

test("candidate and member URL parameters stay independent", () => {
  const candidate = query({ candidate_q: " 候选 ", candidate_status: "draft",
    cursor: "a.b" });
  assert.equal(candidate.search, "候选");
  assert.equal(parseCollectionMemberQuery({ candidate_q: "候选", candidate_status: "draft" }).cursor, undefined);
  assert.deepEqual(candidateQueryParams(candidate), { candidate_q: "候选", candidate_status: "draft" });
  const href = candidateHref(id(1), { cursor: "member.signed", direction: "before" }, candidate);
  assert.match(href, /candidate_q=/);
  assert.match(href, /cursor=member.signed/);
  assert.match(collectionMemberHref(id(1), "member.next", "after", candidateQueryParams(candidate)), /candidate_status=draft/);
  assert.deepEqual(query(), { search: "", status: "all", cursor: null, direction: "after" });
  for (const raw of [{ candidate_q: ["a", "b"] }, { candidate_status: "invalid" },
    { candidate_q: "x".repeat(101) }, { candidate_direction: "before" },
    { candidate_cursor: "bad" }])
    assert.throws(() => query(raw), (error) => error.code === "INVALID_INPUT");
});

test("raw invalid cursors survive unrelated navigation and each recovery changes only its own group", () => {
  const raw = { cursor: "bad", candidate_cursor: "bad", candidate_q: "old", candidate_status: "draft" };
  assert.throws(() => parseCollectionMemberQuery(raw), (error) => error.code === "INVALID_INPUT");
  assert.equal(candidateQueryError(raw), "INVALID_CURSOR");
  const memberRaw = rawUrlEntries(raw, "member");
  const candidateRaw = rawUrlEntries(raw, "candidate");
  const candidate = { search: "new", status: "draft", cursor: null, direction: "after" };
  const candidateSearch = new URL(candidateHref(id(1), {}, candidate, memberRaw), "https://example.invalid");
  assert.equal(candidateSearch.searchParams.get("cursor"), "bad");
  assert.equal(candidateSearch.searchParams.get("candidate_q"), "new");
  assert.equal(candidateSearch.searchParams.has("candidate_cursor"), false);
  const memberNext = new URL(collectionMemberHref(id(1), "valid.member", "after", candidateRaw), "https://example.invalid");
  assert.equal(memberNext.searchParams.get("candidate_cursor"), "bad");
  assert.equal(memberNext.searchParams.get("cursor"), "valid.member");
  const memberRecovery = new URL(collectionMemberHref(id(1), null, "after", candidateRaw), "https://example.invalid");
  assert.equal(memberRecovery.searchParams.has("cursor"), false);
  assert.equal(memberRecovery.searchParams.get("candidate_cursor"), "bad");
  const candidateRecovery = new URL(candidateHref(id(1), {},
    { ...candidate, search: "old" }, memberRaw), "https://example.invalid");
  assert.equal(candidateRecovery.searchParams.get("cursor"), "bad");
  assert.equal(candidateRecovery.searchParams.has("candidate_cursor"), false);
});

test("query errors take priority over cursor errors; duplicate and unknown params remain invalid", () => {
  for (const raw of [{ candidate_status: "bogus", candidate_cursor: "a.b" },
    { candidate_q: ["one", "two"], candidate_cursor: "bad" },
    { candidate_q: "\u0000", candidate_cursor: "bad" },
    { unexpected: "x", candidate_cursor: "bad" }]) {
    assert.equal(candidateQueryError(raw), "INVALID_QUERY");
    assert.equal(invalidCandidateResult(raw).state, "INVALID_QUERY");
    assert.throws(() => parseCandidateQuery(raw), (error) => error.code === "INVALID_INPUT");
  }
  for (const raw of [{ candidate_cursor: "bad" }, { candidate_cursor: ["a.b", "c.d"] },
    { candidate_direction: "before" }])
    assert.equal(candidateQueryError(raw), "INVALID_CURSOR");
  const repeated = { cursor: ["bad", "other"], candidate_q: ["one", "two"], surprise: "kept" };
  assert.deepEqual(rawUrlEntries(repeated, "member"),
    [["cursor", "bad"], ["cursor", "other"], ["surprise", "kept"]]);
  assert.deepEqual(rawUrlEntries(repeated, "candidate"),
    [["candidate_q", "one"], ["candidate_q", "two"], ["surprise", "kept"]]);
  assert.throws(() => parseCollectionMemberQuery(repeated), (error) => error.code === "INVALID_INPUT");
  const href = new URL(collectionMemberHref(id(1), "signed.member", "after",
    rawUrlEntries(repeated, "candidate")), "https://example.invalid");
  assert.deepEqual(href.searchParams.getAll("candidate_q"), ["one", "two"]);
  assert.equal(href.searchParams.get("surprise"), "kept");
  assert.equal(href.searchParams.get("cursor"), "signed.member");
});

test("unsupported URL keys are separate from known invalid or repeated fields", () => {
  const raw = { unexpected: ["x", "y"], other: "", cursor: "bad",
    candidate_cursor: "bad", candidate_q: ["one", "two"], candidate_status: "bogus" };
  const classified = classifyCollectionDetailParams(raw);
  assert.deepEqual(classified.unsupported, ["unexpected", "other"]);
  assert.deepEqual(classified.known, { cursor: "bad", candidate_cursor: "bad",
    candidate_q: ["one", "two"], candidate_status: "bogus" });
  assert.throws(() => parseCollectionMemberQuery(classified.known), (error) => error.code === "INVALID_INPUT");
  assert.equal(candidateQueryError(classified.known), "INVALID_QUERY");
  const cleared = new URL(clearUnsupportedCollectionParamsHref(id(1), raw), "https://example.invalid");
  assert.deepEqual(cleared.searchParams.getAll("candidate_q"), ["one", "two"]);
  assert.equal(cleared.searchParams.get("cursor"), "bad");
  assert.equal(cleared.searchParams.get("candidate_cursor"), "bad");
  assert.equal(cleared.searchParams.get("candidate_status"), "bogus");
  assert.equal(cleared.searchParams.has("unexpected"), false);
  assert.equal(cleared.searchParams.has("other"), false);
  assert.equal(clearUnsupportedCollectionParamsHref(id(1), { surprise: "x" }),
    `/admin/collections/${id(1)}`);
  assert.deepEqual(classifyCollectionDetailParams({ candidate_q: "", cursor: "", candidate_status: "", direction: "" }).unsupported, []);
  const unknown = { unexpected: "x", cursor: "bad", candidate_cursor: "bad" };
  const candidateSearch = new URL(candidateHref(id(1), {},
    { search: "new", status: "all", cursor: null, direction: "after" },
    rawUrlEntries(unknown, "member")), "https://example.invalid");
  assert.equal(candidateSearch.searchParams.get("unexpected"), "x");
  assert.equal(candidateSearch.searchParams.get("cursor"), "bad");
  const memberRecovery = new URL(collectionMemberHref(id(1), null, "after",
    rawUrlEntries(unknown, "candidate")), "https://example.invalid");
  assert.equal(memberRecovery.searchParams.get("unexpected"), "x");
  assert.equal(memberRecovery.searchParams.get("candidate_cursor"), "bad");
});

test("authorized bounded search matches code, English and Chinese without inventing language labels", async () => {
  for (const term of ["FAMILY-101", "Candidate 101", "候选 101"]) {
    const result = await loadCandidateProducts(repo, query({ candidate_q: term }));
    assert.equal(result.state, "RESULTS");
    assert.equal(result.items[0].productId, id(101));
    assert.equal(result.items[0].displayName, "Candidate 101");
    assert.deepEqual(Object.keys(result.items[0]).sort(), ["displayName", "productCode", "productId", "status"]);
  }
  const filtered = await loadCandidateProducts(repo, query({ candidate_status: "draft" }));
  assert.equal(filtered.state, "RESULTS");
  assert.ok(filtered.items.every((item) => item.status === "draft"));
  assert.equal((await loadCandidateProducts(repo, query({ candidate_q: "no-match" }))).state, "EMPTY");
});

test("signed cursor pages are bounded and reject tampering or changed search", async () => {
  const first = await loadCandidateProducts(repo, query());
  assert.equal(first.items.length, 20);
  assert.ok(first.nextCursor);
  const second = await loadCandidateProducts(repo, query({ candidate_cursor: first.nextCursor }));
  assert.equal(second.items.length, 20);
  assert.ok(second.previousCursor);
  assert.notEqual(first.items[0].productId, second.items[0].productId);
  const previous = await loadCandidateProducts(repo,
    query({ candidate_cursor: second.previousCursor, candidate_direction: "before" }));
  assert.deepEqual(previous.items.map((item) => item.productId), first.items.map((item) => item.productId));
  assert.equal((await loadCandidateProducts(repo, query({ candidate_cursor: `${first.nextCursor}x` }))).state,
    "INVALID_CURSOR");
  assert.equal((await loadCandidateProducts(repo,
    query({ candidate_cursor: first.nextCursor, candidate_q: "Candidate" }))).state, "INVALID_CURSOR");
});

test("not connected, source error and inconsistent pages fail closed", async () => {
  const disconnected = createCatalogReadRepository(notConfiguredCatalogSource, auth(), codec);
  assert.equal((await loadCandidateProducts(disconnected, query())).state, "NOT_CONNECTED");
  assert.equal((await loadCandidateProducts({ async listAdminProducts() {
    throw new CatalogReadError("SOURCE_UNAVAILABLE"); } }, query())).state, "ERROR");
  const row = { id: id(1), productCode: "FAMILY-1", name: { state: "available", value: "Safe" },
    status: "draft", storageKey: "private/never-expose" };
  const invalid = await loadCandidateProducts({ async listAdminProducts() {
    return { items: [row, row], nextCursor: null };
  } }, query());
  assert.equal(invalid.state, "INCOMPLETE");
  assert.deepEqual(invalid.items, []);
  const safe = await loadCandidateProducts({ async listAdminProducts() {
    return { items: [row], nextCursor: null };
  } }, query());
  assert.equal(safe.state, "RESULTS");
  assert.ok(!JSON.stringify(safe).includes("storageKey"));
  assert.equal((await loadCandidateProducts({ async listAdminProducts() {
    return { items: [], nextCursor: "unexpected" };
  } }, query())).state, "INCOMPLETE");
});

test("unauthorized candidate requests never call the product source", async () => {
  let calls = 0;
  const tracked = { ...source, async listAdmin(sourceQuery) {
    calls++;
    return source.listAdmin(sourceQuery);
  } };
  const denied = createCatalogReadRepository(tracked, auth(false), codec);
  await assert.rejects(loadCandidateProducts(denied, query()), (error) => error.code === "FORBIDDEN");
  assert.equal(calls, 0);
});
