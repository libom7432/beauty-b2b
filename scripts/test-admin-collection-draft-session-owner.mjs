import assert from "node:assert/strict";
import test from "node:test";
import { createCollectionDraftSessionOwner } from
  "../src/lib/admin/collection-draft-session-owner.ts";
import { MAX_COLLECTION_DRAFT_SESSION_BYTES } from
  "../src/lib/admin/collection-draft-session.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const detail = (n, name = `Collection ${n}`) => ({
  state: "COMPLETE", origin: "OFFLINE_FIXTURE", issues: [],
  item: { id: id(n), slug: `collection-${n}`, nameEn: name, nameZh: `集合 ${n}`,
    descriptionEn: "", descriptionZh: "", status: "draft", sortOrder: n,
    publishedAt: null, createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z" },
});
const open = (owner, n, visit = `visit:${n}`) => {
  const first = owner.enter(id(n), visit, detail(n));
  assert.ok(first);
  const accepted = owner.acceptDetail(id(n), visit, first, detail(n));
  assert.equal(accepted.code, "APPLIED");
  return accepted.token;
};
const entry = (owner, n) => owner.getSnapshot().state.entries[id(n)];
const members = (product = 202) => ({ state: "COMPLETE", origin: "OFFLINE_FIXTURE",
  items: [{ productId: id(product), productCode: `FAMILY-${product}`, nameEn: `Product ${product}`,
    nameZh: null, productStatus: "published", sortOrder: 0 }], issues: [],
  nextCursor: null, previousCursor: null });
const source = (n, product = 202, pageKey = "first") => ({ collectionId: id(n), pageKey,
  detail: detail(n), members: members(product) });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

test("one Shell owner applies ordered Basic edits synchronously and derives global Dirty", () => {
  const owner = createCollectionDraftSessionOwner();
  let notifications = 0;
  const unsubscribe = owner.subscribe(() => { notifications++; });
  open(owner, 1);
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "First"), "APPLIED");
  assert.equal(owner.editBasic(id(1), "visit:1", "nameZh", "第二"), "APPLIED");
  assert.equal(entry(owner, 1).basic.draft.nameEn, "First");
  assert.equal(entry(owner, 1).basic.draft.nameZh, "第二");
  assert.equal(owner.getGlobalDirty(), true);
  assert.ok(notifications >= 4);
  const savedSnapshot = owner.getSnapshot();
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "First"), "UNCHANGED");
  assert.equal(owner.getSnapshot(), savedSnapshot);
  unsubscribe();
});

test("leaving and returning to the same UUID keeps Basic; stale visits cannot write", () => {
  const owner = createCollectionDraftSessionOwner();
  const oldToken = open(owner, 1);
  owner.editBasic(id(1), "visit:1", "nameEn", "Unsaved");
  owner.leave(id(1), "visit:1");
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Unsaved");
  assert.equal(entry(owner, 1).sourceState, "NEEDS_REVALIDATION");
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "Late edit"), "STALE_GENERATION");
  const visit2 = owner.enter(id(1), "visit:return", detail(1, "Server changed"));
  assert.ok(visit2);
  assert.notEqual(visit2.generation, oldToken.generation);
  assert.equal(owner.acceptDetail(id(1), "visit:1", oldToken, detail(1)).code,
    "STALE_GENERATION");
  assert.equal(owner.acceptDetail(id(1), "visit:return", visit2,
    detail(1, "Server changed")).code, "APPLIED");
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Unsaved");
  assert.equal(entry(owner, 1).basicSourceChanged, true);
  assert.equal(owner.editBasic(id(1), "visit:return", "nameZh", "New"), "SOURCE_NOT_READY");
  assert.equal(owner.getGlobalDirty(), true);
});

