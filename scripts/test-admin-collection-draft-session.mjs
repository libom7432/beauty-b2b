import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_COLLECTION_DRAFT_SESSION_BYTES, MAX_DIRTY_COLLECTION_SESSIONS,
  acceptCollectionDraftSource, activateCollectionDraftSession,
  applyCollectionMembershipAction, basicSessionDirty, beginCollectionDraftSourceRead,
  cleanupCleanCollectionSessions,
  collectionDraftSessionBytes, collectionSessionDirty, createAdminCollectionDraftSessions,
  deactivateCollectionDraftSession, dirtyCollectionSessionCount,
  discardCollectionBasic, discardCollectionById, discardCollectionMembership,
  discardCurrentCollection, globalCollectionSessionDirty, initializeCollectionDraftSession,
  membershipSessionDirty, updateCollectionBasicField,
} from "../src/lib/admin/collection-draft-session.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const detail = (n, name = `Collection ${n}`) => ({ id: id(n), slug: `collection-${n}`,
  nameEn: name, nameZh: `集合 ${n}`, descriptionEn: "", descriptionZh: "",
  status: "draft", sortOrder: n, publishedAt: null,
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
const detailResult = (n, name) => ({ state: "COMPLETE", item: detail(n, name), issues: [],
  origin: "OFFLINE_FIXTURE" });
const member = (n, sortOrder = n) => ({ productId: id(n), productCode: `P-${n}`,
  nameEn: `Product ${n}`, nameZh: null, productStatus: "published", sortOrder });
const memberResult = (rows = [], state = "COMPLETE") => ({ state, items: rows, issues: [],
  nextCursor: null, previousCursor: null, origin: state === "COMPLETE" ? "OFFLINE_FIXTURE" : "NONE" });
const candidate = (n) => ({ productId: id(n), productCode: `P-${n}`,
  displayName: `Product ${n}`, status: "published" });
const evidence = (collection, product) => ({ collectionId: id(collection), productId: id(product),
  status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE", viewKey: "view:1",
  checkedAtMs: 900, expiresAtMs: 2000 });
const context = (collection) => ({ collectionId: id(collection), viewKey: "view:1",
  nowMs: 1000, sourceState: "COMPLETE" });
const addAction = (collection, product, token) => ({ kind: "ADD_PROPOSED", candidate: candidate(product),
  verification: evidence(collection, product), context: context(collection),
  verificationGeneration: token.generation });
const entry = (state, n) => state.entries[id(n)];
const fullStateBytes = (state) => new TextEncoder().encode(JSON.stringify(state)).byteLength;

/** Probe the real transition boundary; the reserved metadata headroom is not a
 * fixed offset and changes when counters cross decimal digit boundaries. */
function fillBasicToAcceptedLimit(step, character = "A") {
  let low = 1;
  let high = MAX_COLLECTION_DRAFT_SESSION_BYTES;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const attempt = updateCollectionBasicField(step.state, step.token,
      "descriptionEn", character.repeat(middle));
    if (attempt.code === "APPLIED") low = middle;
    else high = middle - 1;
  }
  const accepted = updateCollectionBasicField(step.state, step.token,
    "descriptionEn", character.repeat(low));
  assert.equal(accepted.code, "APPLIED");
  const over = updateCollectionBasicField(step.state, step.token,
    "descriptionEn", character.repeat(low + 1));
  assert.equal(over.code, "PAYLOAD_LIMIT");
  assert.equal(over.state, step.state);
  assert.equal(accepted.bytesUsed, fullStateBytes(accepted.state));
  return { ...accepted, length: low };
}

function withCounters(step, generation, version, nextGeneration) {
  const current = step.state.entries[step.token.collectionId];
  const revised = { ...current, generation, version };
  return { state: { entries: { ...step.state.entries,
    [step.token.collectionId]: revised }, nextGeneration },
  token: { collectionId: step.token.collectionId, generation } };
}

function assertCompleteState(result) {
  assert.equal(result.bytesUsed, fullStateBytes(result.state));
  assert.equal(collectionDraftSessionBytes(result.state), fullStateBytes(result.state));
  assert.equal(result.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(dirtyCollectionSessionCount(result.state) <= MAX_DIRTY_COLLECTION_SESSIONS, true);
  assert.equal(globalCollectionSessionDirty(result.state),
    Object.values(result.state.entries).some(collectionSessionDirty));
}

function opened(n, rows = [], seed = createAdminCollectionDraftSessions(), visit = `visit:${n}`) {
  let step = initializeCollectionDraftSession(seed, id(n), detail(n));
  assert.equal(["APPLIED", "UNCHANGED"].includes(step.code), true);
  step = activateCollectionDraftSession(step.state, id(n), visit);
  assert.equal(step.code, "APPLIED");
  step = acceptCollectionDraftSource(step.state, step.token, detailResult(n), memberResult(rows), "first");
  assert.equal(step.code, "APPLIED");
  return step;
}
function refreshed(step, detailRead, memberRead, pageKey = "refresh") {
  const started = beginCollectionDraftSourceRead(step.state, step.token);
  assert.equal(started.code, "APPLIED");
  return acceptCollectionDraftSource(started.state, started.token,
    detailRead, memberRead, pageKey);
}

test("initialization retains explicit Basic and Membership baselines without a live verification", () => {
  const first = initializeCollectionDraftSession(createAdminCollectionDraftSessions(), id(1), detail(1));
  assert.equal(first.code, "APPLIED");
  assert.equal(entry(first.state, 1).basic.originalDraft.nameEn, "Collection 1");
  assert.equal(entry(first.state, 1).basic.draft.nameEn, "Collection 1");
  assert.deepEqual(entry(first.state, 1).membershipBaseline.entries, {});
  assert.deepEqual(entry(first.state, 1).membership.entries, {});
  assert.equal(entry(first.state, 1).sourceState, "NEEDS_REVALIDATION");
  assert.equal(globalCollectionSessionDirty(first.state), false);
  assert.equal(Object.isFrozen(entry(first.state, 1).membership), true);
  assert.equal(JSON.stringify(first.state).includes("expiresAtMs"), false);
});

test("same UUID, uppercase UUID and repeated Strict Mode initialization do not replace a draft", () => {
  let step = opened(1);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "Unsaved");
  const duplicate = initializeCollectionDraftSession(step.state, id(1).toUpperCase(), detail(1, "Server changed"));
  assert.equal(duplicate.code, "UNCHANGED");
  assert.equal(duplicate.state, step.state);
  assert.equal(entry(duplicate.state, 1).basic.draft.nameEn, "Unsaved");
  const activeAgain = activateCollectionDraftSession(step.state, id(1), "visit:1");
  assert.equal(activeAgain.code, "UNCHANGED");
  assert.equal(activeAgain.token.generation, step.token.generation);
});

test("invalid or mismatched Collection UUID cannot initialize a session", () => {
  const original = createAdminCollectionDraftSessions();
  assert.equal(initializeCollectionDraftSession(original, "bad", detail(1)).code, "INVALID_COLLECTION_ID");
  assert.equal(initializeCollectionDraftSession(original, id(1), detail(2)).code, "INVALID_COLLECTION_ID");
  assert.deepEqual(original.entries, {});
});

