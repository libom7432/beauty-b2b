import assert from "node:assert/strict";
import test from "node:test";
import { addProposedMember, cancelProposedMember, changeProposedMemberOrder,
  createMembershipDraft, discardMembershipDraft, ingestMembershipPage,
  markMembershipRemoved, changeMembershipOrder, membershipIsDirty,
  sortedMembershipEntries, sortedProposedMembers, validateMembershipDraft,
  MAX_LOADED_MEMBERS, MembershipDraftSnapshotError
} from "../src/lib/admin/collection-membership-draft.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const collectionId = id(1);
const candidate = (n) => ({ productId: id(n), productCode: `P-${n}`,
  displayName: `Product ${n}`, status: "published" });
const member = (n, sortOrder = n) => ({ productId: id(n), productCode: `P-${n}`,
  nameEn: `Product ${n}`, nameZh: null, productStatus: "published", sortOrder });
const page = (items, state = "COMPLETE") => ({ state, items, issues: [],
  nextCursor: null, previousCursor: null, origin: "OFFLINE_FIXTURE" });
const context = (overrides = {}) => ({ collectionId, viewKey: "query:1", nowMs: 1000,
  sourceState: "COMPLETE", ...overrides });
const verification = (n, overrides = {}) => ({ collectionId, productId: id(n),
  status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE", viewKey: "query:1",
  checkedAtMs: 900, expiresAtMs: 2000, ...overrides });
const add = (draft, n, evidence = verification(n), scope = context()) =>
  addProposedMember(draft, candidate(n), evidence, scope);
const loaded = (numbers) => ingestMembershipPage(createMembershipDraft(collectionId), "first",
  page(numbers.map((n) => member(n))));
const changing = (object, field, first, second) => {
  let reads = 0;
  Object.defineProperty(object, field, { enumerable: true, get() {
    reads++;
    return reads === 1 ? first : second;
  } });
  return () => reads;
};
const rejected = (draft, product, checked, scope = context()) => {
  const before = structuredClone(draft);
  const result = addProposedMember(draft, product, checked, scope);
  assert.notEqual(result, draft, "rejection returns an independent starting draft");
  assert.deepEqual(result, before, "rejection preserves the starting draft");
  return result;
};
const rejectAdd = (draft, n, checked = verification(n), scope = context()) =>
  rejected(draft, candidate(n), checked, scope);

test("exact NOT_MEMBER observation adds only safe scalars, normalized identity and local proof tag", () => {
  const draft = add(createMembershipDraft(collectionId), 10,
    verification(10, { productId: id(10).toUpperCase() }));
  assert.equal(membershipIsDirty(draft), true);
  assert.deepEqual(Object.keys(draft.proposedAdds), [id(10)]);
  assert.deepEqual(draft.proposedAdds[id(10)], {
    productId: id(10), productCode: "P-10", displayName: "Product 10",
    productStatus: "published", sortOrderText: "0",
    verificationAtAdd: { collectionId, productId: id(10), origin: "OFFLINE_FIXTURE",
      checkedAtMs: 900, viewKey: "query:1" },
  });
  assert.equal(draft.entries[id(10)], undefined);
  assert.equal(validateMembershipDraft(draft).overallState, "NOT_VERIFIED");
});

test("non-NOT_MEMBER and untrusted or stale evidence rejects without changing draft", () => {
  const original = add(createMembershipDraft(collectionId), 11);
  const rejects = [
    [verification(10, { status: "MEMBER" }), context()],
    [verification(10, { status: "NOT_CONNECTED" }), context()],
    [verification(10, { status: "ERROR" }), context()],
    [verification(10, { status: "INCOMPLETE" }), context()],
    [verification(10, { origin: "NONE" }), context()],
    [verification(10, { collectionId: id(2) }), context()],
    [verification(10, { productId: id(12) }), context()],
    [verification(10), context({ collectionId: id(2) })],
    [verification(10), context({ viewKey: "query:2" })],
    [verification(10, { expiresAtMs: 1000 }), context()],
    [verification(10, { checkedAtMs: 1001 }), context()],
    [verification(10, { expiresAtMs: 30901 }), context()],
    [verification(10), context({ nowMs: Infinity })],
    [verification(10), context({ sourceState: "ERROR" })],
    [verification(10), context({ sourceState: "INCOMPLETE" })],
    [verification(10), context({ sourceState: "NOT_CONNECTED" })],
  ];
  for (const [evidence, scope] of rejects)
    rejectAdd(original, 10, evidence, scope);
});