test("two owners and different Collection UUIDs never share a draft", () => {
  const first = createCollectionDraftSessionOwner();
  const second = createCollectionDraftSessionOwner();
  open(first, 1);
  open(first, 2);
  first.editBasic(id(1), "visit:1", "nameEn", "A only");
  first.editBasic(id(2), "visit:2", "nameEn", "B only");
  assert.equal(entry(first, 1).basic.draft.nameEn, "A only");
  assert.equal(entry(first, 2).basic.draft.nameEn, "B only");
  assert.equal(second.getGlobalDirty(), false);
  open(second, 1);
  assert.equal(entry(second, 1).basic.draft.nameEn, "Collection 1");
  first.leave(id(1), "visit:1");
  assert.equal(entry(first, 2).basic.draft.nameEn, "B only");
});

test("Discard clears only Basic and advances token while preserving other drafts", () => {
  const owner = createCollectionDraftSessionOwner();
  open(owner, 1);
  open(owner, 2);
  owner.editBasic(id(1), "visit:1", "nameEn", "A changed");
  owner.editBasic(id(2), "visit:2", "nameEn", "B changed");
  const old = entry(owner, 1).generation;
  const discarded = owner.discardBasic(id(1), "visit:1");
  assert.equal(discarded.code, "APPLIED");
  assert.notEqual(discarded.token.generation, old);
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Collection 1");
  assert.equal(entry(owner, 2).basic.draft.nameEn, "B changed");
  assert.equal(owner.getGlobalDirty(), true);
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "A again"), "APPLIED");
  assert.equal(owner.getSnapshot().state.entries[id(1)].membership.proposedAdds[id(101)], undefined);
});

test("fourth Dirty Collection rejects atomically, and Discard frees a slot", () => {
  const owner = createCollectionDraftSessionOwner();
  for (let n = 1; n <= 4; n++) open(owner, n);
  for (let n = 1; n <= 3; n++)
    assert.equal(owner.editBasic(id(n), `visit:${n}`, "nameEn", `Dirty ${n}`), "APPLIED");
  const priorState = owner.getSnapshot().state;
  assert.equal(owner.editBasic(id(4), "visit:4", "nameEn", "Fourth"),
    "DIRTY_COLLECTION_LIMIT");
  assert.equal(owner.getSnapshot().state, priorState);
  assert.equal(owner.getSnapshot().capacityErrors[id(4)], "DIRTY_COLLECTION_LIMIT");
  assert.equal(entry(owner, 4).basic.draft.nameEn, "Collection 4");
  assert.equal(owner.discardBasic(id(1), "visit:1").code, "APPLIED");
  assert.equal(owner.editBasic(id(4), "visit:4", "nameEn", "Fourth"), "APPLIED");
  assert.equal(owner.getSnapshot().capacityErrors[id(4)], undefined);
  assert.equal(entry(owner, 2).basic.draft.nameEn, "Dirty 2");
});

test("payload rejection leaves prior Basic draft and generation untouched", () => {
  const owner = createCollectionDraftSessionOwner();
  open(owner, 1);
  owner.editBasic(id(1), "visit:1", "nameEn", "Keep me");
  const prior = owner.getSnapshot().state;
  assert.equal(owner.editBasic(id(1), "visit:1", "descriptionEn",
    "x".repeat(MAX_COLLECTION_DRAFT_SESSION_BYTES)), "PAYLOAD_LIMIT");
  assert.equal(owner.getSnapshot().state, prior);
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Keep me");
  assert.equal(owner.getSnapshot().capacityErrors[id(1)], "PAYLOAD_LIMIT");
  assert.equal(owner.discardBasic(id(1), "visit:1").code, "APPLIED");
  assert.equal(owner.getGlobalDirty(), false);
  assert.equal(owner.cleanupClean(), "APPLIED");
  assert.equal(Object.keys(owner.getSnapshot().state.entries).length, 0);
});

test("oversized initial source is rejected with an observable capacity error", () => {
  const owner = createCollectionDraftSessionOwner();
  const oversized = detail(1);
  oversized.item.descriptionEn = "x".repeat(MAX_COLLECTION_DRAFT_SESSION_BYTES);
  assert.equal(owner.enter(id(1), "visit:1", oversized), null);
  assert.equal(owner.getSnapshot().capacityErrors[id(1)], "PAYLOAD_LIMIT");
  assert.equal(owner.getSnapshot().state.entries[id(1)], undefined);
  assert.equal(owner.getGlobalDirty(), false);
});