test("A and B have independent Basic and Membership state", () => {
  let first = opened(1, [member(201)]);
  let second = opened(2, [member(202)], first.state);
  second = updateCollectionBasicField(second.state, second.token, "nameEn", "B edited");
  const aToken = { collectionId: id(1), generation: entry(second.state, 1).generation };
  const aRemoved = applyCollectionMembershipAction(second.state, aToken,
    { kind: "REMOVE", productId: id(201) });
  assert.equal(aRemoved.code, "APPLIED");
  assert.equal(entry(aRemoved.state, 1).membership.entries[id(201)].removed, true);
  assert.equal(entry(aRemoved.state, 2).membership.entries[id(202)].removed, false);
  assert.equal(entry(aRemoved.state, 1).basic.draft.nameEn, "Collection 1");
  assert.equal(entry(aRemoved.state, 2).basic.draft.nameEn, "B edited");
});

test("ordered atomic Remove then Add retains both changes and a clean baseline", () => {
  let step = opened(2, [member(202)]);
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(202) });
  assert.equal(step.code, "APPLIED");
  const beforeAdd = step.state;
  step = applyCollectionMembershipAction(step.state, step.token, addAction(2, 101, step.token));
  assert.equal(step.code, "APPLIED");
  assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, true);
  assert.equal(entry(step.state, 2).membership.proposedAdds[id(101)].productId, id(101));
  assert.equal(entry(step.state, 2).membershipBaseline.entries[id(202)].removed, false);
  assert.equal(entry(beforeAdd, 2).membership.proposedAdds[id(101)], undefined);
  assert.equal(membershipSessionDirty(entry(step.state, 2)), true);
});

test("multiple Basic transitions use the newest state and derive Dirty from real differences", () => {
  let step = opened(1);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "First");
  step = updateCollectionBasicField(step.state, step.token, "nameZh", "第二");
  assert.equal(entry(step.state, 1).basic.draft.nameEn, "First");
  assert.equal(entry(step.state, 1).basic.draft.nameZh, "第二");
  assert.equal(basicSessionDirty(entry(step.state, 1)), true);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "Collection 1");
  step = updateCollectionBasicField(step.state, step.token, "nameZh", "集合 1");
  assert.equal(basicSessionDirty(entry(step.state, 1)), false);
  assert.equal(globalCollectionSessionDirty(step.state), false);
});

test("Basic and Membership Dirty remain independent and global Dirty is their OR", () => {
  let step = opened(2, [member(202)]);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "B edited");
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(202) });
  assert.equal(basicSessionDirty(entry(step.state, 2)), true);
  assert.equal(membershipSessionDirty(entry(step.state, 2)), true);
  assert.equal(collectionSessionDirty(entry(step.state, 2)), true);
  step = discardCollectionBasic(step.state, step.token);
  assert.equal(basicSessionDirty(entry(step.state, 2)), false);
  assert.equal(membershipSessionDirty(entry(step.state, 2)), true);
  assert.equal(globalCollectionSessionDirty(step.state), true);
  step = discardCollectionMembership(step.state, step.token);
  assert.equal(globalCollectionSessionDirty(step.state), false);
});

test("deactivation and restoration retain drafts but invalidate old source and callbacks", () => {
  let step = opened(2, [member(202)]);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "Return to this");
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(202) });
  const oldToken = step.token;
  step = deactivateCollectionDraftSession(step.state, step.token);
  assert.equal(step.code, "APPLIED");
  assert.equal(globalCollectionSessionDirty(step.state), true);
  assert.equal(entry(step.state, 2).sourceState, "NEEDS_REVALIDATION");
  const repeatedCleanup = deactivateCollectionDraftSession(step.state, oldToken);
  assert.equal(repeatedCleanup.code, "STALE_GENERATION");
  assert.equal(repeatedCleanup.state, step.state);
  assert.equal(applyCollectionMembershipAction(step.state, oldToken, addAction(2, 101, oldToken)).code,
    "STALE_GENERATION");
  step = activateCollectionDraftSession(step.state, id(2), "return:2");
  assert.equal(entry(step.state, 2).basic.draft.nameEn, "Return to this");
  assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, true);
  assert.equal(entry(step.state, 2).sourceState, "NEEDS_REVALIDATION");
  assert.equal(applyCollectionMembershipAction(step.state, step.token, addAction(2, 101, oldToken)).code,
    "SOURCE_NOT_READY");
  step = acceptCollectionDraftSource(step.state, step.token, detailResult(2),
    memberResult([member(202)]), "first");
  assert.equal(step.code, "APPLIED");
  assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, true);
  assert.equal(entry(step.state, 2).sourceState, "COMPLETE");
  const staleEvidence = applyCollectionMembershipAction(step.state, step.token,
    addAction(2, 101, oldToken));
  assert.equal(staleEvidence.code, "STALE_GENERATION");
  assert.equal(staleEvidence.state, step.state);
  assert.equal(entry(staleEvidence.state, 2).membership.proposedAdds[id(101)], undefined);
});

test("source ERROR, INCOMPLETE and NOT_CONNECTED retain drafts but block Add", () => {
  for (const sourceState of ["ERROR", "INCOMPLETE", "NOT_CONNECTED"]) {
    let step = opened(2, [member(202)]);
    step = applyCollectionMembershipAction(step.state, step.token,
      { kind: "REMOVE", productId: id(202) });
    step = refreshed(step, detailResult(2), memberResult([], sourceState), "changed");
    assert.equal(entry(step.state, 2).sourceState, sourceState);
    assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, true);
    const blocked = applyCollectionMembershipAction(step.state, step.token,
      addAction(2, 101, step.token));
    assert.equal(blocked.code, "SOURCE_NOT_READY");
    assert.equal(blocked.state, step.state);
  }
});

test("a forged COMPLETE result without trusted origins cannot reopen the source gate", () => {
  let step = opened(2);
  step = refreshed(step, { ...detailResult(2), origin: "NONE" }, memberResult(), "second");
  assert.equal(entry(step.state, 2).sourceState, "INCOMPLETE");
  step = refreshed(step, detailResult(2), { ...memberResult(), origin: "NONE" }, "third");
  assert.equal(entry(step.state, 2).sourceState, "INCOMPLETE");
});

test("a newly observed changed member records a conflict without dropping local edits", () => {
  let step = opened(2, [member(202, 1)]);
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(202) });
  step = refreshed(step, detailResult(2), memberResult([member(202, 2)]), "new-page");
  assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, true);
  assert.deepEqual(entry(step.state, 2).membership.draftConflicts, [id(202)]);
  assert.equal(applyCollectionMembershipAction(step.state, step.token,
    addAction(2, 101, step.token)).code,
    "ACTION_REJECTED");
});

test("new source read invalidates an old callback before it can replace current evidence", () => {
  const step = opened(2, [member(202)]);
  const started = beginCollectionDraftSourceRead(step.state, step.token);
  assert.equal(started.code, "APPLIED");
  assert.equal(entry(started.state, 2).sourceState, "NEEDS_REVALIDATION");
  const late = acceptCollectionDraftSource(started.state, step.token,
    detailResult(2), memberResult([member(203)]), "late");
  assert.equal(late.code, "STALE_GENERATION");
  assert.equal(late.state, started.state);
  assert.equal(entry(late.state, 2).membership.entries[id(203)], undefined);
  const current = acceptCollectionDraftSource(started.state, started.token,
    detailResult(2), memberResult([member(204)]), "current");
  assert.equal(current.code, "APPLIED");
  assert.equal(entry(current.state, 2).membership.entries[id(204)].original.productId, id(204));
  assert.equal(acceptCollectionDraftSource(current.state, current.token,
    detailResult(2), memberResult([member(205)]), "unsolicited").code, "SOURCE_NOT_READY");
});