test("duplicate proposed and observed original, including removed original, cannot be added", () => {
  let draft = add(createMembershipDraft(collectionId), 10);
  rejectAdd(draft, 10);
  draft = loaded([10]);
  rejectAdd(draft, 10);
  draft = markMembershipRemoved(draft, id(10), true);
  rejectAdd(draft, 10);
  assert.equal(draft.entries[id(10)].removed, true);
});

test("invalid candidate scalars and UUID identities cannot enter the local map", () => {
  const original = add(createMembershipDraft(collectionId), 11);
  for (const unsafe of [
    { ...candidate(10), productId: "not-a-uuid" },
    { ...candidate(10), productCode: null },
    { ...candidate(10), displayName: 7 },
    { ...candidate(10), status: "unknown" },
  ]) rejected(original, unsafe, verification(10));
  assert.equal(Object.keys(original.proposedAdds).length, 1);
});

test("dynamic candidate and verification UUID accessors are rejected without execution", () => {
  const original = createMembershipDraft(collectionId);
  const product = candidate(10);
  const candidateReads = changing(product, "productId", id(10), "not-a-uuid");
  const checked = verification(10);
  const verificationReads = changing(checked, "productId", id(10), "not-a-uuid");
  const result = rejected(original, product, checked);
  assert.equal(candidateReads(), 0);
  assert.equal(verificationReads(), 0);
  assert.deepEqual(result.proposedAdds, {});
});

test("all identity, status, origin, time and display accessors are rejected before execution", () => {
  const original = createMembershipDraft(collectionId);
  const cases = [
    ["candidate", "productId", id(10), "not-a-uuid"],
    ["candidate", "productCode", "P-10", 7],
    ["candidate", "displayName", "Product 10", 7],
    ["candidate", "status", "published", "unknown"],
    ["verification", "collectionId", collectionId, id(2)],
    ["verification", "productId", id(10), "not-a-uuid"],
    ["verification", "status", "NOT_MEMBER", "ERROR"],
    ["verification", "origin", "OFFLINE_FIXTURE", "NONE"],
    ["verification", "viewKey", "query:1", "query:2"],
    ["verification", "checkedAtMs", 900, Infinity],
    ["verification", "expiresAtMs", 2000, 0],
    ["context", "collectionId", collectionId, id(2)],
    ["context", "viewKey", "query:1", "query:2"],
    ["context", "nowMs", 1000, Infinity],
    ["context", "sourceState", "COMPLETE", "ERROR"],
  ];
  for (const [target, field, first, second] of cases) {
    const product = candidate(10);
    const checked = verification(10);
    const scope = context();
    const input = target === "candidate" ? product : target === "verification" ? checked : scope;
    const reads = changing(input, field, first, second);
    rejected(original, product, checked, scope);
    assert.equal(reads(), 0, `${target}.${field}`);
  }
});

test("candidate accessors cannot rewrite verification MEMBER or source ERROR", () => {
  for (const target of ["verification", "context"]) {
    const draft = createMembershipDraft(collectionId);
    const product = candidate(10);
    const checked = verification(10, target === "verification" ? { status: "MEMBER" } : {});
    const scope = context(target === "context" ? { sourceState: "ERROR" } : {});
    let calls = 0;
    Object.defineProperty(product, "productId", { get() {
      calls++;
      if (target === "verification") checked.status = "NOT_MEMBER";
      else scope.sourceState = "COMPLETE";
      return id(10);
    } });
    const result = rejected(draft, product, checked, scope);
    assert.equal(calls, 0);
    assert.equal(result.proposedAdds[id(10)], undefined);
    assert.equal(target === "verification" ? checked.status : scope.sourceState,
      target === "verification" ? "MEMBER" : "ERROR");
  }
});

test("verification and context accessors cannot rewrite another input", () => {
  const draft = createMembershipDraft(collectionId);
  const product = { ...candidate(10), productId: id(11) };
  const checked = verification(10);
  let verificationCalls = 0;
  Object.defineProperty(checked, "productId", { get() {
    verificationCalls++; product.productId = id(10); return id(10);
  } });
  rejected(draft, product, checked);
  assert.equal(verificationCalls, 0);
  assert.equal(product.productId, id(11));

  const anotherCheck = verification(10, { status: "MEMBER" });
  const scope = context();
  let contextCalls = 0;
  Object.defineProperty(scope, "viewKey", { get() {
    contextCalls++; anotherCheck.status = "NOT_MEMBER"; return "query:1";
  } });
  rejected(draft, candidate(10), anotherCheck, scope);
  assert.equal(contextCalls, 0);
  assert.equal(anotherCheck.status, "MEMBER");
});