test("source failures never supply reusable verification or overwrite a dirty Basic draft", () => {
  const owner = createCollectionDraftSessionOwner();
  open(owner, 1);
  owner.editBasic(id(1), "visit:1", "nameEn", "Keep me");
  const old = entry(owner, 1).generation;
  const failure = owner.acceptDetail(id(1), "visit:1",
    { collectionId: id(1), generation: old },
    { state: "NOT_CONNECTED", item: null, issues: [], origin: "NONE" });
  assert.equal(failure.code, "APPLIED");
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Keep me");
  assert.equal(entry(owner, 1).sourceState, "NOT_CONNECTED");
  assert.equal(owner.editBasic(id(1), "visit:1", "nameZh", "No"), "SOURCE_NOT_READY");
  assert.equal(JSON.stringify(owner.getSnapshot()).includes("expiresAtMs"), false);
});

test("identity lock rejects edits and source responses; destruction permanently clears the owner", () => {
  const owner = createCollectionDraftSessionOwner(false);
  assert.equal(owner.enter(id(1), "visit:1", detail(1)), null);
  owner.unlock();
  const token = open(owner, 1);
  owner.editBasic(id(1), "visit:1", "nameEn", "Private A");
  owner.lock();
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "Late A"), "STALE_GENERATION");
  assert.equal(owner.acceptDetail(id(1), "visit:1", token, detail(1, "Late source")).code,
    "STALE_GENERATION");
  owner.destroy();
  assert.equal(owner.getGlobalDirty(), false);
  assert.deepEqual(owner.getSnapshot().state.entries, {});
  owner.unlock();
  assert.equal(owner.enter(id(1), "visit:2", detail(1)), null);
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "After destroy"),
    "STALE_GENERATION");
});

test("a lock invalidates saved Catalog callbacks even after the same owner unlocks", () => {
  const owner = createCollectionDraftSessionOwner(false);
  const initialEpoch = owner.getAccessEpoch();
  assert.equal(owner.isCurrentAccess(initialEpoch), false);
  owner.unlock();
  assert.equal(owner.isCurrentAccess(initialEpoch), true);
  owner.lock();
  assert.equal(owner.isCurrentAccess(initialEpoch), false);
  const nextEpoch = owner.getAccessEpoch();
  assert.notEqual(nextEpoch, initialEpoch);
  owner.unlock();
  assert.equal(owner.isCurrentAccess(initialEpoch), false);
  assert.equal(owner.isCurrentAccess(nextEpoch), true);
  owner.destroy();
  assert.equal(owner.isCurrentAccess(nextEpoch), false);
});

test("a suspended visit cannot publish a late source after the same identity resumes", () => {
  const owner = createCollectionDraftSessionOwner();
  const token = open(owner, 1);
  owner.editBasic(id(1), "visit:1", "nameEn", "Keep local");
  owner.lock();
  owner.leave(id(1), "visit:1");
  owner.unlock();
  assert.equal(owner.acceptDetail(id(1), "visit:1", token, detail(1, "Late source")).code,
    "STALE_GENERATION");
  const resumed = owner.enter(id(1), "visit:2", detail(1));
  assert.ok(resumed);
  assert.equal(owner.acceptDetail(id(1), "visit:2", resumed, detail(1)).code, "APPLIED");
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Keep local");
});

test("member source is bound before request start and preserves the Basic draft", async () => {
  const urls = [];
  const owner = createCollectionDraftSessionOwner(true, async (url) => {
    urls.push(url); return source(1);
  });
  open(owner, 1);
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "Unsaved"), "APPLIED");
  const epoch = owner.getAccessEpoch();
  const accepted = await owner.loadMemberSource(id(1), "visit:1", epoch, "first");
  assert.equal(accepted.code, "APPLIED");
  assert.equal(entry(owner, 1).sourceState, "COMPLETE");
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Unsaved");
  assert.ok(entry(owner, 1).membership.entries[id(202)]);
  assert.deepEqual(urls, [`/api/admin/collections/${id(1)}/member-source`]);
});