test("a source page exceeding payload budget leaves the read paused and cannot reuse old COMPLETE", () => {
  let step = opened(2);
  step = fillBasicToAcceptedLimit(step);
  const started = beginCollectionDraftSourceRead(step.state, step.token);
  assert.equal(started.code, "APPLIED");
  const rejected = acceptCollectionDraftSource(started.state, started.token,
    detailResult(2), memberResult(Array.from({ length: 5 }, (_, index) =>
      member(202 + index))), "larger");
  assert.equal(rejected.code, "PAYLOAD_LIMIT");
  assert.equal(rejected.state, started.state);
  assert.equal(entry(rejected.state, 2).sourceState, "NEEDS_REVALIDATION");
  assert.equal(applyCollectionMembershipAction(rejected.state, rejected.token,
    addAction(2, 101, rejected.token)).code, "SOURCE_NOT_READY");
  const reduced = discardCollectionBasic(rejected.state, rejected.token);
  assert.equal(reduced.code, "APPLIED");
});

test("proposed Adds, pending removal and sort survive a new visit; no live verification survives", () => {
  let step = opened(2, [member(202)]);
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(202) });
  step = applyCollectionMembershipAction(step.state, step.token, addAction(2, 101, step.token));
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "SORT_PROPOSED", productId: id(101), sortOrderText: "-5" });
  step = deactivateCollectionDraftSession(step.state, step.token);
  step = activateCollectionDraftSession(step.state, id(2), "return-again");
  assert.equal(entry(step.state, 2).membership.proposedAdds[id(101)].sortOrderText, "-5");
  assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, true);
  assert.equal(entry(step.state, 2).sourceState, "NEEDS_REVALIDATION");
  const serialized = JSON.stringify(entry(step.state, 2));
  assert.equal(serialized.includes("expiresAtMs"), false);
  assert.equal(serialized.includes("sequence"), false);
  assert.equal(serialized.includes("status\":\"NOT_MEMBER"), false);
  assert.equal(entry(step.state, 2).membership.proposedAdds[id(101)].verificationAtAdd.checkedAtMs, 900);
});

test("three Dirty Collections fit and a fourth Dirty Collection is rejected atomically", () => {
  let state = createAdminCollectionDraftSessions();
  const tokens = [];
  for (let n = 1; n <= MAX_DIRTY_COLLECTION_SESSIONS + 1; n++) {
    const step = opened(n, [], state);
    state = step.state;
    tokens.push(step.token);
  }
  for (let n = 1; n <= MAX_DIRTY_COLLECTION_SESSIONS; n++) {
    const step = updateCollectionBasicField(state, tokens[n - 1], "nameEn", `Dirty ${n}`);
    assert.equal(step.code, "APPLIED");
    state = step.state;
  }
  assert.equal(dirtyCollectionSessionCount(state), MAX_DIRTY_COLLECTION_SESSIONS);
  const before = state;
  const fourth = updateCollectionBasicField(state, tokens[3], "nameEn", "Fourth dirty");
  assert.equal(fourth.code, "DIRTY_COLLECTION_LIMIT");
  assert.equal(fourth.state, before);
  assert.equal(entry(fourth.state, 4).basic.draft.nameEn, "Collection 4");
  assert.equal(dirtyCollectionSessionCount(fourth.state), 3);
});

test("complete-state limit reserves recovery metadata while retaining a strict next-byte boundary", () => {
  let step = opened(1);
  step = fillBasicToAcceptedLimit(step);
  const exactState = step.state;
  const over = updateCollectionBasicField(step.state, step.token,
    "descriptionEn", "A".repeat(step.length + 1));
  assert.equal(over.code, "PAYLOAD_LIMIT");
  assert.equal(over.state, exactState);
  assert.equal(entry(over.state, 1).basic.draft.descriptionEn.length, step.length);
  const departed = deactivateCollectionDraftSession(over.state, over.token);
  assert.equal(departed.code, "APPLIED", "lifecycle metadata has reserved headroom");
  const returned = activateCollectionDraftSession(departed.state, id(1), "new-visit");
  assert.equal(returned.code, "APPLIED", "a full draft remains recoverable");
  assert.equal(entry(returned.state, 1).basic.draft.descriptionEn.length, step.length);
  const discarded = discardCollectionBasic(returned.state, returned.token);
  assert.equal(discarded.code, "APPLIED", "explicit Discard is never blocked by capacity");
  assert.equal(basicSessionDirty(entry(discarded.state, 1)), false);
  const reduce = updateCollectionBasicField(over.state, over.token, "descriptionEn", "short");
  assert.equal(reduce.code, "APPLIED");
  assert.equal(reduce.bytesUsed < MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
});

test("Unicode is measured as UTF-8 bytes, including three-byte Hanzi and four-byte emoji", () => {
  const openedSession = opened(1);
  const base = collectionDraftSessionBytes(openedSession.state);
  const ascii = updateCollectionBasicField(openedSession.state, openedSession.token,
    "descriptionEn", "A");
  const hanzi = updateCollectionBasicField(openedSession.state, openedSession.token,
    "descriptionEn", "甲");
  const emoji = updateCollectionBasicField(openedSession.state, openedSession.token,
    "descriptionEn", "😀");
  assert.equal(ascii.bytesUsed - base, 1);
  assert.equal(hanzi.bytesUsed - base, 3);
  assert.equal(emoji.bytesUsed - base, 4);
  const quote = updateCollectionBasicField(openedSession.state, openedSession.token,
    "descriptionEn", '"');
  const backslash = updateCollectionBasicField(openedSession.state, openedSession.token,
    "descriptionEn", "\\");
  assert.equal(quote.bytesUsed - base, 2);
  assert.equal(backslash.bytesUsed - base, 2);
});

test("a full reserved budget permits Restore without publishing a fifth MiB byte", () => {
  let step = opened(1, [member(201)]);
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(201) });
  step = fillBasicToAcceptedLimit(step);
  const before = step.state;
  const over = updateCollectionBasicField(before, step.token,
    "descriptionEn", "A".repeat(step.length + 1));
  assert.equal(over.code, "PAYLOAD_LIMIT", "the one-byte Restore reserve is mandatory");
  assert.equal(over.state, before);
  assert.equal(over.state.nextGeneration, before.nextGeneration);
  const restored = applyCollectionMembershipAction(before, step.token,
    { kind: "RESTORE", productId: id(201) });
  assert.equal(restored.code, "APPLIED");
  assert.equal(restored.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(restored.bytesUsed, fullStateBytes(restored.state));
  assert.equal(entry(restored.state, 1).membership.entries[id(201)].removed, false);
  assert.equal(restored.token.generation, step.token.generation);
  const clean = discardCollectionBasic(restored.state, restored.token);
  assert.equal(clean.code, "APPLIED");
  assert.equal(globalCollectionSessionDirty(clean.state), false);
});

test("Membership Discard and sort restoration use reserved bytes at the boundary", () => {
  let step = opened(1, [member(201, 2147483647)]);
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "SORT_EXISTING", productId: id(201), sortOrderText: "0" });
  step = fillBasicToAcceptedLimit(step);
  const original = step.state;
  const restored = applyCollectionMembershipAction(original, step.token,
    { kind: "SORT_EXISTING", productId: id(201), sortOrderText: "2147483647" });
  assert.equal(restored.code, "APPLIED");
  assert.equal(restored.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(membershipSessionDirty(entry(restored.state, 1)), false);
  const discarded = discardCollectionMembership(original, step.token);
  assert.equal(discarded.code, "APPLIED");
  assert.equal(discarded.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(membershipSessionDirty(entry(discarded.state, 1)), false);
  assert.equal(original.entries[id(1)].membership.entries[id(201)].sortOrderText, "0");
});

