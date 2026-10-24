import assert from "node:assert/strict";
import test from "node:test";
import { changeMembershipOrder, createMembershipDraft, discardMembershipDraft,
  ingestMembershipPage, markMembershipRemoved, membershipIsDirty,
  sortedMembershipEntries, validateMembershipDraft, MAX_LOADED_MEMBERS,
} from "../src/lib/admin/collection-membership-draft.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const member = (n, sortOrder = n) => ({ productId: id(n), productCode: `P-${n}`,
  nameEn: `Product ${n}`, nameZh: `商品 ${n}`, productStatus: "published", sortOrder });
const page = (items, state = "COMPLETE") => ({ state, items,
  issues: [], nextCursor: null, previousCursor: null, origin: "OFFLINE_FIXTURE" });
const initial = () => ingestMembershipPage(createMembershipDraft(id(1)), "first", page([member(10)]));

test("copies source scalars, deduplicates UUID and keeps loaded pages local", () => {
  const source = member(10);
  let draft = ingestMembershipPage(createMembershipDraft(id(1)), "first", page([source]));
  source.nameEn = "Mutated outside";
  assert.equal(draft.entries[id(10)].original.nameEn, "Product 10");
  draft = ingestMembershipPage(draft, "next", page([member(10), member(11)]));
  assert.equal(Object.keys(draft.entries).length, 2);
  assert.deepEqual(draft.pages, [
    { pageKey: "first", status: "FULLY_ACCEPTED" },
    { pageKey: "next", status: "FULLY_ACCEPTED" },
  ]);
  assert.deepEqual(ingestMembershipPage(draft, "empty", page([], "EMPTY_PAGE")), draft);
  assert.equal(Object.keys(ingestMembershipPage(draft, "other", page([])).entries).length, 2,
    "absence from one complete page is not global member absence");
  assert.equal(draft.entries[id(999)], undefined, "unloaded means unknown, not absent");
  assert.deepEqual(ingestMembershipPage(draft, "duplicate", page([member(11), member(11)])).sourceAnomalies,
    ["DUPLICATE_ID"]);
});

test("duplicate source identities remain blocked after Discard and unrelated reads", () => {
  for (const second of [member(10), member(10, 20)]) {
    let draft = ingestMembershipPage(createMembershipDraft(id(1)), "first",
      page([member(10), second]));
    assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
    assert.deepEqual(draft.draftConflicts, []);
    assert.equal(draft.pages[0].status, "PARTIALLY_ACCEPTED");
    draft = markMembershipRemoved(draft, id(10), true);
    draft = discardMembershipDraft(draft);
    assert.equal(membershipIsDirty(draft), false);
    assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
    assert.equal(validateMembershipDraft(draft).overallState, "INVALID",
      "a direct validator call must not present an anomalous source as valid");
    draft = ingestMembershipPage(draft, "other", page([member(11)]));
    assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
    for (const status of ["ERROR", "INCOMPLETE"])
      assert.deepEqual(ingestMembershipPage(draft, "first", page([], status)).sourceAnomalies,
        ["DUPLICATE_ID"]);
    // Even a clean reread of this page cannot prove all previous page observations
    // belong to one snapshot. A new editor session must re-verify its source.
    draft = ingestMembershipPage(draft, "first", page([member(10)]));
    assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
    assert.deepEqual(createMembershipDraft(id(1)).sourceAnomalies, []);
  }
});

test("Remove and Restore preserve independent sort-order draft and deterministic dirty state", () => {
  let draft = initial();
  assert.equal(membershipIsDirty(draft), false);
  draft = markMembershipRemoved(draft, id(10), true);
  assert.equal(membershipIsDirty(draft), true);
  draft = changeMembershipOrder(draft, id(10), "-2147483648");
  draft = markMembershipRemoved(draft, id(10), false);
  assert.equal(draft.entries[id(10)].sortOrderText, "-2147483648");
  assert.equal(membershipIsDirty(draft), true);
  draft = changeMembershipOrder(draft, id(10), "10");
  assert.equal(membershipIsDirty(draft), false);
  assert.equal(markMembershipRemoved(draft, id(999), true), draft);
  assert.equal(changeMembershipOrder(draft, id(999), "0"), draft);
});