test("late old-visit member source cannot enter a new visit or another Collection", async () => {
  const old = deferred();
  const owner = createCollectionDraftSessionOwner(true, async () => old.promise);
  open(owner, 1);
  owner.editBasic(id(1), "visit:1", "nameEn", "Keep local");
  const pending = owner.loadMemberSource(id(1), "visit:1", owner.getAccessEpoch(), "first");
  assert.equal(entry(owner, 1).sourceState, "NEEDS_REVALIDATION");
  owner.leave(id(1), "visit:1");
  const next = owner.enter(id(1), "visit:2", detail(1));
  assert.ok(next);
  owner.acceptDetail(id(1), "visit:2", next, detail(1));
  open(owner, 2);
  old.resolve(source(1));
  assert.equal((await pending).code, "STALE_GENERATION");
  assert.equal(entry(owner, 1).membership.entries[id(202)], undefined);
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Keep local");
  assert.equal(entry(owner, 2).membership.entries[id(202)], undefined);
});

test("a newer source request supersedes an older page response", async () => {
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const owner = createCollectionDraftSessionOwner(true, async () =>
    ++calls === 1 ? first.promise : second.promise);
  open(owner, 1);
  const epoch = owner.getAccessEpoch();
  const old = owner.loadMemberSource(id(1), "visit:1", epoch, "first");
  const newer = owner.loadMemberSource(id(1), "visit:1", epoch, "first");
  second.resolve(source(1, 203));
  assert.equal((await newer).code, "APPLIED");
  first.resolve(source(1, 202));
  assert.equal((await old).code, "STALE_GENERATION");
  assert.ok(entry(owner, 1).membership.entries[id(203)]);
  assert.equal(entry(owner, 1).membership.entries[id(202)], undefined);
});

test("identity lock, invalid envelope, and wrong page never publish member source", async () => {
  const delayed = deferred();
  const owner = createCollectionDraftSessionOwner(true, async () => delayed.promise);
  open(owner, 1);
  const epoch = owner.getAccessEpoch();
  const pending = owner.loadMemberSource(id(1), "visit:1", epoch, "first");
  owner.lock();
  owner.unlock();
  delayed.resolve(source(1));
  assert.equal((await pending).code, "STALE_GENERATION");
  assert.equal(entry(owner, 1).membership.entries[id(202)], undefined);
  assert.equal((await owner.loadMemberSource(id(1), "visit:1", epoch, "first")).code,
    "STALE_GENERATION");
  const bad = createCollectionDraftSessionOwner(true, async () => source(1, 202, "other"));
  open(bad, 1);
  const result = await bad.loadMemberSource(id(1), "visit:1", bad.getAccessEpoch(), "first");
  assert.equal(result.code, "ACTION_REJECTED");
  assert.equal(entry(bad, 1).sourceState, "NEEDS_REVALIDATION");
  assert.equal(entry(bad, 1).membership.entries[id(202)], undefined);
});

test("source errors and payload limits stay blocked without losing accepted edits", async () => {
  const errorSource = { ...source(1), members: { ...members(), state: "ERROR", origin: "NONE",
    items: [] } };
  const owner = createCollectionDraftSessionOwner(true, async () => errorSource);
  open(owner, 1);
  owner.editBasic(id(1), "visit:1", "nameEn", "Keep local");
  assert.equal((await owner.loadMemberSource(id(1), "visit:1",
    owner.getAccessEpoch(), "first")).code, "APPLIED");
  assert.equal(entry(owner, 1).sourceState, "ERROR");
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Keep local");
  const oversized = createCollectionDraftSessionOwner(true, async () => ({ ...source(1),
    members: { ...members(), items: [{ ...members().items[0],
      nameEn: "x".repeat(MAX_COLLECTION_DRAFT_SESSION_BYTES) }] } }));
  open(oversized, 1);
  const before = oversized.getSnapshot().state;
  const rejected = await oversized.loadMemberSource(id(1), "visit:1",
    oversized.getAccessEpoch(), "first");
  assert.equal(rejected.code, "PAYLOAD_LIMIT");
  assert.equal(oversized.getSnapshot().state.entries[id(1)].sourceState, "NEEDS_REVALIDATION");
  assert.equal(oversized.getSnapshot().state.entries[id(1)].membership.entries[id(202)], undefined);
  assert.notEqual(oversized.getSnapshot().state, before); // begin-read invalidates old evidence.
});