test("a larger original Basic baseline can be discarded without exceeding the cap", () => {
  const large = { ...detail(1), descriptionEn: "Q".repeat(1_000_000) };
  let first = initializeCollectionDraftSession(createAdminCollectionDraftSessions(), id(1), large);
  first = activateCollectionDraftSession(first.state, id(1), "large-original");
  first = acceptCollectionDraftSource(first.state, first.token,
    { ...detailResult(1), item: large }, memberResult(), "first");
  first = updateCollectionBasicField(first.state, first.token, "descriptionEn", "x");
  let second = opened(2, [], first.state);
  second = fillBasicToAcceptedLimit(second, "B");
  const room = second.length;
  const rejected = updateCollectionBasicField(second.state, second.token,
    "descriptionEn", "B".repeat(room + 1));
  assert.equal(rejected.code, "PAYLOAD_LIMIT");
  assert.equal(rejected.state, second.state);
  const discarded = discardCollectionBasic(second.state, first.token);
  assert.equal(discarded.code, "APPLIED");
  assert.equal(discarded.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(entry(discarded.state, 1).basic.draft.descriptionEn, large.descriptionEn);
  assert.equal(entry(discarded.state, 2).basic.draft.descriptionEn, "B".repeat(room));
  assert.equal(globalCollectionSessionDirty(discarded.state), true);
});

test("Discard Current Collection reserves combined Basic and Membership recovery", () => {
  const large = { ...detail(1), descriptionEn: "Q".repeat(400_000) };
  let first = initializeCollectionDraftSession(createAdminCollectionDraftSessions(), id(1), large);
  first = activateCollectionDraftSession(first.state, id(1), "both-recoveries");
  first = acceptCollectionDraftSource(first.state, first.token,
    { ...detailResult(1), item: large }, memberResult([member(201, 2147483647)]), "first");
  first = updateCollectionBasicField(first.state, first.token, "descriptionEn", "x");
  first = applyCollectionMembershipAction(first.state, first.token,
    { kind: "SORT_EXISTING", productId: id(201), sortOrderText: "0" });
  let second = opened(2, [], first.state);
  second = fillBasicToAcceptedLimit(second, "B");
  const room = second.length;
  const discarded = discardCurrentCollection(second.state, first.token);
  assert.equal(discarded.code, "APPLIED");
  assert.equal(discarded.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(collectionSessionDirty(entry(discarded.state, 1)), false);
  assert.equal(entry(discarded.state, 2).basic.draft.descriptionEn.length, room);
  assert.equal(globalCollectionSessionDirty(discarded.state), true);
  assert.notEqual(discarded.token.generation, first.token.generation);
});

test("Cancel Proposed Add and proposed Sort recovery remain available at reserved capacity", () => {
  let step = opened(1);
  step = applyCollectionMembershipAction(step.state, step.token, addAction(1, 101, step.token));
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "SORT_PROPOSED", productId: id(101), sortOrderText: "" });
  step = fillBasicToAcceptedLimit(step);
  const restored = applyCollectionMembershipAction(step.state, step.token,
    { kind: "SORT_PROPOSED", productId: id(101), sortOrderText: "0" });
  assert.equal(restored.code, "APPLIED");
  assert.equal(restored.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  const cancelled = applyCollectionMembershipAction(step.state, step.token,
    { kind: "CANCEL_PROPOSED", productId: id(101) });
  assert.equal(cancelled.code, "APPLIED");
  assert.equal(entry(cancelled.state, 1).membership.proposedAdds[id(101)], undefined);
  assert.equal(cancelled.bytesUsed < MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(entry(step.state, 1).membership.proposedAdds[id(101)].sortOrderText, "");
});

test("Basic original-field restoration and shorter edits preserve recovery headroom", () => {
  let step = opened(1);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "x");
  step = fillBasicToAcceptedLimit(step);
  const shortened = updateCollectionBasicField(step.state, step.token,
    "nameEn", "");
  assert.equal(shortened.code, "APPLIED", "reducing a current field does not consume recovery space");
  const restored = updateCollectionBasicField(step.state, step.token,
    "nameEn", "Collection 1");
  assert.equal(restored.code, "APPLIED");
  assert.equal(restored.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
  assert.equal(entry(restored.state, 1).basic.draft.nameEn, "Collection 1");
});

test("multiple Collections reserve independent recovery paths and Discard frees a Dirty slot", () => {
  let state = createAdminCollectionDraftSessions();
  const tokens = [];
  for (let n = 1; n <= 4; n++) {
    const step = opened(n, n === 2 ? [member(202)] : [], state);
    state = step.state;
    tokens.push(step.token);
  }
  state = updateCollectionBasicField(state, tokens[0], "nameEn", "A dirty").state;
  state = applyCollectionMembershipAction(state, tokens[1],
    { kind: "REMOVE", productId: id(202) }).state;
  state = updateCollectionBasicField(state, tokens[2], "nameEn", "C dirty").state;
  assert.equal(dirtyCollectionSessionCount(state), 3);
  const fourth = updateCollectionBasicField(state, tokens[3], "nameEn", "D dirty");
  assert.equal(fourth.code, "DIRTY_COLLECTION_LIMIT");
  assert.equal(fourth.state, state);
  const discarded = discardCollectionMembership(state, tokens[1]);
  assert.equal(discarded.code, "APPLIED");
  assert.equal(dirtyCollectionSessionCount(discarded.state), 2);
  const allowed = updateCollectionBasicField(discarded.state, tokens[3], "nameEn", "D dirty");
  assert.equal(allowed.code, "APPLIED");
  assert.equal(dirtyCollectionSessionCount(allowed.state), 3);
  assert.equal(entry(allowed.state, 1).basic.draft.nameEn, "A dirty");
  assert.equal(entry(allowed.state, 3).basic.draft.nameEn, "C dirty");
  const removed = discardCollectionById(allowed.state, id(1));
  assert.equal(removed.code, "APPLIED");
  assert.equal(dirtyCollectionSessionCount(removed.state), 2);
  assert.equal(globalCollectionSessionDirty(removed.state), true);
});

test("Clean cleanup releases retained baseline capacity for another Collection", () => {
  const large = { ...detail(1), descriptionEn: "Q".repeat(600_000) };
  let first = initializeCollectionDraftSession(createAdminCollectionDraftSessions(), id(1), large);
  first = activateCollectionDraftSession(first.state, id(1), "clean-large");
  first = acceptCollectionDraftSource(first.state, first.token,
    { ...detailResult(1), item: large }, memberResult(), "first");
  let second = opened(2, [], first.state);
  second = fillBasicToAcceptedLimit(second, "B");
  const room = second.length;
  const blocked = updateCollectionBasicField(second.state, second.token,
    "descriptionEn", "B".repeat(room + 1));
  assert.equal(blocked.code, "PAYLOAD_LIMIT");
  const cleaned = cleanupCleanCollectionSessions(second.state);
  assert.equal(cleaned.code, "APPLIED");
  assert.equal(cleaned.state.entries[id(1)], undefined);
  assert.equal(entry(cleaned.state, 2).basic.draft.descriptionEn.length, room);
  const growth = updateCollectionBasicField(cleaned.state, second.token,
    "descriptionEn", "B".repeat(room + 1));
  assert.equal(growth.code, "APPLIED");
  assert.equal(growth.bytesUsed <= MAX_COLLECTION_DRAFT_SESSION_BYTES, true);
});

test("multiple forward and reverse edits restore actual Dirty without losing siblings", () => {
  let first = opened(1, [member(201)]);
  let second = opened(2, [member(202)], first.state);
  const secondToken = second.token;
  second = updateCollectionBasicField(second.state, second.token, "nameEn", "B1");
  second = updateCollectionBasicField(second.state, second.token, "nameEn", "B2");
  second = applyCollectionMembershipAction(second.state, second.token,
    { kind: "REMOVE", productId: id(202) });
  const firstToken = { collectionId: id(1), generation: entry(second.state, 1).generation };
  second = applyCollectionMembershipAction(second.state, firstToken,
    { kind: "REMOVE", productId: id(201) });
  second = updateCollectionBasicField(second.state, secondToken, "nameEn", "B1");
  second = updateCollectionBasicField(second.state, secondToken, "nameEn", "Collection 2");
  assert.equal(basicSessionDirty(entry(second.state, 2)), false);
  assert.equal(dirtyCollectionSessionCount(second.state), 2);
  second = applyCollectionMembershipAction(second.state, secondToken,
    { kind: "RESTORE", productId: id(202) });
  assert.equal(dirtyCollectionSessionCount(second.state), 1);
  const clean = applyCollectionMembershipAction(second.state, firstToken,
    { kind: "RESTORE", productId: id(201) });
  assert.equal(dirtyCollectionSessionCount(clean.state), 0);
  assert.equal(globalCollectionSessionDirty(clean.state), false);
});

test("runtime unknown actions reject atomically without advancing the session", () => {
  const step = opened(1, [member(201)]);
  const unknown = applyCollectionMembershipAction(step.state, step.token,
    { kind: "UNSUPPORTED", productId: id(201) });
  assert.equal(unknown.code, "ACTION_REJECTED");
  assert.equal(unknown.state, step.state);
  assert.equal(unknown.state.nextGeneration, step.state.nextGeneration);
  assert.equal(entry(unknown.state, 1).membership.entries[id(201)].removed, false);
});

test("a huge initial baseline is rejected without creating or clearing a session", () => {
  const original = createAdminCollectionDraftSessions();
  const huge = { ...detail(1), descriptionEn: "X".repeat(MAX_COLLECTION_DRAFT_SESSION_BYTES) };
  const attempt = initializeCollectionDraftSession(original, id(1), huge);
  assert.equal(attempt.code, "PAYLOAD_LIMIT");
  assert.equal(attempt.state, original);
  assert.deepEqual(attempt.state.entries, {});
});

test("independent Discard operations preserve the other draft and invalidate old callbacks", () => {
  let step = opened(2, [member(202)]);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "Basic draft");
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(202) });
  const oldToken = step.token;
  step = discardCollectionMembership(step.state, step.token);
  assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, false);
  assert.equal(entry(step.state, 2).basic.draft.nameEn, "Basic draft");
  assert.equal(acceptCollectionDraftSource(step.state, oldToken, detailResult(2),
    memberResult(), "late").code, "STALE_GENERATION");
  step = discardCollectionBasic(step.state, step.token);
  assert.equal(entry(step.state, 2).basic.draft.nameEn, "Collection 2");
  assert.equal(globalCollectionSessionDirty(step.state), false);
});