test("rejection preserves source blockers for a second Add", () => {
  const draft = ingestMembershipPage(createMembershipDraft(collectionId), "duplicate",
    page([member(10), member(10)]));
  const product = candidate(11);
  Object.defineProperty(product, "productId", { get() {
    draft.sourceAnomalies.length = 0; return id(11);
  } });
  const first = rejected(draft, product, verification(11));
  const second = rejectAdd(first, 11);
  assert.deepEqual(second.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.equal(second.proposedAdds[id(11)], undefined);
});

test("rejected draft does not share nested mutable state with caller input", () => {
  const draft = add(loaded([10]), 11);
  const result = rejectAdd(draft, 12, verification(12, { status: "MEMBER" }));
  draft.entries[id(10)].sortOrderText = "999";
  draft.proposedAdds[id(11)].verificationAtAdd.checkedAtMs = 1;
  draft.pages[0].status = "REJECTED";
  assert.equal(result.entries[id(10)].sortOrderText, "10");
  assert.equal(result.proposedAdds[id(11)].verificationAtAdd.checkedAtMs, 900);
  assert.equal(result.pages[0].status, "FULLY_ACCEPTED");
  assert.equal(membershipIsDirty(result), true);
});

test("nested draft accessor fails with fixed error before candidate inspection", () => {
  const draft = loaded([10]);
  let candidateReads = 0;
  const product = candidate(11);
  Object.defineProperty(product, "productId", { get() { candidateReads++; return id(11); } });
  Object.defineProperty(draft.entries[id(10)], "sortOrderText", {
    get() { throw new Error("private draft value"); },
  });
  assert.throws(() => addProposedMember(draft, product, verification(11), context()),
    (error) => error instanceof MembershipDraftSnapshotError &&
      error.message === "MEMBERSHIP_DRAFT_SNAPSHOT_FAILED" &&
      !error.message.includes("private"));
  assert.equal(candidateReads, 0);
});

test("external whitelist rejects extra, inherited, nested and accessor properties", () => {
  const draft = createMembershipDraft(collectionId);
  const withExtra = { ...candidate(10), storageKey: "private/image" };
  rejected(draft, withExtra, verification(10));
  const inherited = Object.create({ productId: id(10) });
  Object.assign(inherited, { productCode: "P-10", displayName: "Product 10",
    status: "published" });
  rejected(draft, inherited, verification(10));
  rejected(draft, { ...candidate(10), displayName: { nested: "unsafe" } }, verification(10));
  const extraAccessor = candidate(10);
  let reads = 0;
  Object.defineProperty(extraAccessor, "extra", { enumerable: true, get() { reads++; return 1; } });
  rejected(draft, extraAccessor, verification(10));
  assert.equal(reads, 0);
});

test("Proxy reflection side effects cannot enter the returned draft", () => {
  const clean = createMembershipDraft(collectionId);
  const plainProxy = new Proxy(candidate(11), {});
  const cleanResult = rejected(clean, plainProxy, verification(11));
  assert.equal(cleanResult.proposedAdds[id(11)], undefined,
    "a Proxy cannot be accepted even when no other blocker exists");

  const draft = ingestMembershipPage(createMembershipDraft(collectionId), "duplicate",
    page([member(10), member(10)]));
  let traps = 0;
  const product = new Proxy(candidate(11), { getOwnPropertyDescriptor(target, field) {
    traps++;
    draft.sourceAnomalies.length = 0;
    return Reflect.getOwnPropertyDescriptor(target, field);
  } });
  const result = rejected(draft, product, verification(11));
  assert.ok(traps > 0);
  assert.deepEqual(result.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.equal(result.proposedAdds[id(11)], undefined);
  rejectAdd(result, 11);
});

test("missing or unsafe structured-clone gate fails closed before external reads", () => {
  const saved = globalThis.structuredClone;
  const product = candidate(10);
  let reads = 0;
  Object.defineProperty(product, "productId", { get() { reads++; return id(10); } });
  try {
    for (const replacement of [undefined, (value) => value]) {
      globalThis.structuredClone = replacement;
      assert.throws(() => addProposedMember(createMembershipDraft(collectionId), product,
        verification(10), context()), (error) => error instanceof MembershipDraftSnapshotError &&
        error.message === "MEMBERSHIP_DRAFT_SNAPSHOT_FAILED");
    }
  } finally { globalThis.structuredClone = saved; }
  assert.equal(reads, 0);
});

test("throwing getters fail closed with no partial draft change", () => {
  const original = add(createMembershipDraft(collectionId), 11);
  const before = JSON.stringify(original);
  for (const [input, field] of [[candidate(10), "productId"],
    [verification(10), "origin"], [context(), "nowMs"]]) {
    Object.defineProperty(input, field, { get() { throw new Error("secret evidence"); } });
    const product = field === "productId" ? input : candidate(10);
    const checked = field === "origin" ? input : verification(10);
    const scope = field === "nowMs" ? input : context();
    rejected(original, product, checked, scope);
    assert.equal(JSON.stringify(original), before);
  }
  const source = { ...original };
  Object.defineProperty(source, "limitReached", { get() { throw new Error("secret state"); } });
  assert.throws(() => addProposedMember(source, candidate(10), verification(10), context()),
    (error) => error instanceof MembershipDraftSnapshotError &&
      error.message === "MEMBERSHIP_DRAFT_SNAPSHOT_FAILED" &&
      !error.message.includes("secret"));
  assert.equal(JSON.stringify(original), before);
});

test("candidate getter cannot clear a trusted duplicate-source anomaly before Add", () => {
  const draft = ingestMembershipPage(createMembershipDraft(collectionId), "duplicate",
    page([member(10), member(10)]));
  assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
  const product = candidate(11);
  let reads = 0;
  Object.defineProperty(product, "productId", { get() {
    reads++;
    draft.sourceAnomalies.length = 0; // The caller's object is outside this function's control.
    return id(11);
  } });
  const result = rejected(draft, product, verification(11));
  assert.equal(reads, 0);
  assert.equal(result.proposedAdds[id(11)], undefined);
  assert.deepEqual(result.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
});

test("verification getter cannot clear a trusted anomaly before Add", () => {
  const draft = ingestMembershipPage(createMembershipDraft(collectionId), "duplicate",
    page([member(10), member(10)]));
  const checked = verification(11);
  let reads = 0;
  Object.defineProperty(checked, "productId", { get() {
    reads++;
    draft.sourceAnomalies.length = 0;
    return id(11);
  } });
  const result = rejected(draft, candidate(11), checked);
  assert.deepEqual(result.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.equal(reads, 0);
  assert.equal(draft.proposedAdds[id(11)], undefined);
});

test("view getter cannot clear a trusted source conflict before Add", () => {
  let draft = add(createMembershipDraft(collectionId), 10);
  draft = ingestMembershipPage(draft, "new", page([member(10)]));
  assert.deepEqual(draft.draftConflicts, [id(10)]);
  const scope = context();
  Object.defineProperty(scope, "viewKey", { get() {
    draft.draftConflicts.length = 0;
    return "query:1";
  } });
  const result = rejected(draft, candidate(11), verification(11), scope);
  assert.deepEqual(result.draftConflicts, [id(10)]);
  assert.equal(draft.proposedAdds[id(11)], undefined);
});

test("candidate getter cannot free a captured original or proposed capacity slot", () => {
  const full = loaded(Array.from({ length: MAX_LOADED_MEMBERS }, (_, i) => i + 10));
  const product = candidate(510);
  Object.defineProperty(product, "productId", { get() {
    delete full.entries[id(10)];
    return id(510);
  } });
  const safeFull = rejected(full, product, verification(510));
  assert.equal(Object.keys(safeFull.entries).length, 500);
  assert.equal(full.proposedAdds[id(510)], undefined);

  const withProposal = add(loaded(Array.from({ length: 499 }, (_, i) => i + 10)), 509);
  const another = candidate(510);
  Object.defineProperty(another, "productId", { get() {
    delete withProposal.proposedAdds[id(509)];
    return id(510);
  } });
  const safeProposal = rejected(withProposal, another, verification(510));
  assert.ok(safeProposal.proposedAdds[id(509)]);
  assert.equal(withProposal.proposedAdds[id(510)], undefined);
});

test("candidate getter cannot clear the sticky limitReached gate", () => {
  let draft = add(loaded(Array.from({ length: 499 }, (_, i) => i + 10)), 509);
  draft = ingestMembershipPage(draft, "overflow", page([member(510)]));
  draft = cancelProposedMember(draft, id(509));
  assert.equal(Object.keys(draft.entries).length, 499);
  assert.equal(draft.limitReached, true);
  const product = candidate(511);
  Object.defineProperty(product, "productId", { get() {
    draft.limitReached = false;
    return id(511);
  } });
  const result = rejected(draft, product, verification(511));
  assert.equal(result.limitReached, true);
  assert.equal(draft.proposedAdds[id(511)], undefined);
});

test("getter side effects followed by a throw never create a partial proposed item", () => {
  const draft = loaded([10]);
  const product = candidate(11);
  Object.defineProperty(product, "productId", { get() {
    delete draft.entries[id(10)]; // A caller-owned object can still be changed externally.
    throw new Error("untrusted getter");
  } });
  const result = rejected(draft, product, verification(11));
  assert.ok(result.entries[id(10)]);
  assert.deepEqual(draft.proposedAdds, {});
  assert.ok(draft.entries[id(10)]);
});

test("accessor rejection preserves existing nested draft values", () => {
  const draft = add(loaded([10]), 11);
  const product = candidate(12);
  Object.defineProperty(product, "productId", { get() {
    draft.entries[id(10)].sortOrderText = "999";
    draft.proposedAdds[id(11)].verificationAtAdd.checkedAtMs = 1;
    return id(12);
  } });
  const result = rejected(draft, product, verification(12));
  assert.notEqual(result, draft);
  assert.equal(result.entries[id(10)].sortOrderText, "10");
  assert.equal(result.proposedAdds[id(11)].verificationAtAdd.checkedAtMs, 900);
  assert.equal(result.proposedAdds[id(12)], undefined);
});

test("Cancel only removes proposed item, is idempotent and restores correct dirty state", () => {
  const clean = createMembershipDraft(collectionId);
  const added = add(clean, 10);
  const cancelled = cancelProposedMember(added, id(10).toUpperCase());
  assert.equal(membershipIsDirty(cancelled), false);
  assert.equal(cancelProposedMember(cancelled, id(10)), cancelled);
  const existing = loaded([11]);
  assert.equal(cancelProposedMember(existing, id(11)), existing);
  assert.ok(existing.entries[id(11)]);
});

test("Cancel preserves existing member changes; Discard clears both kinds of draft", () => {
  const original = loaded([11]);
  let draft = markMembershipRemoved(original, id(11), true);
  draft = add(draft, 10);
  draft = cancelProposedMember(draft, id(10));
  assert.equal(membershipIsDirty(draft), true);
  assert.equal(draft.entries[id(11)].removed, true);
  draft = add(draft, 10);
  draft = discardMembershipDraft(draft);
  assert.equal(membershipIsDirty(draft), false);
  assert.deepEqual(draft.proposedAdds, {});
  assert.equal(draft.entries[id(11)].removed, false);
});

test("proposed sort uses int32 validation, preserves invalid text and UUID tie order", () => {
  let draft = add(add(createMembershipDraft(collectionId), 11), 10);
  for (const valid of ["-2147483648", "0", "2147483647", "+1"])
    assert.equal(validateMembershipDraft(changeProposedMemberOrder(draft, id(10), valid)).localState,
      "VALID", valid);
  for (const invalid of ["", "1.2", "NaN", "Infinity", "2147483648", "-2147483649"])
    assert.equal(validateMembershipDraft(changeProposedMemberOrder(draft, id(10), invalid)).overallState,
      "INVALID", invalid);
  draft = changeProposedMemberOrder(draft, id(11), "-1");
  assert.deepEqual(sortedProposedMembers(draft).map((item) => item.productId), [id(11), id(10)]);
  draft = changeProposedMemberOrder(draft, id(11), "0");
  assert.deepEqual(sortedProposedMembers(draft).map((item) => item.productId), [id(10), id(11)]);
  assert.equal(changeProposedMemberOrder(draft, id(99), "2"), draft);
  assert.equal(draft.entries[id(10)], undefined);
});

test("sorted results isolate top-level, nested and array mutations from draft", () => {
  const draft = add(add(createMembershipDraft(collectionId), 11), 10);
  const before = JSON.stringify(draft);
  const dirty = membershipIsDirty(draft);
  const sorted = sortedProposedMembers(draft);
  assert.notEqual(sorted[0], draft.proposedAdds[id(10)]);
  assert.notEqual(sorted[0].verificationAtAdd,
    draft.proposedAdds[id(10)].verificationAtAdd);
  sorted[0].sortOrderText = "2147483648";
  sorted[0].productId = id(99);
  sorted[0].productCode = "mutated";
  sorted[0].displayName = "mutated";
  sorted[0].verificationAtAdd.collectionId = id(99);
  sorted.reverse();
  sorted.sort((a, b) => b.productId.localeCompare(a.productId));
  sorted.splice(0, 1);
  assert.equal(JSON.stringify(draft), before);
  assert.equal(membershipIsDirty(draft), dirty);
  assert.deepEqual(sortedProposedMembers(draft).map((item) => item.productId), [id(10), id(11)]);
  assert.equal(validateMembershipDraft(draft).overallState, "NOT_VERIFIED");
});

test("source collision retains proposed item, marks conflict and blocks further Add", () => {
  let draft = add(createMembershipDraft(collectionId), 10);
  draft = ingestMembershipPage(draft, "second", page([member(10)]));
  assert.ok(draft.proposedAdds[id(10)]);
  assert.ok(draft.entries[id(10)]);
  assert.deepEqual(draft.draftConflicts, [id(10)]);
  rejectAdd(draft, 11);
  const reset = discardMembershipDraft(draft);
  assert.deepEqual(reset.proposedAdds, {});
  assert.equal(reset.entries[id(10)].original.productId, id(10));
  assert.deepEqual(reset.draftConflicts, []);
});

test("source anomalies and sticky capacity blocks cannot be bypassed by Add or Discard", () => {
  const anomalous = ingestMembershipPage(createMembershipDraft(collectionId), "bad",
    page([member(10), member(10)]));
  rejectAdd(anomalous, 11);
  assert.equal(add(discardMembershipDraft(anomalous), 11).proposedAdds?.[id(11)], undefined);
  let bounded = loaded(Array.from({ length: MAX_LOADED_MEMBERS }, (_, i) => i + 10));
  bounded = ingestMembershipPage(bounded, "overflow", page([member(510)]));
  assert.equal(bounded.limitReached, true);
  rejectAdd(bounded, 511);
  assert.equal(add(discardMembershipDraft(bounded), 511).proposedAdds?.[id(511)], undefined);
});

test("499 + proposed reaches 500; Remove does not free a place, Cancel does", () => {
  let draft = loaded(Array.from({ length: 499 }, (_, i) => i + 10));
  draft = markMembershipRemoved(draft, id(10), true);
  draft = add(draft, 509);
  assert.equal(Object.keys(draft.proposedAdds).length, 1);
  rejectAdd(draft, 510);
  const cancelled = cancelProposedMember(draft, id(509));
  assert.ok(add(cancelled, 510).proposedAdds?.[id(510)]);
  assert.equal(membershipIsDirty(cancelled), true);
});

test("500 observed members reject a 501st proposal without changing the source snapshot", () => {
  const full = loaded(Array.from({ length: MAX_LOADED_MEMBERS }, (_, i) => i + 10));
  assert.equal(full.limitReached, false);
  rejectAdd(full, 510);
  assert.equal(Object.keys(full.entries).length, 500);
  assert.equal(Object.keys(full.proposedAdds).length, 0);
});

test("new trusted page respects union capacity and keeps already-dirty proposals", () => {
  let draft = loaded(Array.from({ length: 499 }, (_, i) => i + 10));
  draft = add(draft, 509);
  const blocked = ingestMembershipPage(draft, "overflow", page([member(510)]));
  assert.equal(blocked.limitReached, true);
  assert.equal(blocked.pages.at(-1).status, "REJECTED");
  assert.ok(blocked.proposedAdds[id(509)]);
  assert.equal(blocked.entries[id(510)], undefined);
  const reset = discardMembershipDraft(blocked);
  assert.equal(reset.limitReached, true);
  assert.deepEqual(reset.proposedAdds, {});
  rejectAdd(reset, 511);
});

test("original Remove, Restore, Sort and Discard remain independent", () => {
  let draft = loaded([10]);
  draft = markMembershipRemoved(draft, id(10), true);
  draft = changeMembershipOrder(draft, id(10), "-2");
  draft = markMembershipRemoved(draft, id(10), false);
  assert.equal(membershipIsDirty(draft), true);
  assert.equal(sortedMembershipEntries(draft)[0].sortOrderText, "-2");
  draft = discardMembershipDraft(draft);
  assert.equal(membershipIsDirty(draft), false);
  assert.equal(draft.entries[id(10)].sortOrderText, "10");
});