test("Membership actions use one atomic Owner draft and preserve Basic Dirty", async () => {
  const owner = createCollectionDraftSessionOwner(true, async () => source(1));
  open(owner, 1);
  assert.equal((await owner.loadMemberSource(id(1), "visit:1",
    owner.getAccessEpoch(), "first")).code, "APPLIED");
  const epoch = owner.getAccessEpoch();
  const generation = entry(owner, 1).generation;
  const action = (value) => owner.membershipAction(id(1), "visit:1", epoch, generation, value);
  assert.equal(owner.editBasic(id(1), "visit:1", "nameEn", "Unsaved Basic"), "APPLIED");
  assert.equal(action({ kind: "REMOVE", productId: id(202) }), "APPLIED");
  assert.equal(action({ kind: "SORT_EXISTING", productId: id(202), sortOrderText: "-7" }), "APPLIED");
  assert.equal(entry(owner, 1).membership.entries[id(202)].removed, true);
  assert.equal(entry(owner, 1).membership.entries[id(202)].sortOrderText, "-7");
  assert.equal(action({ kind: "RESTORE", productId: id(202) }), "APPLIED");
  const add = { kind: "ADD_PROPOSED",
    candidate: { productId: id(101), productCode: "FAMILY-101", displayName: "Candidate 101",
      status: "draft" },
    verification: { collectionId: id(1), productId: id(101), status: "NOT_MEMBER",
      origin: "OFFLINE_FIXTURE", viewKey: "view:1", checkedAtMs: 1000,
      expiresAtMs: 31000 },
    context: { collectionId: id(1), viewKey: "view:1", nowMs: 1500,
      sourceState: "COMPLETE" }, verificationGeneration: generation };
  assert.equal(action(add), "APPLIED");
  assert.equal(action(add), "ACTION_REJECTED");
  assert.equal(action({ kind: "SORT_PROPOSED", productId: id(101), sortOrderText: "5" }), "APPLIED");
  assert.equal(entry(owner, 1).membership.proposedAdds[id(101)].sortOrderText, "5");
  assert.equal(action({ kind: "CANCEL_PROPOSED", productId: id(101) }), "APPLIED");
  assert.equal(entry(owner, 1).membership.proposedAdds[id(101)], undefined);
  assert.equal(owner.getGlobalDirty(), true);
  assert.equal(owner.discardMembership(id(1), "visit:1", epoch, generation), "APPLIED");
  assert.equal(entry(owner, 1).membership.entries[id(202)].removed, false);
  assert.equal(entry(owner, 1).basic.draft.nameEn, "Unsaved Basic");
  assert.equal(owner.membershipAction(id(1), "visit:1", epoch, generation,
    { kind: "REMOVE", productId: id(202) }), "STALE_GENERATION");
  assert.equal(owner.getGlobalDirty(), true);
  assert.equal(owner.discardBasic(id(1), "visit:1").code, "APPLIED");
  assert.equal(owner.getGlobalDirty(), false);
});

test("old Membership callbacks cannot write after a visit change or identity lock", async () => {
  const owner = createCollectionDraftSessionOwner(true, async () => source(1));
  open(owner, 1);
  await owner.loadMemberSource(id(1), "visit:1", owner.getAccessEpoch(), "first");
  const epoch = owner.getAccessEpoch();
  const generation = entry(owner, 1).generation;
  const remove = () => owner.membershipAction(id(1), "visit:1", epoch, generation,
    { kind: "REMOVE", productId: id(202) });
  owner.lock();
  assert.equal(remove(), "STALE_GENERATION");
  owner.unlock();
  assert.equal(remove(), "STALE_GENERATION");
  owner.leave(id(1), "visit:1");
  const token = owner.enter(id(1), "visit:2", detail(1));
  assert.ok(token);
  assert.equal(owner.acceptDetail(id(1), "visit:2", token, detail(1)).code, "APPLIED");
  assert.equal(remove(), "STALE_GENERATION");
  assert.equal(entry(owner, 1).membership.entries[id(202)].removed, false);
});