test("Discard Current Collection clears both drafts but retains source blockers", () => {
  let step = opened(2, [member(202)]);
  step = updateCollectionBasicField(step.state, step.token, "nameEn", "Basic draft");
  step = applyCollectionMembershipAction(step.state, step.token,
    { kind: "REMOVE", productId: id(202) });
  step = discardCurrentCollection(step.state, step.token);
  assert.equal(step.code, "APPLIED");
  assert.equal(globalCollectionSessionDirty(step.state), false);
  assert.equal(entry(step.state, 2).membership.entries[id(202)].removed, false);
  assert.equal(entry(step.state, 2).basic.draft.nameEn, "Collection 2");
});

test("source anomalies and the 500-observation blocker survive Discard", () => {
  let duplicate = opened(2, [member(202), member(202)]);
  assert.deepEqual(entry(duplicate.state, 2).membership.sourceAnomalies, ["DUPLICATE_ID"]);
  duplicate = discardCurrentCollection(duplicate.state, duplicate.token);
  assert.deepEqual(entry(duplicate.state, 2).membership.sourceAnomalies, ["DUPLICATE_ID"]);
  assert.equal(applyCollectionMembershipAction(duplicate.state, duplicate.token,
    addAction(2, 101, duplicate.token)).code, "ACTION_REJECTED");

  const rows = Array.from({ length: 501 }, (_, index) => member(1000 + index));
  let capped = opened(1, rows);
  assert.equal(entry(capped.state, 1).membership.limitReached, true);
  capped = discardCollectionMembership(capped.state, capped.token);
  assert.equal(entry(capped.state, 1).membership.limitReached, true);
  assert.equal(applyCollectionMembershipAction(capped.state, capped.token,
    addAction(1, 501, capped.token)).code, "ACTION_REJECTED");
});

test("explicit Discard by UUID never deletes another Collection and prevents stale callbacks", () => {
  let first = opened(1);
  let second = opened(2, [], first.state);
  second = updateCollectionBasicField(second.state, second.token, "nameEn", "Keep B");
  const removed = discardCollectionById(second.state, id(1));
  assert.equal(removed.code, "APPLIED");
  assert.equal(removed.state.entries[id(1)], undefined);
  assert.equal(entry(removed.state, 2).basic.draft.nameEn, "Keep B");
  assert.equal(acceptCollectionDraftSource(removed.state, first.token,
    detailResult(1), memberResult(), "late").code, "NOT_FOUND");
  const reopened = initializeCollectionDraftSession(removed.state, id(1), detail(1));
  assert.notEqual(reopened.token.generation, first.token.generation);
});

test("Clean cleanup preserves Dirty sessions and can protect the mounted clean session", () => {
  let first = opened(1);
  let second = opened(2, [], first.state);
  second = updateCollectionBasicField(second.state, second.token, "nameEn", "B dirty");
  const protectedClean = cleanupCleanCollectionSessions(second.state, id(1));
  assert.equal(protectedClean.code, "UNCHANGED");
  const cleaned = cleanupCleanCollectionSessions(second.state);
  assert.equal(cleaned.code, "APPLIED");
  assert.equal(cleaned.state.entries[id(1)], undefined);
  assert.equal(entry(cleaned.state, 2).basic.draft.nameEn, "B dirty");
  assert.equal(globalCollectionSessionDirty(cleaned.state), true);
});

test("failed capacity and stale generation transitions leave frozen original state intact", () => {
  let step = opened(2, [member(202)]);
  const original = step.state;
  const stale = { collectionId: id(2), generation: step.token.generation - 1 };
  assert.equal(updateCollectionBasicField(original, stale, "nameEn", "bad").state, original);
  assert.equal(applyCollectionMembershipAction(original, stale,
    { kind: "REMOVE", productId: id(202) }).state, original);
  assert.equal(Object.isFrozen(original), true);
  assert.equal(Object.isFrozen(entry(original, 2).membership.entries[id(202)]), true);
  assert.equal(entry(original, 2).membership.entries[id(202)].removed, false);
});

