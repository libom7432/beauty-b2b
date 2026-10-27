import assert from "node:assert/strict";
import test from "node:test";
import { candidateLocalMembershipStatus as status } from
  "../src/lib/admin/collection-candidate-membership-status.ts";
import { addProposedMember, createMembershipDraft, discardMembershipDraft,
  ingestMembershipPage, markMembershipRemoved } from
  "../src/lib/admin/collection-membership-draft.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const collectionId = id(1);
const member = (n, sortOrder = 0) => ({ productId: id(n), productCode: `P-${n}`,
  nameEn: `Product ${n}`, nameZh: null, productStatus: "published", sortOrder });
const page = (items) => ({ state: "COMPLETE", items, issues: [], nextCursor: null,
  previousCursor: null, origin: "OFFLINE_FIXTURE" });
const loaded = (...numbers) => ingestMembershipPage(createMembershipDraft(collectionId),
  "first", page(numbers.map((number) => member(number))));
const proposed = (draft, n) => addProposedMember(draft,
  { productId: id(n), productCode: `P-${n}`, displayName: `Product ${n}`, status: "published" },
  { collectionId, productId: id(n), status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE",
    viewKey: "query:1", checkedAtMs: 900, expiresAtMs: 2000 },
  { collectionId, viewKey: "query:1", nowMs: 1000, sourceState: "COMPLETE" });

test("unobserved UUID stays NOT_VERIFIED and identity matching is case insensitive", () => {
  const draft = loaded(10);
  assert.equal(status(draft, id(10).toUpperCase()), "ALREADY_MEMBER");
  assert.equal(status(draft, id(11)), "NOT_VERIFIED");
  assert.equal(status(draft, "invalid"), "MEMBERSHIP_UNAVAILABLE");
});

test("Remove, Restore and Discard change only the observed member label", () => {
  const original = loaded(10);
  const removed = markMembershipRemoved(original, id(10), true);
  assert.equal(status(removed, id(10)), "PENDING_REMOVAL");
  assert.equal(status(markMembershipRemoved(removed, id(10), false), id(10)), "ALREADY_MEMBER");
  assert.equal(status(discardMembershipDraft(removed), id(10)), "ALREADY_MEMBER");
  assert.equal(status(original, id(10)), "ALREADY_MEMBER");
});

test("proposed add is local, wins over unrelated blocks and conflicts with a newly observed member", () => {
  const draft = proposed(loaded(10), 11);
  assert.equal(status(draft, id(11)), "DRAFT_ADDED");
  assert.equal(status(draft, id(10)), "ALREADY_MEMBER");
  assert.equal(status({ ...draft, sourceAnomalies: ["DUPLICATE_ID"] }, id(11)), "DRAFT_ADDED",
    "a separate source anomaly does not erase a local proposed add");
  const conflict = ingestMembershipPage(draft, "next", page([member(11)]));
  assert.deepEqual(conflict.draftConflicts, [id(11)]);
  assert.equal(status(conflict, id(11)), "MEMBERSHIP_UNAVAILABLE",
    "a confirmed member must not be presented only as a proposed add");
  assert.equal(status(discardMembershipDraft(conflict), id(11)), "ALREADY_MEMBER");
});

test("source anomaly preserves observed facts but blocks unknown membership status", () => {
  const anomalous = ingestMembershipPage(loaded(10), "duplicate", page([member(10), member(10)]));
  assert.deepEqual(anomalous.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.equal(status(anomalous, id(10)), "ALREADY_MEMBER");
  assert.equal(status(anomalous, id(11)), "MEMBERSHIP_UNAVAILABLE");
  assert.equal(status(discardMembershipDraft(anomalous), id(11)), "MEMBERSHIP_UNAVAILABLE");
});

test("draft conflict and reached local capacity block unknown rows without erasing known facts", () => {
  const dirty = markMembershipRemoved(loaded(10), id(10), true);
  const conflicted = ingestMembershipPage(dirty, "first", page([member(10, 5)]));
  assert.deepEqual(conflicted.draftConflicts, [id(10)]);
  assert.equal(status(conflicted, id(10)), "PENDING_REMOVAL");
  assert.equal(status(conflicted, id(11)), "MEMBERSHIP_UNAVAILABLE");
  const limited = { ...dirty, limitReached: true };
  assert.equal(status(limited, id(10)), "PENDING_REMOVAL");
  assert.equal(status(limited, id(11)), "MEMBERSHIP_UNAVAILABLE");
  assert.equal(status(discardMembershipDraft(limited), id(11)), "MEMBERSHIP_UNAVAILABLE");
});

test("unavailable current page cannot turn an unknown product into a non-member", () => {
  const draft = loaded(10);
  for (const sourceState of [null, "ERROR", "INCOMPLETE", "NOT_CONNECTED", "EMPTY_PAGE"]) {
    assert.equal(status(draft, id(11), sourceState), "MEMBERSHIP_UNAVAILABLE");
    assert.equal(status(draft, id(10), sourceState), "ALREADY_MEMBER");
  }
});

test("derivation does not modify draft or candidate identity", () => {
  const draft = proposed(loaded(10), 11);
  const before = structuredClone(draft);
  const productId = id(11).toUpperCase();
  assert.equal(status(draft, productId), "DRAFT_ADDED");
  assert.equal(productId, id(11).toUpperCase());
  assert.deepEqual(draft, before);
});
