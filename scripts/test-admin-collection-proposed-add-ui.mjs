import assert from "node:assert/strict";
import test from "node:test";
import { addVerifiedCandidateToDraft } from "../src/lib/admin/collection-proposed-add-ui.ts";
import { cancelProposedMember, changeMembershipOrder, changeProposedMemberOrder,
  createMembershipDraft, discardMembershipDraft, ingestMembershipPage,
  markMembershipRemoved, membershipIsDirty,
  sortedProposedMembers, validateMembershipDraft } from "../src/lib/admin/collection-membership-draft.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const collectionId = id(2);
const candidate = (n) => ({ productId: id(n), productCode: `FAMILY-${n}`,
  displayName: `Candidate ${n}`, status: "draft" });
const identity = (n) => ({ collectionId, productId: id(n), viewKey: "current-view",
  generation: 4, sequence: 7 });
const observation = (n, changed = {}) => ({ ...identity(n), status: "NOT_MEMBER",
  origin: "OFFLINE_FIXTURE", checkedAtMs: 1000, expiresAtMs: 31000, ...changed });
const attempt = (draft, n, changed = {}) => addVerifiedCandidateToDraft(draft, candidate(n),
  observation(n, changed.observation), { ...identity(n), ...changed.identity },
  changed.sourceState ?? "COMPLETE", changed.sourceReady ?? true,
  changed.candidateVisible ?? true, changed.nowMs ?? 1001);
const member = (n) => ({ productId: id(n), productCode: `FAMILY-${n}`, nameEn: "Member",
  nameZh: null, productStatus: "draft", sortOrder: n });
const page = (items) => ({ state: "COMPLETE", items, issues: [], nextCursor: null,
  previousCursor: null, origin: "OFFLINE_FIXTURE" });

test("click-time NOT_MEMBER adds exactly one local proposed member without mutating input", () => {
  const draft = createMembershipDraft(collectionId);
  const before = structuredClone(draft);
  const result = attempt(draft, 101);
  assert.equal(result.result, "ADDED");
  assert.deepEqual(draft, before);
  assert.deepEqual(Object.keys(result.draft.proposedAdds), [id(101)]);
  assert.equal(membershipIsDirty(result.draft), true);
  assert.equal(attempt(result.draft, 101).result, "DRAFT_UNAVAILABLE");
});

test("all other GET states and stale observations fail without changing the draft", () => {
  const draft = createMembershipDraft(collectionId);
  for (const status of ["MEMBER", "NOT_CONNECTED", "ERROR", "INCOMPLETE"])
    assert.equal(attempt(draft, 101, { observation: { status } }).result, "VERIFY_AGAIN");
  for (const changed of [
    { nowMs: 31000 }, { nowMs: 31001 },
    { observation: { collectionId: id(1) } }, { observation: { productId: id(102) } },
    { identity: { viewKey: "other-view" } }, { identity: { generation: 5 } },
    { identity: { sequence: 8 } }, { observation: { origin: "NONE" } },
    { observation: { expiresAtMs: 99999 } },
  ]) assert.equal(attempt(draft, 101, changed).result, "VERIFY_AGAIN");
  assert.equal(attempt(draft, 101, { nowMs: 30999 }).result, "ADDED");
  assert.deepEqual(draft.proposedAdds, {});
});

test("latest view and source must be eligible at the moment of Add", () => {
  const draft = createMembershipDraft(collectionId);
  for (const changed of [
    { candidateVisible: false }, { sourceReady: false },
    { sourceState: "ERROR" }, { sourceState: "INCOMPLETE" },
    { sourceState: "NOT_CONNECTED" },
  ]) assert.equal(attempt(draft, 101, changed).result, "DRAFT_UNAVAILABLE");
  assert.deepEqual(draft.proposedAdds, {});
});

test("source anomaly, conflict, limit and observed member block Add", () => {
  const draft = createMembershipDraft(collectionId);
  for (const blocked of [
    { ...draft, sourceAnomalies: ["DUPLICATE_ID"] },
    { ...draft, draftConflicts: [id(101)] },
    { ...draft, limitReached: true },
  ]) {
    const before = structuredClone(blocked);
    const result = attempt(blocked, 101);
    assert.equal(result.result, "DRAFT_UNAVAILABLE");
    assert.deepEqual(result.draft, before);
    assert.deepEqual(blocked, before);
  }
  const observed = ingestMembershipPage(draft, "first", page([member(101)]));
  assert.equal(attempt(observed, 101).result, "DRAFT_UNAVAILABLE");
  assert.equal(attempt(markMembershipRemoved(observed, id(101), true), 101).result,
    "DRAFT_UNAVAILABLE");
});

test("500 observed identities block a new proposed add without releasing removed slots", () => {
  const draft = ingestMembershipPage(createMembershipDraft(collectionId), "first",
    page(Array.from({ length: 500 }, (_, n) => member(n + 100))));
  assert.equal(attempt(draft, 900).result, "DRAFT_UNAVAILABLE");
  assert.equal(attempt(markMembershipRemoved(draft, id(100), true), 900).result,
    "DRAFT_UNAVAILABLE");
});