test("full Session State, rather than the old draft projection, is the reported byte count", () => {
  const small = { ...detail(1), slug: "x", nameEn: "x", nameZh: "x",
    sortOrder: 0, createdAt: "x", updatedAt: "x" };
  let step = initializeCollectionDraftSession(createAdminCollectionDraftSessions(), id(1), small);
  step = activateCollectionDraftSession(step.state, id(1), "visit");
  step = acceptCollectionDraftSource(step.state, step.token,
    { ...detailResult(1), item: small }, memberResult(), "p");
  const projectionBytes = (state) => new TextEncoder().encode(JSON.stringify(
    Object.values(state.entries).map((item) => ({ collectionId: item.collectionId,
      basic: item.basic, latestBasicSource: item.latestBasicSource,
      membershipBaseline: item.membershipBaseline, membership: item.membership })))).byteLength;
  const text = "A".repeat(MAX_COLLECTION_DRAFT_SESSION_BYTES - projectionBytes(step.state));
  const oldCandidateEntry = { ...entry(step.state, 1), version: entry(step.state, 1).version + 1,
    basic: { ...entry(step.state, 1).basic,
      draft: { ...entry(step.state, 1).basic.draft, descriptionEn: text } } };
  const oldCandidate = { ...step.state,
    entries: { ...step.state.entries, [id(1)]: oldCandidateEntry } };
  assert.equal(projectionBytes(oldCandidate), MAX_COLLECTION_DRAFT_SESSION_BYTES);
  assert.equal(fullStateBytes(oldCandidate) - MAX_COLLECTION_DRAFT_SESSION_BYTES, 174);
  const rejected = updateCollectionBasicField(step.state, step.token, "descriptionEn", text);
  assert.equal(rejected.code, "PAYLOAD_LIMIT");
  assert.equal(rejected.state, step.state);
  assertCompleteState(rejected);
});

test("an exact 4 MiB complete state is counted, and its next byte is rejected", () => {
  let step = opened(1, [member(201)]);
  step = beginCollectionDraftSourceRead(step.state, step.token);
  const seeded = withCounters(step, 1_000_000_000_000_000, 1_000_000_000_000_000,
    1_000_000_000_000_001);
  seeded.state.entries[id(1)] = { ...seeded.state.entries[id(1)],
    activeVisitKey: "v".repeat(128) };
  const currentOrder = seeded.state.entries[id(1)].membership.entries[id(201)].sortOrderText;
  const length = MAX_COLLECTION_DRAFT_SESSION_BYTES - fullStateBytes(seeded.state) +
    currentOrder.length;
  const exact = applyCollectionMembershipAction(seeded.state, seeded.token,
    { kind: "SORT_EXISTING", productId: id(201), sortOrderText: "9".repeat(length) });
  assert.equal(exact.code, "APPLIED");
  assert.equal(fullStateBytes(exact.state), MAX_COLLECTION_DRAFT_SESSION_BYTES);
  assertCompleteState(exact);
  const over = applyCollectionMembershipAction(seeded.state, seeded.token,
    { kind: "SORT_EXISTING", productId: id(201), sortOrderText: "9".repeat(length + 1) });
  assert.equal(over.code, "PAYLOAD_LIMIT");
  assert.equal(over.state, seeded.state);
  const discarded = discardCollectionMembership(exact.state, exact.token);
  assert.equal(discarded.code, "APPLIED");
  assertCompleteState(discarded);
});

test("visit keys are bounded ASCII data and invalid values cannot advance a visit", () => {
  const step = opened(1);
  const accepted = activateCollectionDraftSession(step.state, id(1), "v".repeat(128));
  assert.equal(accepted.code, "APPLIED");
  assert.equal(accepted.state.entries[id(1)].activeVisitKey.length, 128);
  assert.equal(activateCollectionDraftSession(accepted.state, id(1), "v".repeat(128)).code,
    "UNCHANGED");
  for (const bad of ["", "v".repeat(129), "v".repeat(4_194_305), "bad/key", "汉", null, 42]) {
    const rejected = activateCollectionDraftSession(accepted.state, id(1), bad);
    assert.equal(rejected.code, "ACTION_REJECTED");
    assert.equal(rejected.state, accepted.state);
    assert.equal(rejected.state.nextGeneration, accepted.state.nextGeneration);
    assert.equal(rejected.state.entries[id(1)].activeVisitKey, "v".repeat(128));
  }
  const returned = activateCollectionDraftSession(accepted.state, id(1), "new-visit");
  assert.equal(returned.code, "APPLIED");
  assert.equal(updateCollectionBasicField(returned.state, step.token,
    "nameEn", "stale").code, "STALE_GENERATION");
  assertCompleteState(returned);
});

test("Generation and Version digit growth is measured and old tokens stay stale", () => {
  for (const [prior, next] of [[8, 9], [9, 10], [98, 99], [99, 100]]) {
    const base = withCounters(opened(1), prior - 1, prior - 1, prior);
    const first = activateCollectionDraftSession(base.state, id(1), `visit-${prior}`);
    assert.equal(first.code, "APPLIED");
    assert.equal(first.token.generation, prior);
    const second = activateCollectionDraftSession(first.state, id(1), `visit-${next}`);
    assert.equal(second.code, "APPLIED");
    assert.equal(second.token.generation, next);
    assert.equal(activateCollectionDraftSession(second.state, id(1),
      `visit-${next + 1}`).token.generation, next + 1);
    assert.equal(deactivateCollectionDraftSession(second.state, first.token).code,
      "STALE_GENERATION");
    assertCompleteState(second);
  }
  for (const prior of [9, 99]) {
    const base = withCounters(opened(1), prior, prior, prior + 1);
    const changed = updateCollectionBasicField(base.state, base.token, "nameEn", "changed");
    assert.equal(changed.code, "APPLIED");
    assert.equal(entry(changed.state, 1).version, prior + 1);
    assertCompleteState(changed);
  }
});

test("metadata digit growth at the edit boundary retains room for recovery", () => {
  for (const version of [9, 99]) {
    let step = withCounters(opened(1, [member(201)]), version, version - 1,
      version + 1);
    step = applyCollectionMembershipAction(step.state, step.token,
      { kind: "REMOVE", productId: id(201) });
    assert.equal(step.code, "APPLIED");
    step = fillBasicToAcceptedLimit(step);
    const restored = applyCollectionMembershipAction(step.state, step.token,
      { kind: "RESTORE", productId: id(201) });
    assert.equal(restored.code, "APPLIED");
    assertCompleteState(restored);
    const discarded = discardCurrentCollection(step.state, step.token);
    assert.equal(discarded.code, "APPLIED");
    assertCompleteState(discarded);
  }
});

test("full-state bytes are recalculated after Discard, deletion and Clean cleanup", () => {
  let first = opened(1, [member(201)]);
  let second = opened(2, [], first.state);
  second = updateCollectionBasicField(second.state, second.token, "nameEn", "B dirty");
  assertCompleteState(second);
  const firstToken = { collectionId: id(1), generation: entry(second.state, 1).generation };
  const discarded = discardCurrentCollection(second.state, firstToken);
  assert.equal(discarded.code, "APPLIED");
  assertCompleteState(discarded);
  const cleaned = cleanupCleanCollectionSessions(discarded.state);
  assert.equal(cleaned.code, "APPLIED");
  assertCompleteState(cleaned);
  assert.equal(cleaned.state.entries[id(1)], undefined);
  const deleted = discardCollectionById(cleaned.state, id(2));
  assert.equal(deleted.code, "APPLIED");
  assertCompleteState(deleted);
  const recreated = initializeCollectionDraftSession(deleted.state, id(2), detail(2));
  assert.equal(recreated.code, "APPLIED");
  assertCompleteState(recreated);
  assert.notEqual(recreated.token.generation, second.token.generation);
});

