import assert from "node:assert/strict";
import test from "node:test";
import { candidateVerificationViewKey, isCurrentVerification,
  isFreshNotMemberVerification, readMembershipCheckResponse, verificationHasExpired,
  VERIFICATION_LIFETIME_MS } from
  "../src/lib/admin/collection-membership-verification.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const identity = { collectionId: id(1), productId: id(101), viewKey: "view-one",
  generation: 3, sequence: 7, checkedAtMs: 1000 };
const payload = { collectionId: id(1), productId: id(101), status: "NOT_MEMBER",
  origin: "OFFLINE_FIXTURE" };
const read = (body, time = 1001, code = 200) =>
  readMembershipCheckResponse(code, body, identity, time);

test("exact four-field GET DTO remains scoped to both UUIDs", () => {
  assert.deepEqual(read(payload), { ...identity, status: "NOT_MEMBER",
    origin: "OFFLINE_FIXTURE", expiresAtMs: 31000 });
  assert.equal(read({ ...payload, collectionId: id(2) }), null);
  assert.equal(read({ ...payload, productId: id(102) }), null);
  assert.equal(read({ ...payload, productId: "invalid" }), null);
  assert.equal(read({ ...payload, collectionId: id(1).toUpperCase() })?.status, "NOT_MEMBER");
});

test("all documented statuses are kept distinct; invalid status or origin fail closed", () => {
  for (const status of ["MEMBER", "NOT_MEMBER", "NOT_CONNECTED", "ERROR", "INCOMPLETE"])
    assert.equal(read({ ...payload, status })?.status, status);
  for (const status of ["UNKNOWN", "", false, null])
    assert.equal(read({ ...payload, status }), null);
  for (const origin of ["bogus", "", null, 1])
    assert.equal(read({ ...payload, origin }), null);
  assert.equal(read({ ...payload, origin: "NONE" }), null,
    "NONE cannot support a positive or negative membership fact");
  assert.equal(read({ ...payload, status: "NOT_CONNECTED", origin: "NONE" })?.status,
    "NOT_CONNECTED");
});

test("HTTP errors, non-DTO objects, missing and extra fields cannot verify membership", () => {
  for (const code of [201, 400, 401, 403, 500]) assert.equal(read(payload, 1001, code), null);
  for (const body of [null, [], "text", 0, { ...payload, extra: "secret" },
    { productId: id(101), status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE" },
    { ...payload, productId: undefined }]) assert.equal(read(body), null);
  let getterReads = 0;
  const accessor = { ...payload };
  Object.defineProperty(accessor, "status", { enumerable: true,
    get() { getterReads++; return "NOT_MEMBER"; } });
  assert.equal(read(accessor), null);
  assert.equal(getterReads, 0);
});

test("expiry uses request start and monotonic local time without extending a slow reply", () => {
  assert.equal(read(payload, 1000 + VERIFICATION_LIFETIME_MS - 1)?.status, "NOT_MEMBER");
  assert.equal(read(payload, 1000 + VERIFICATION_LIFETIME_MS), null);
  assert.equal(read(payload, 1000 + VERIFICATION_LIFETIME_MS + 1), null);
  assert.equal(read(payload, 999), null);
  assert.equal(read(payload, Number.NaN), null);
});

test("view key changes for query, page, source state and member page", () => {
  const query = { search: "", status: "all", cursor: null, direction: "after" };
  const result = { state: "RESULTS", items: [{ productId: id(101) }] };
  const key = candidateVerificationViewKey(id(1), query, result, false, "first:COMPLETE");
  for (const other of [
    candidateVerificationViewKey(id(2), query, result, false, "first:COMPLETE"),
    candidateVerificationViewKey(id(1), { ...query, search: "new" }, result, false, "first:COMPLETE"),
    candidateVerificationViewKey(id(1), { ...query, status: "draft" }, result, false, "first:COMPLETE"),
    candidateVerificationViewKey(id(1), { ...query, cursor: "signed" }, result, false, "first:COMPLETE"),
    candidateVerificationViewKey(id(1), query, { ...result, state: "ERROR" }, false, "first:COMPLETE"),
    candidateVerificationViewKey(id(1), query, result, true, "first:COMPLETE"),
    candidateVerificationViewKey(id(1), query, result, false, "next:COMPLETE"),
  ]) assert.notEqual(other, key);
});

test("request generation and sequence reject older product and view responses", () => {
  assert.equal(isCurrentVerification(identity, identity), true);
  for (const changed of [
    { productId: id(102) }, { collectionId: id(2) }, { viewKey: "view-two" },
    { generation: 4 }, { sequence: 8 },
  ]) assert.equal(isCurrentVerification(identity, { ...identity, ...changed }), false);
});

test("strict NOT_MEMBER freshness gate expires at the exact 30-second boundary", () => {
  const observation = read(payload);
  assert.ok(observation);
  const before = structuredClone(observation);
  assert.equal(isFreshNotMemberVerification(observation, identity, true, 30999), true);
  assert.equal(verificationHasExpired(observation, 30999), false);
  assert.equal(isFreshNotMemberVerification(observation, identity, true, 31000), false);
  assert.equal(verificationHasExpired(observation, 31000), true);
  assert.equal(isFreshNotMemberVerification(observation, identity, true, 31001), false);
  assert.equal(isFreshNotMemberVerification(observation, identity, true, 999), false);
  assert.equal(isFreshNotMemberVerification(observation, identity, true, Number.NaN), false);
  assert.deepEqual(observation, before, "freshness checks must not change their input");
});

test("strict gate rejects changed identity, generation, sequence, source and draft blockers", () => {
  const observation = read(payload);
  assert.ok(observation);
  for (const changed of [
    { collectionId: id(2) }, { productId: id(102) }, { viewKey: "other-view" },
    { generation: identity.generation + 1 }, { sequence: identity.sequence + 1 },
  ]) assert.equal(isFreshNotMemberVerification(observation,
    { ...identity, ...changed }, true, 1001), false);
  assert.equal(isFreshNotMemberVerification(observation, identity, false, 1001), false);
  assert.equal(isFreshNotMemberVerification(null, identity, true, 1001), false);
  for (const status of ["MEMBER", "ERROR", "NOT_CONNECTED", "INCOMPLETE"])
    assert.equal(isFreshNotMemberVerification({ ...observation, status }, identity, true, 1001), false);
  assert.equal(isFreshNotMemberVerification({ ...observation, origin: "NONE" }, identity, true, 1001), false);
  assert.equal(isFreshNotMemberVerification({ ...observation, expiresAtMs: 999999 },
    identity, true, 1001), false, "a client cannot extend the original lifetime");
});