test("Cancel restores clean state and a new Add still needs a fresh observation", () => {
  const added = attempt(createMembershipDraft(collectionId), 101).draft;
  const canceled = cancelProposedMember(added, id(101));
  assert.equal(membershipIsDirty(canceled), false);
  assert.equal(attempt(canceled, 101, { nowMs: 31000 }).result, "VERIFY_AGAIN");
  assert.equal(attempt(canceled, 101, { observation: { checkedAtMs: 31001,
    expiresAtMs: 61001 }, nowMs: 31002 }).result, "ADDED");
});

test("proposed sort uses existing int32 validation and stable UUID ordering", () => {
  const first = attempt(createMembershipDraft(collectionId), 102).draft;
  const second = attempt(first, 101).draft;
  assert.deepEqual(sortedProposedMembers(second).map((item) => item.productId), [id(101), id(102)]);
  const sorted = changeProposedMemberOrder(second, id(102), "-5");
  assert.deepEqual(sortedProposedMembers(sorted).map((item) => item.productId), [id(102), id(101)]);
  assert.equal(second.proposedAdds[id(102)].sortOrderText, "0");
  const invalid = changeProposedMemberOrder(sorted, id(102), "2147483648");
  assert.equal(invalid.proposedAdds[id(102)].sortOrderText, "2147483648");
  assert.equal(validateMembershipDraft(invalid).localState, "INVALID");
});

test("mixed member transitions compose without losing earlier remove or sort edits", () => {
  const original = ingestMembershipPage(createMembershipDraft(collectionId), "first", page([member(202)]));
  const before = structuredClone(original);
  const removed = markMembershipRemoved(original, id(202), true);
  const removeThenAdd = attempt(removed, 101).draft;
  assert.equal(removeThenAdd.entries[id(202)].removed, true);
  assert.deepEqual(Object.keys(removeThenAdd.proposedAdds), [id(101)]);
  const addThenRemove = markMembershipRemoved(attempt(original, 101).draft, id(202), true);
  assert.equal(addThenRemove.entries[id(202)].removed, true);
  assert.deepEqual(Object.keys(addThenRemove.proposedAdds), [id(101)]);
  const sorted = changeMembershipOrder(original, id(202), "-7");
  const sortThenAdd = attempt(sorted, 101).draft;
  assert.equal(sortThenAdd.entries[id(202)].sortOrderText, "-7");
  assert.deepEqual(Object.keys(sortThenAdd.proposedAdds), [id(101)]);
  const addThenSort = changeMembershipOrder(attempt(original, 101).draft, id(202), "9");
  assert.equal(addThenSort.entries[id(202)].sortOrderText, "9");
  assert.deepEqual(Object.keys(addThenSort.proposedAdds), [id(101)]);
  const removeAddSort = changeProposedMemberOrder(removeThenAdd, id(101), "-3");
  assert.equal(removeAddSort.entries[id(202)].removed, true);
  assert.equal(removeAddSort.proposedAdds[id(101)].sortOrderText, "-3");
  assert.equal(markMembershipRemoved(removed, id(202), false).entries[id(202)].removed, false);
  assert.equal(membershipIsDirty(sortThenAdd), true);
  assert.deepEqual(original, before);
});

test("discard and cancel compose with Add while retaining source blockers and identity capacity", () => {
  const original = ingestMembershipPage(createMembershipDraft(collectionId), "first", page([member(202)]));
  const first = attempt(original, 101).draft;
  const canceled = cancelProposedMember(first, id(101));
  assert.equal(membershipIsDirty(canceled), false);
  assert.equal(attempt(canceled, 101, { nowMs: 31000 }).result, "VERIFY_AGAIN");
  const discarded = discardMembershipDraft(first);
  assert.equal(Object.keys(discarded.proposedAdds).length, 0);
  assert.equal(attempt(discarded, 101, { nowMs: 31000 }).result, "VERIFY_AGAIN");
  assert.equal(attempt(discarded, 101, { observation: { checkedAtMs: 31001,
    expiresAtMs: 61001 }, nowMs: 31002 }).result, "ADDED");
  const addThenDiscard = discardMembershipDraft(first);
  assert.equal(membershipIsDirty(addThenDiscard), false);
  const blocked = { ...original, limitReached: true, sourceAnomalies: ["DUPLICATE_ID"] };
  assert.equal(attempt(discardMembershipDraft(blocked), 101).result, "DRAFT_UNAVAILABLE");
  const twice = attempt(first, 101);
  assert.equal(twice.result, "DRAFT_UNAVAILABLE");
  assert.deepEqual(Object.keys(twice.draft.proposedAdds), [id(101)]);
  const twoProducts = attempt(first, 102).draft;
  assert.deepEqual(Object.keys(twoProducts.proposedAdds).sort(), [id(101), id(102)]);
});