test("three near-capacity Collections can recover Basic and Membership in either order", () => {
  let state = createAdminCollectionDraftSessions();
  for (let n = 1; n <= 3; n++) {
    const initial = { ...detail(n), descriptionEn: "Q".repeat(50_000 * n) };
    let step = initializeCollectionDraftSession(state, id(n), initial);
    step = activateCollectionDraftSession(step.state, id(n), `visit-${n}`);
    step = acceptCollectionDraftSource(step.state, step.token,
      { ...detailResult(n), item: initial }, memberResult([member(200 + n, 2147483647)]),
      `page-${n}`);
    step = updateCollectionBasicField(step.state, step.token, "descriptionEn", "");
    step = applyCollectionMembershipAction(step.state, step.token,
      { kind: "REMOVE", productId: id(200 + n) });
    step = applyCollectionMembershipAction(step.state, step.token,
      { kind: "SORT_EXISTING", productId: id(200 + n), sortOrderText: "0" });
    state = step.state;
  }
  const third = { state, token: { collectionId: id(3), generation: entry(state, 3).generation } };
  const filled = fillBasicToAcceptedLimit(third, "Z");
  assert.equal(dirtyCollectionSessionCount(filled.state), 3);
  for (const order of [[1, 2, 3], [3, 2, 1], [2, 1, 3]]) {
    let current = filled.state;
    for (const n of order) {
      let token = { collectionId: id(n), generation: entry(current, n).generation };
      const basic = discardCollectionBasic(current, token);
      assert.equal(basic.code, "APPLIED");
      assertCompleteState(basic);
      current = basic.state;
      token = { collectionId: id(n), generation: entry(current, n).generation };
      const membership = discardCollectionMembership(current, token);
      assert.equal(membership.code, "APPLIED");
      assertCompleteState(membership);
      current = membership.state;
    }
    assert.equal(globalCollectionSessionDirty(current), false);
  }
});

test("fixed-seed multi-Collection transitions preserve full-state and atomic invariants", () => {
  let state = createAdminCollectionDraftSessions();
  for (let n = 1; n <= 3; n++) state = opened(n, [member(200 + n)], state).state;
  let seed = 0x5a17c3d2;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const trace = [];
  const verify = (previous, result, target, label) => {
    trace.push(`${target}:${label}:${result.code}`);
    try {
      assertCompleteState(result);
      if (result.code !== "APPLIED" && result.code !== "UNCHANGED") {
        assert.equal(result.state, previous);
        assert.equal(result.state.nextGeneration, previous.nextGeneration);
      } else if (result.code === "APPLIED") {
        for (let n = 1; n <= 3; n++) {
          if (n !== target) assert.equal(result.state.entries[id(n)], previous.entries[id(n)]);
        }
        if (result.token) assert.equal(result.token.generation,
          result.state.entries[id(target)].generation);
      }
    } catch (error) {
      error.message += `\nShortest failing prefix (${trace.length} operations): ${trace.join(" -> ")}`;
      throw error;
    }
    return result.state;
  };
  for (let index = 0; index < 600; index++) {
    const target = random() % 3 + 1;
    const kind = random() % 11;
    const token = { collectionId: id(target), generation: entry(state, target).generation };
    const previous = state;
    let next;
    switch (kind) {
      case 0: case 1: case 2:
        next = updateCollectionBasicField(state, token, "descriptionEn",
          kind === 0 ? "" : (kind === 1 ? "甲😀" : '\\"').repeat(random() % 120));
        break;
      case 3: next = discardCollectionBasic(state, token); break;
      case 4: next = applyCollectionMembershipAction(state, token,
        { kind: "REMOVE", productId: id(200 + target) }); break;
      case 5: next = applyCollectionMembershipAction(state, token,
        { kind: "RESTORE", productId: id(200 + target) }); break;
      case 6: next = applyCollectionMembershipAction(state, token,
        { kind: "SORT_EXISTING", productId: id(200 + target),
          sortOrderText: String(random() % 1000 - 500) }); break;
      case 7: next = applyCollectionMembershipAction(state, token,
        addAction(target, 300 + target, token)); break;
      case 8: next = applyCollectionMembershipAction(state, token,
        { kind: "CANCEL_PROPOSED", productId: id(300 + target) }); break;
      case 9: next = discardCollectionMembership(state, token); break;
      default: next = discardCurrentCollection(state, token);
    }
    state = verify(previous, next, target, String(kind));
    if (index % 41 === 0) {
      const beforeRead = state;
      const began = beginCollectionDraftSourceRead(state,
        { collectionId: id(target), generation: entry(state, target).generation });
      state = verify(beforeRead, began, target, "beginSourceRead");
      if (began.code === "APPLIED") {
        const beforeAccept = state;
        const accepted = acceptCollectionDraftSource(state, began.token,
          detailResult(target), memberResult([member(200 + target)]), `page-${index}`);
        state = verify(beforeAccept, accepted, target, "acceptSource");
      }
    }
  }
  assert.equal(trace.length >= 600, true);
});

test("dynamic toJSON, boxed, cyclic and malformed page keys cannot enter Session State", () => {
  let step = opened(1, [member(201)]);
  step = beginCollectionDraftSourceRead(step.state, step.token);
  const before = step.state;
  const previousPages = entry(before, 1).membership.pages;
  let calls = 0;
  const dynamic = { toJSON() { calls++; return calls <= 8 ? "a" : "X".repeat(4_194_305); } };
  const cyclic = {}; cyclic.self = cyclic;
  for (const pageKey of [dynamic, new String("first"), cyclic, "", "A".repeat(520),
    "bad\nkey", "中文"]) {
    const refused = acceptCollectionDraftSource(before, step.token,
      detailResult(1), memberResult([member(202)]), pageKey);
    assert.equal(refused.code, "ACTION_REJECTED");
    assert.equal(refused.state, before);
    assert.equal(refused.state.nextGeneration, before.nextGeneration);
    assert.equal(entry(refused.state, 1).membership.pages, previousPages);
    assert.equal(dirtyCollectionSessionCount(refused.state), dirtyCollectionSessionCount(before));
    assertCompleteState(refused);
  }
  assert.equal(calls, 0, "pageKey toJSON must not execute");
  const accepted = acceptCollectionDraftSource(before, step.token,
    detailResult(1), memberResult([member(202)]), "P".repeat(519));
  assert.equal(accepted.code, "APPLIED");
  assertCompleteState(accepted);
  const refresh = beginCollectionDraftSourceRead(accepted.state, accepted.token);
  const repeated = acceptCollectionDraftSource(refresh.state, refresh.token,
    detailResult(1), memberResult([member(203)]), "P".repeat(519));
  assert.equal(repeated.code, "APPLIED");
  assert.equal(entry(repeated.state, 1).membership.pages.length,
    entry(accepted.state, 1).membership.pages.length);
  assert.equal(entry(repeated.state, 1).membership.entries[id(203)].original.productId, id(203));
});

test("malformed and obsolete Tokens are structured rejections across public token entrypoints", () => {
  const step = opened(1, [member(201)]);
  const before = step.state;
  const badTokens = [null, undefined, {}, { collectionId: "bad", generation: 1 },
    { collectionId: id(1), generation: NaN }, { collectionId: id(1), generation: Infinity },
    { collectionId: id(1), generation: 1.5 },
    { ...step.token, visitKey: "wrong" }];
  const operations = [
    (token) => deactivateCollectionDraftSession(before, token),
    (token) => beginCollectionDraftSourceRead(before, token),
    (token) => acceptCollectionDraftSource(before, token, detailResult(1), memberResult(), "first"),
    (token) => updateCollectionBasicField(before, token, "nameEn", "edit"),
    (token) => applyCollectionMembershipAction(before, token,
      { kind: "REMOVE", productId: id(201) }),
    (token) => discardCollectionBasic(before, token),
    (token) => discardCollectionMembership(before, token),
    (token) => discardCurrentCollection(before, token),
  ];
  for (const token of badTokens) for (const operation of operations) {
    const refused = operation(token);
    assert.equal(refused.code, "ACTION_REJECTED");
    assert.equal(refused.state, before);
    assert.equal(refused.state.nextGeneration, before.nextGeneration);
  }
  const wrongGeneration = updateCollectionBasicField(before,
    { collectionId: id(1), generation: step.token.generation - 1 }, "nameEn", "edit");
  assert.equal(wrongGeneration.code, "STALE_GENERATION");
  const unknownCollection = updateCollectionBasicField(before,
    { collectionId: id(2), generation: step.token.generation }, "nameEn", "edit");
  assert.equal(unknownCollection.code, "NOT_FOUND");
  const nextVisit = activateCollectionDraftSession(before, id(1), "another-visit");
  assert.equal(updateCollectionBasicField(nextVisit.state, step.token,
    "nameEn", "edit").code, "STALE_GENERATION");
  const removed = discardCollectionById(nextVisit.state, id(1));
  const recreated = initializeCollectionDraftSession(removed.state, id(1), detail(1));
  assert.equal(updateCollectionBasicField(recreated.state, step.token,
    "nameEn", "edit").code, "STALE_GENERATION");
});