test("PostgreSQL int32 boundaries, duplicate sort values and stable UUID tie-break", () => {
  let draft = ingestMembershipPage(createMembershipDraft(id(1)), "first",
    page([member(11, 0), member(10, 0)]));
  assert.deepEqual(sortedMembershipEntries(draft).map((entry) => entry.original.productId),
    [id(10), id(11)]);
  for (const valid of ["-2147483648", "0", "2147483647", "+1"])
    assert.equal(validateMembershipDraft(changeMembershipOrder(draft, id(10), valid)).localState,
      "VALID", valid);
  for (const invalid of ["", " ", "1.2", "NaN", "Infinity", "2147483648", "-2147483649", "abc"])
    assert.equal(validateMembershipDraft(changeMembershipOrder(draft, id(10), invalid)).overallState,
      "INVALID", invalid);
  draft = changeMembershipOrder(draft, id(11), "0");
  assert.equal(membershipIsDirty(draft), false);
  assert.equal(validateMembershipDraft(draft).overallState, "NOT_VERIFIED");
  assert.match(validateMembershipDraft(draft).notVerified.join(" "), /Unloaded collection members/);
});

test("dirty draft preserves old snapshot after refreshed member order or metadata changes", () => {
  let draft = changeMembershipOrder(initial(), id(10), "50");
  draft = ingestMembershipPage(draft, "first", page([{ ...member(10, 20), nameEn: "New source" }]));
  assert.equal(draft.entries[id(10)].original.sortOrder, 10);
  assert.equal(draft.entries[id(10)].sortOrderText, "50");
  assert.deepEqual(draft.draftConflicts, [id(10)]);
  assert.deepEqual(draft.sourceAnomalies, []);
  assert.equal(membershipIsDirty(draft), true);
  draft = discardMembershipDraft(draft);
  assert.equal(draft.entries[id(10)].original.sortOrder, 20);
  assert.equal(draft.entries[id(10)].original.nameEn, "New source");
  assert.equal(membershipIsDirty(draft), false);
  assert.deepEqual(draft.draftConflicts, []);
});

test("source anomalies outrank draft conflicts and survive local discard", () => {
  let draft = changeMembershipOrder(initial(), id(10), "50");
  draft = ingestMembershipPage(draft, "first", page([member(10, 20), member(10, 30)]));
  assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.deepEqual(draft.draftConflicts, [id(10)]);
  draft = discardMembershipDraft(draft);
  assert.deepEqual(draft.draftConflicts, []);
  assert.deepEqual(draft.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.equal(validateMembershipDraft(draft).overallState, "INVALID");
});

test("failed, incomplete and empty reads never erase a dirty local member", () => {
  const dirty = markMembershipRemoved(initial(), id(10), true);
  for (const state of ["INCOMPLETE", "ERROR", "NOT_CONNECTED", "EMPTY_PAGE"])
    assert.deepEqual(ingestMembershipPage(dirty, state, page([], state)), dirty);
});

test("collection identity is separate and 499, 500, 501 capacity states retain snapshots", () => {
  const a = initial();
  const b = createMembershipDraft(id(2));
  assert.notEqual(a.collectionId, b.collectionId);
  assert.equal(Object.keys(b.entries).length, 0);
  const rows = Array.from({ length: MAX_LOADED_MEMBERS - 1 }, (_, index) => member(index + 10));
  let bounded = createMembershipDraft(id(1));
  for (let index = 0; index < rows.length; index += 50)
    bounded = ingestMembershipPage(bounded, String(index), page(rows.slice(index, index + 50)));
  assert.equal(Object.keys(bounded.entries).length, 499);
  assert.equal(bounded.limitReached, false);
  bounded = markMembershipRemoved(bounded, id(10), true);
  bounded = ingestMembershipPage(bounded, "last", page([member(509)]));
  assert.equal(Object.keys(bounded.entries).length, MAX_LOADED_MEMBERS);
  assert.equal(bounded.limitReached, false);
  assert.equal(bounded.pages.at(-1).status, "FULLY_ACCEPTED");
  bounded = ingestMembershipPage(bounded, "overflow", page([member(510)]));
  assert.equal(Object.keys(bounded.entries).length, MAX_LOADED_MEMBERS);
  assert.equal(bounded.entries[id(510)], undefined);
  assert.equal(bounded.limitReached, true);
  assert.equal(bounded.pages.at(-1).status, "REJECTED");
  assert.equal(membershipIsDirty(bounded), true);
  const reset = discardMembershipDraft(bounded);
  assert.equal(Object.keys(reset.entries).length, MAX_LOADED_MEMBERS);
  assert.equal(reset.entries[id(10)].original.productId, id(10));
  assert.equal(membershipIsDirty(reset), false);
  assert.equal(reset.limitReached, true, "Discard must not bypass the capacity gate");
  let partial = createMembershipDraft(id(1));
  for (let index = 0; index < rows.length; index += 50)
    partial = ingestMembershipPage(partial, String(index), page(rows.slice(index, index + 50)));
  partial = ingestMembershipPage(partial, "partial", page([member(509), member(510)]));
  assert.equal(Object.keys(partial.entries).length, MAX_LOADED_MEMBERS);
  assert.equal(partial.pages.at(-1).status, "PARTIALLY_ACCEPTED");
  assert.equal(partial.entries[id(510)], undefined);
});