test("Membership writes obey the three-Collection and 4 MiB limits atomically", async () => {
  const owner = createCollectionDraftSessionOwner(true, async (url) =>
    source(Number(url.match(/([0-9]{8})-0000-4000/)?.[1] ?? 1)));
  for (let n = 1; n <= 4; n++) {
    open(owner, n);
    assert.equal((await owner.loadMemberSource(id(n), `visit:${n}`,
      owner.getAccessEpoch(), "first")).code, "APPLIED");
  }
  const epoch = owner.getAccessEpoch();
  const remove = (n) => owner.membershipAction(id(n), `visit:${n}`, epoch,
    entry(owner, n).generation, { kind: "REMOVE", productId: id(202) });
  for (let n = 1; n <= 3; n++) assert.equal(remove(n), "APPLIED");
  const before = owner.getSnapshot().state;
  assert.equal(remove(4), "DIRTY_COLLECTION_LIMIT");
  assert.equal(owner.getSnapshot().state, before);
  assert.equal(entry(owner, 4).membership.entries[id(202)].removed, false);
  assert.equal(owner.discardMembership(id(1), "visit:1", epoch,
    entry(owner, 1).generation), "APPLIED");
  assert.equal(remove(4), "APPLIED");
  const payloadBefore = owner.getSnapshot().state;
  const code = owner.membershipAction(id(4), "visit:4", epoch,
    entry(owner, 4).generation, { kind: "SORT_EXISTING", productId: id(202),
      sortOrderText: "x".repeat(MAX_COLLECTION_DRAFT_SESSION_BYTES) });
  assert.equal(code, "PAYLOAD_LIMIT");
  assert.equal(owner.getSnapshot().state, payloadBefore);
  assert.equal(entry(owner, 4).membership.entries[id(202)].sortOrderText, "0");
});

test("a new member read invalidates old Membership actions without erasing the draft", async () => {
  let currentSource = source(1);
  const owner = createCollectionDraftSessionOwner(true, async () => currentSource);
  open(owner, 1);
  const epoch = owner.getAccessEpoch();
  await owner.loadMemberSource(id(1), "visit:1", epoch, "first");
  const oldGeneration = entry(owner, 1).generation;
  assert.equal(owner.membershipAction(id(1), "visit:1", epoch, oldGeneration,
    { kind: "REMOVE", productId: id(202) }), "APPLIED");
  currentSource = { ...source(1), members: { ...members(), state: "ERROR", origin: "NONE",
    items: [] } };
  assert.equal((await owner.loadMemberSource(id(1), "visit:1", epoch, "first")).code,
    "APPLIED");
  assert.equal(entry(owner, 1).sourceState, "ERROR");
  assert.equal(entry(owner, 1).membership.entries[id(202)].removed, true);
  const before = owner.getSnapshot().state;
  assert.equal(owner.membershipAction(id(1), "visit:1", epoch, oldGeneration,
    { kind: "RESTORE", productId: id(202) }), "STALE_GENERATION");
  assert.equal(owner.getSnapshot().state, before);
  const newGeneration = entry(owner, 1).generation;
  assert.equal(owner.membershipAction(id(1), "visit:1", epoch, newGeneration,
    { kind: "ADD_PROPOSED", candidate: { productId: id(101), productCode: "FAMILY-101",
      displayName: "Candidate 101", status: "draft" },
    verification: { collectionId: id(1), productId: id(101), status: "NOT_MEMBER",
      origin: "OFFLINE_FIXTURE", viewKey: "view:1", checkedAtMs: 1000,
      expiresAtMs: 31000 },
    context: { collectionId: id(1), viewKey: "view:1", nowMs: 1500,
      sourceState: "COMPLETE" }, verificationGeneration: newGeneration }), "SOURCE_NOT_READY");
  assert.equal(entry(owner, 1).membership.proposedAdds[id(101)], undefined);
});