test("Detail and Source DTOs reject accessors, toJSON, cycles and invalid types without publication", () => {
  const original = createAdminCollectionDraftSessions();
  let getterCalls = 0;
  const withGetter = { ...detail(1) };
  Object.defineProperty(withGetter, "nameEn", { enumerable: true,
    get() { getterCalls++; return "Unsafe"; } });
  const cyclic = { ...detail(1) }; cyclic.nameEn = cyclic;
  const withToJSON = { ...detail(1), toJSON() { throw new Error("SHOULD_NOT_RUN"); } };
  const proxy = new Proxy(detail(1), {});
  for (const bad of [withGetter, cyclic, withToJSON,
    { ...detail(1), sortOrder: NaN }, { ...detail(1), descriptionEn: undefined },
    { ...detail(1), status: "bogus" }, new Date(), proxy]) {
    const refused = initializeCollectionDraftSession(original, id(1), bad);
    assert.equal(refused.code, "ACTION_REJECTED");
    assert.equal(refused.state, original);
    assert.equal(refused.state.nextGeneration, original.nextGeneration);
  }
  assert.equal(getterCalls, 0);

  let step = opened(1);
  step = beginCollectionDraftSourceRead(step.state, step.token);
  const before = step.state;
  const detailGetter = { ...detail(1) };
  Object.defineProperty(detailGetter, "nameEn", { enumerable: true,
    get() { getterCalls++; return "Unsafe"; } });
  const memberGetter = { ...member(202) };
  Object.defineProperty(memberGetter, "productCode", { enumerable: true,
    get() { getterCalls++; return "Unsafe"; } });
  const resultGetter = { ...detailResult(1) };
  Object.defineProperty(resultGetter, "state", { enumerable: true,
    get() { getterCalls++; return "COMPLETE"; } });
  const badSources = [
    [ resultGetter, memberResult() ],
    [ { ...detailResult(1), item: detailGetter }, memberResult() ],
    [ { ...detailResult(1), item: withToJSON }, memberResult() ],
    [ { ...detailResult(1), item: cyclic }, memberResult() ],
    [ detailResult(1), memberResult([memberGetter]) ],
    [ detailResult(1), memberResult([new Proxy(member(202), {})]) ],
    [ detailResult(1), { ...memberResult(), items: [undefined] } ],
    [ detailResult(1), { ...memberResult(), items: [member(202)], toJSON() {
      throw new Error("SHOULD_NOT_RUN"); } } ],
    [ { ...detailResult(1), state: "BOGUS" }, memberResult() ],
    [ detailResult(1), { ...memberResult(), nextCursor: undefined } ],
  ];
  for (const [detailSource, memberSource] of badSources) {
    const refused = acceptCollectionDraftSource(before, step.token,
      detailSource, memberSource, "first");
    assert.equal(refused.code, "ACTION_REJECTED");
    assert.equal(refused.state, before);
    assert.equal(refused.state.nextGeneration, before.nextGeneration);
  }
  assert.equal(getterCalls, 0, "ordinary DTO getters must not run");
});

test("accepted DTOs are scalar snapshots with no shared mutable source references", () => {
  const source = detail(1);
  const created = initializeCollectionDraftSession(createAdminCollectionDraftSessions(), id(1), source);
  assert.equal(created.code, "APPLIED");
  source.nameEn = "Changed after initialization";
  assert.equal(entry(created.state, 1).basic.original.nameEn, "Collection 1");
  let step = activateCollectionDraftSession(created.state, id(1), "visit:1");
  const detailSource = detailResult(1);
  const memberSource = memberResult([member(201)]);
  step = acceptCollectionDraftSource(step.state, step.token, detailSource, memberSource, "first");
  assert.equal(step.code, "APPLIED");
  detailSource.item.nameEn = "Changed after acceptance";
  memberSource.items[0].productCode = "Changed after acceptance";
  memberSource.items.push(member(202));
  assert.equal(entry(step.state, 1).latestBasicSource.nameEn, "Collection 1");
  assert.equal(entry(step.state, 1).membership.entries[id(201)].original.productCode, "P-201");
  assert.equal(entry(step.state, 1).membership.entries[id(202)], undefined);
  assert.equal(Object.isFrozen(entry(step.state, 1).latestBasicSource), true);
  assert.equal(Object.isFrozen(entry(step.state, 1).membership.entries[id(201)].original), true);
  assert.throws(() => { entry(step.state, 1).membership.entries[id(201)].original.productCode = "bad"; },
    TypeError);
  assertCompleteState(step);
});

test("shared source row identities are copied and duplicate evidence remains visible", () => {
  let step = opened(1);
  step = beginCollectionDraftSourceRead(step.state, step.token);
  const shared = member(202);
  const source = memberResult([shared, shared]);
  const accepted = acceptCollectionDraftSource(step.state, step.token,
    detailResult(1), source, "shared-row");
  assert.equal(accepted.code, "APPLIED");
  assert.deepEqual(entry(accepted.state, 1).membership.sourceAnomalies, ["DUPLICATE_ID"]);
  shared.productCode = "Changed after acceptance";
  assert.equal(entry(accepted.state, 1).membership.entries[id(202)].original.productCode,
    "P-202");
  assertCompleteState(accepted);
});

test("missing runtime clone gate fails closed before external DTOs are retained", () => {
  const originalClone = globalThis.structuredClone;
  try {
    globalThis.structuredClone = undefined;
    const state = createAdminCollectionDraftSessions();
    const refused = initializeCollectionDraftSession(state, id(1), detail(1));
    assert.equal(refused.code, "ACTION_REJECTED");
    assert.equal(refused.state, state);
    assert.equal(refused.state.nextGeneration, state.nextGeneration);
  } finally { globalThis.structuredClone = originalClone; }
});

test("invalid Sort action data cannot retain a dynamic serializer", () => {
  const step = opened(1, [member(201)]);
  const before = step.state;
  let calls = 0;
  const dynamic = { toJSON() { calls++; return "X".repeat(4_194_305); } };
  for (const action of [
    { kind: "SORT_EXISTING", productId: id(201), sortOrderText: dynamic },
    { kind: "SORT_EXISTING", productId: id(201), get sortOrderText() {
      calls++; return "0"; } },
  ]) {
    const refused = applyCollectionMembershipAction(before, step.token, action);
    assert.equal(refused.code, "ACTION_REJECTED");
    assert.equal(refused.state, before);
    assert.equal(refused.state.nextGeneration, before.nextGeneration);
  }
  assert.equal(calls, 0);
});
