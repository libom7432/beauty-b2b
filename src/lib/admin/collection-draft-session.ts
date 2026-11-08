import type { AdminCollectionDetail, AdminCollectionDetailResult,
  AdminCollectionMemberListResult, AdminCollectionReadState } from "../catalog-read/types.ts";
import { collectionBasicFingerprint, collectionBasicSourceChanged,
  createCollectionBasicSelection, type CollectionBasicDraft,
  type CollectionBasicSelection } from "./collection-basic-editor-draft.ts";
import { addProposedMember, cancelProposedMember, changeMembershipOrder,
  changeProposedMemberOrder, createMembershipDraft, discardMembershipDraft,
  ingestMembershipPage, markMembershipRemoved, membershipIsDirty,
  type MembershipDraft, type ProposedMemberCandidate,
  type ProposedMemberContext, type ProposedMemberVerification } from "./collection-membership-draft.ts";

export const MAX_DIRTY_COLLECTION_SESSIONS = 3;
export const MAX_COLLECTION_DRAFT_SESSION_BYTES = 4 * 1024 * 1024;
const MAX_VISIT_KEY_LENGTH = 128;
const VISIT_KEY = /^[A-Za-z0-9:_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASIC_FIELDS = ["nameEn", "nameZh", "descriptionEn", "descriptionZh",
  "slug", "status", "sortOrderText"] as const;
const BASIC_FIELD_SET = new Set<string>(BASIC_FIELDS);
/** "first" or direction + ":" + a signed cursor of at most 512 characters. */
const MAX_PAGE_KEY_LENGTH = 519;
const PAGE_KEY = /^[\x20-\x7e]+$/;
const DETAIL_FIELDS = ["id", "slug", "nameEn", "nameZh", "descriptionEn",
  "descriptionZh", "status", "sortOrder", "publishedAt", "createdAt", "updatedAt"] as const;
const MEMBER_FIELDS = ["productId", "productCode", "nameEn", "nameZh",
  "productStatus", "sortOrder"] as const;
const READ_STATES = new Set(["COMPLETE", "INCOMPLETE", "NOT_CONNECTED", "ERROR",
  "NOT_FOUND", "EMPTY_PAGE"]);
const ORIGINS = new Set(["OFFLINE_FIXTURE", "READ_ONLY_DATABASE", "NONE"]);
const ISSUE_CODES = new Set(["INVALID_ROW", "DUPLICATE_ID", "UNSORTED",
  "BOUNDARY_MISMATCH", "OVER_LIMIT", "SOURCE_INCOMPLETE", "MISSING_PRODUCT",
  "ID_MISMATCH", "STALE_CURSOR", "MISSING_WINDOW_EVIDENCE", "WINDOW_MISMATCH",
  "NAVIGATION_UNAVAILABLE"]);

/** This is browser-memory draft data, not a source authorization or a GET verification cache. */
export type CollectionDraftSessionEntry = Readonly<{
  collectionId: string;
  generation: number;
  version: number;
  activeVisitKey: string | null;
  basic: CollectionBasicSelection | null;
  latestBasicSource: AdminCollectionDetail | null;
  membershipBaseline: MembershipDraft;
  membership: MembershipDraft;
  sourceState: "NEEDS_REVALIDATION" | AdminCollectionReadState;
  basicSourceChanged: boolean;
}>;
export type AdminCollectionDraftSessions = Readonly<{
  entries: Readonly<Record<string, CollectionDraftSessionEntry>>;
  nextGeneration: number;
}>;
export type CollectionDraftSessionToken = Readonly<{ collectionId: string; generation: number }>;
export type CollectionDraftSessionCode = "APPLIED" | "UNCHANGED" | "INVALID_COLLECTION_ID" |
  "NOT_FOUND" | "STALE_GENERATION" | "SOURCE_NOT_READY" | "ACTION_REJECTED" |
  "DIRTY_COLLECTION_LIMIT" | "PAYLOAD_LIMIT";
export type CollectionDraftSessionResult = Readonly<{
  state: AdminCollectionDraftSessions;
  code: CollectionDraftSessionCode;
  token: CollectionDraftSessionToken | null;
  bytesUsed: number;
}>;

export type MembershipSessionAction =
  | Readonly<{ kind: "REMOVE" | "RESTORE"; productId: string }>
  | Readonly<{ kind: "SORT_EXISTING" | "SORT_PROPOSED"; productId: string; sortOrderText: string }>
  | Readonly<{ kind: "CANCEL_PROPOSED"; productId: string }>
  | Readonly<{ kind: "ADD_PROPOSED"; candidate: ProposedMemberCandidate;
      verification: ProposedMemberVerification; context: ProposedMemberContext;
      /** Captured when the exact GET began; a later visit cannot reuse its observation. */
      verificationGeneration: number }>;

const normalizedId = (value: string): string | null =>
  typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;

function freezeTree<T>(value: T, seen = new Set<object>()): T {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeTree(child, seen);
  return Object.freeze(value);
}

function jsonBytes(value: unknown): number {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error("INVALID_SESSION_PAYLOAD");
  return new TextEncoder().encode(json).byteLength;
}

function discardedBasic(entry: CollectionDraftSessionEntry): CollectionBasicSelection | null {
  return entry.latestBasicSource ? createCollectionBasicSelection(entry.latestBasicSource) : entry.basic
    ? { ...entry.basic, draft: { ...entry.basic.originalDraft } } : null;
}

function discardedMembership(entry: CollectionDraftSessionEntry): MembershipDraft {
  return discardMembershipDraft(entry.membership);
}

/** Bound retained lifecycle metadata before accepting an edit so later recovery
 * remains within the complete-state cap, including counter digit growth. */
function metadataRecoveryBytes(state: AdminCollectionDraftSessions): number {
  const counterBytes = jsonBytes(Number.MAX_SAFE_INTEGER);
  const visitBytes = jsonBytes("v".repeat(MAX_VISIT_KEY_LENGTH));
  const sourceBytes = jsonBytes("NEEDS_REVALIDATION");
  let reserved = counterBytes - jsonBytes(state.nextGeneration);
  for (const entry of Object.values(state.entries)) {
    reserved += counterBytes - jsonBytes(entry.generation);
    reserved += counterBytes - jsonBytes(entry.version);
    reserved += visitBytes - jsonBytes(entry.activeVisitKey);
    reserved += sourceBytes - jsonBytes(entry.sourceState);
    reserved += jsonBytes(false) - jsonBytes(entry.basicSourceChanged);
  }
  return reserved;
}

/** Reserve the largest retained payload reachable through recovery alone. Each
 * Basic field and member flag/order may be restored separately; a whole-draft
 * Discard is an alternative to those partial restorations. The two drafts can
 * recover independently, so their positive headroom is additive. */
function recoveryBudgetBytes(state: AdminCollectionDraftSessions): number {
  let reserved = 0;
  for (const entry of Object.values(state.entries)) {
    if (entry.basic) {
      const current = jsonBytes(entry.basic);
      let partial = current;
      for (const field of BASIC_FIELDS) {
        partial += Math.max(0, jsonBytes(entry.basic.originalDraft[field]) -
          jsonBytes(entry.basic.draft[field]));
      }
      reserved += Math.max(partial, jsonBytes(discardedBasic(entry))) - current;
    }

    const currentPair = jsonBytes([entry.membershipBaseline, entry.membership]);
    let partial = currentPair;
    for (const [id, member] of Object.entries(entry.membership.entries)) {
      if (member.removed) partial += jsonBytes(false) - jsonBytes(true);
      const currentOrder = jsonBytes(member.sortOrderText);
      const baselineOrder = entry.membershipBaseline.entries[id]?.sortOrderText;
      partial += Math.max(0, jsonBytes(String(member.original.sortOrder)) - currentOrder,
        jsonBytes(String(member.latest.sortOrder)) - currentOrder,
        baselineOrder === undefined ? 0 : jsonBytes(baselineOrder) - currentOrder);
    }
    for (const proposed of Object.values(entry.membership.proposedAdds ?? {})) {
      partial += Math.max(0, jsonBytes("0") - jsonBytes(proposed.sortOrderText));
    }
    const afterDiscard = discardedMembership(entry);
    const discard = jsonBytes([afterDiscard, afterDiscard]);
    reserved += Math.max(partial, discard) - currentPair;
  }
  return collectionDraftSessionBytes(state) + reserved + metadataRecoveryBytes(state);
}

/** UTF-8 JSON bytes of the complete retained Session State. */
export function collectionDraftSessionBytes(state: AdminCollectionDraftSessions): number {
  return jsonBytes(state);
}

export function createAdminCollectionDraftSessions(): AdminCollectionDraftSessions {
  return freezeTree({ entries: {}, nextGeneration: 1 });
}

export function basicSessionDirty(entry: CollectionDraftSessionEntry): boolean {
  return !!entry.basic && collectionBasicFingerprint(entry.basic.draft) !==
    collectionBasicFingerprint(entry.basic.originalDraft);
}

export function membershipSessionDirty(entry: CollectionDraftSessionEntry): boolean {
  return membershipIsDirty(entry.membership);
}

export function collectionSessionDirty(entry: CollectionDraftSessionEntry): boolean {
  return basicSessionDirty(entry) || membershipSessionDirty(entry);
}

export function globalCollectionSessionDirty(state: AdminCollectionDraftSessions): boolean {
  return Object.values(state.entries).some(collectionSessionDirty);
}

export function dirtyCollectionSessionCount(state: AdminCollectionDraftSessions): number {
  return Object.values(state.entries).filter(collectionSessionDirty).length;
}

function tokenFor(entry: CollectionDraftSessionEntry | undefined): CollectionDraftSessionToken | null {
  return entry ? { collectionId: entry.collectionId, generation: entry.generation } : null;
}

/** Read own data descriptors, never invoke an ordinary accessor or toJSON. */
function ownData(value: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" ||
    !fields.includes(key)) || fields.some((field) => !descriptors[field] ||
      !("value" in descriptors[field]))) return null;
  return Object.fromEntries(fields.map((field) => [field, descriptors[field].value]));
}

function ownArray(value: unknown): unknown[] | null {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>;
  const length = descriptors.length?.value;
  if (!Number.isSafeInteger(length) || length < 0 ||
    Reflect.ownKeys(descriptors).length !== length + 1) return null;
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const field = descriptors[String(index)];
    if (!field || !("value" in field)) return null;
    result.push(field.value);
  }
  return result;
}

/** A Proxy can fabricate descriptors; structuredClone rejects its identity.
 * Run this only after descriptor checks so ordinary getters are never invoked. */
function cloneGate(value: unknown): boolean {
  if (typeof globalThis.structuredClone !== "function") return false;
  try { globalThis.structuredClone(value); return true; }
  catch { return false; }
}

function snapshotToken(value: unknown): CollectionDraftSessionToken | null {
  try {
    const data = ownData(value, ["collectionId", "generation"]);
    if (!data || !normalizedId(data.collectionId as string) ||
      !Number.isSafeInteger(data.generation) || (data.generation as number) < 1 ||
      !cloneGate(value)) return null;
    return { collectionId: (data.collectionId as string).toLowerCase(),
      generation: data.generation as number };
  } catch { return null; }
}

const validStatus = (value: unknown) => value === "draft" || value === "published" ||
  value === "retired";
const validOrder = (value: unknown) => typeof value === "number" &&
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const nullableString = (value: unknown) => value === null || typeof value === "string";

function snapshotDetail(value: unknown): AdminCollectionDetail | null {
  const data = ownData(value, DETAIL_FIELDS);
  if (!data || typeof data.id !== "string" || !normalizedId(data.id) ||
    typeof data.slug !== "string" || typeof data.nameEn !== "string" ||
    typeof data.nameZh !== "string" || typeof data.descriptionEn !== "string" ||
    typeof data.descriptionZh !== "string" || !validStatus(data.status) ||
    !validOrder(data.sortOrder) || !nullableString(data.publishedAt) ||
    typeof data.createdAt !== "string" || typeof data.updatedAt !== "string") return null;
  return data as AdminCollectionDetail;
}

function snapshotIssues(value: unknown): AdminCollectionDetailResult["issues"] | null {
  const items = ownArray(value);
  if (!items) return null;
  const issues = [];
  for (const item of items) {
    const data = ownData(item, ["code", "id"]);
    if (!data || !ISSUE_CODES.has(data.code as string) || !nullableString(data.id)) return null;
    issues.push(data as AdminCollectionDetailResult["issues"][number]);
  }
  return issues;
}

function snapshotDetailResult(value: unknown): AdminCollectionDetailResult | null {
  const data = ownData(value, ["state", "item", "issues", "origin"]);
  if (!data || !READ_STATES.has(data.state as string) ||
    !ORIGINS.has(data.origin as string)) return null;
  const issues = snapshotIssues(data.issues);
  const item = data.item === null ? null : snapshotDetail(data.item);
  if (!issues || data.item !== null && !item || !cloneGate(value)) return null;
  return { state: data.state as AdminCollectionReadState, item, issues,
    origin: data.origin as AdminCollectionDetailResult["origin"] };
}

function snapshotMember(value: unknown): AdminCollectionMemberListResult["items"][number] | null {
  const data = ownData(value, MEMBER_FIELDS);
  if (!data || typeof data.productId !== "string" ||
    !nullableString(data.productCode) || !nullableString(data.nameEn) ||
    !nullableString(data.nameZh) || data.productStatus !== null &&
      !validStatus(data.productStatus) || !validOrder(data.sortOrder)) return null;
  return data as AdminCollectionMemberListResult["items"][number];
}

function snapshotMembersResult(value: unknown): AdminCollectionMemberListResult | null {
  const data = ownData(value, ["state", "items", "issues", "nextCursor",
    "previousCursor", "origin"]);
  if (!data || !READ_STATES.has(data.state as string) ||
    !ORIGINS.has(data.origin as string) || !nullableString(data.nextCursor) ||
    !nullableString(data.previousCursor)) return null;
  const rawItems = ownArray(data.items);
  const issues = snapshotIssues(data.issues);
  if (!rawItems || !issues) return null;
  const items = [];
  for (const raw of rawItems) {
    const item = snapshotMember(raw);
    if (!item) return null;
    items.push(item);
  }
  if (!cloneGate(value)) return null;
  return { state: data.state as AdminCollectionReadState, items, issues,
    nextCursor: data.nextCursor as string | null,
    previousCursor: data.previousCursor as string | null,
    origin: data.origin as AdminCollectionMemberListResult["origin"] };
}

function snapshotAction(value: unknown): MembershipSessionAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const kind = descriptors.kind?.value;
  const fields = kind === "REMOVE" || kind === "RESTORE" || kind === "CANCEL_PROPOSED"
    ? ["kind", "productId"] : kind === "SORT_EXISTING" || kind === "SORT_PROPOSED"
      ? ["kind", "productId", "sortOrderText"] : kind === "ADD_PROPOSED"
        ? ["kind", "candidate", "verification", "context", "verificationGeneration"] : null;
  if (!fields) return null;
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== fields.length || keys.some((key) => typeof key !== "string" ||
    !fields.includes(key)) || fields.some((field) => !descriptors[field] ||
      !("value" in descriptors[field]))) return null;
  const data = Object.fromEntries(fields.map((field) => [field, descriptors[field].value]));
  if (kind === "ADD_PROPOSED") {
    if (!Number.isSafeInteger(data.verificationGeneration) ||
      (data.verificationGeneration as number) < 1) return null;
    // The core Add function snapshots and validates its three nested inputs.
    return data as MembershipSessionAction;
  }
  if (typeof data.productId !== "string" ||
    (kind === "SORT_EXISTING" || kind === "SORT_PROPOSED") &&
      typeof data.sortOrderText !== "string" || !cloneGate(value)) return null;
  return data as MembershipSessionAction;
}

function result(state: AdminCollectionDraftSessions, code: CollectionDraftSessionCode,
  entry?: CollectionDraftSessionEntry): CollectionDraftSessionResult {
  return { state, code, token: tokenFor(entry), bytesUsed: collectionDraftSessionBytes(state) };
}

function publish(state: AdminCollectionDraftSessions, entry: CollectionDraftSessionEntry,
  nextGeneration = state.nextGeneration): CollectionDraftSessionResult {
  if (!Number.isSafeInteger(nextGeneration) || nextGeneration < 1 ||
    !Number.isSafeInteger(entry.generation) || entry.generation < 1 ||
    !Number.isSafeInteger(entry.version) || entry.version < 0)
    return result(state, "ACTION_REJECTED", state.entries[entry.collectionId]);
  const next = freezeTree({ entries: { ...state.entries, [entry.collectionId]: entry }, nextGeneration });
  const nextBytes = collectionDraftSessionBytes(next);
  if (dirtyCollectionSessionCount(next) > MAX_DIRTY_COLLECTION_SESSIONS)
    return result(state, "DIRTY_COLLECTION_LIMIT", state.entries[entry.collectionId]);
  if (nextBytes > MAX_COLLECTION_DRAFT_SESSION_BYTES ||
    recoveryBudgetBytes(next) > MAX_COLLECTION_DRAFT_SESSION_BYTES)
    return result(state, "PAYLOAD_LIMIT", state.entries[entry.collectionId]);
  return result(next, "APPLIED", next.entries[entry.collectionId]);
}

function currentEntry(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken): CollectionDraftSessionEntry | null {
  const identity = snapshotToken(token);
  const entry = identity ? state.entries[identity.collectionId] : undefined;
  return entry && entry.generation === identity?.generation ? entry : null;
}

function rejectedToken(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken): CollectionDraftSessionResult {
  const identity = snapshotToken(token);
  if (!identity) return result(state, "ACTION_REJECTED");
  const entry = state.entries[identity.collectionId];
  return result(state, entry ? "STALE_GENERATION" : "NOT_FOUND", entry);
}

/** Repeated initialization, including Strict Mode setup, never resets an existing draft. */
export function initializeCollectionDraftSession(state: AdminCollectionDraftSessions,
  collectionId: string, initialBasic: AdminCollectionDetail | null = null): CollectionDraftSessionResult {
  const id = normalizedId(collectionId);
  if (!id) return result(state, "INVALID_COLLECTION_ID");
  if (state.entries[id]) return result(state, "UNCHANGED", state.entries[id]);
  let initial: AdminCollectionDetail | null = null;
  try {
    if (initialBasic !== null) {
      initial = snapshotDetail(initialBasic);
      if (!initial || !cloneGate(initialBasic)) return result(state, "ACTION_REJECTED");
    }
  } catch { return result(state, "ACTION_REJECTED"); }
  if (initial && normalizedId(initial.id) !== id)
    return result(state, "INVALID_COLLECTION_ID");
  const basic = initial ? createCollectionBasicSelection(initial) : null;
  const baseline = createMembershipDraft(id);
  return publish(state, { collectionId: id, generation: state.nextGeneration, version: 0,
    activeVisitKey: null, basic, latestBasicSource: null,
    membershipBaseline: baseline, membership: baseline,
    sourceState: "NEEDS_REVALIDATION", basicSourceChanged: false }, state.nextGeneration + 1);
}

/** A visit key is stable across effect replay but new for a real detail-page visit.
 * Accept only 1–128 ASCII letters, digits, colon, underscore or hyphen. */
export function activateCollectionDraftSession(state: AdminCollectionDraftSessions,
  collectionId: string, visitKey: string): CollectionDraftSessionResult {
  const id = normalizedId(collectionId);
  if (!id) return result(state, "INVALID_COLLECTION_ID");
  if (typeof visitKey !== "string" || visitKey.length > MAX_VISIT_KEY_LENGTH ||
    !VISIT_KEY.test(visitKey))
    return result(state, "ACTION_REJECTED", state.entries[id]);
  const entry = state.entries[id];
  if (!entry) return result(state, "NOT_FOUND");
  if (entry.activeVisitKey === visitKey) return result(state, "UNCHANGED", entry);
  return publish(state, { ...entry, generation: state.nextGeneration,
    version: entry.version + 1, activeVisitKey: visitKey,
    latestBasicSource: null, sourceState: "NEEDS_REVALIDATION",
    basicSourceChanged: false }, state.nextGeneration + 1);
}

/** Invalidate callbacks from a departing detail view without discarding either draft. */
export function deactivateCollectionDraftSession(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  if (!entry) return rejectedToken(state, token);
  return publish(state, { ...entry, generation: state.nextGeneration,
    version: entry.version + 1, activeVisitKey: null,
    latestBasicSource: null, sourceState: "NEEDS_REVALIDATION",
    basicSourceChanged: false }, state.nextGeneration + 1);
}

/** Call before each new detail/member read. If accepting its larger payload fails,
 * the previously trusted source cannot remain eligible for Add. */
export function beginCollectionDraftSourceRead(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  if (!entry) return rejectedToken(state, token);
  if (!entry.activeVisitKey) return result(state, "SOURCE_NOT_READY", entry);
  return publish(state, { ...entry, generation: state.nextGeneration,
    version: entry.version + 1, latestBasicSource: null,
    sourceState: "NEEDS_REVALIDATION", basicSourceChanged: false },
  state.nextGeneration + 1);
}

/** Only a newly authorized detail/member read may reopen the source gate. */
export function acceptCollectionDraftSource(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken, detail: AdminCollectionDetailResult,
  members: AdminCollectionMemberListResult | null, pageKey: string): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  if (!entry) return rejectedToken(state, token);
  if (!entry.activeVisitKey || entry.sourceState !== "NEEDS_REVALIDATION")
    return result(state, "SOURCE_NOT_READY", entry);
  if (typeof pageKey !== "string" || pageKey.length < 1 ||
    pageKey.length > MAX_PAGE_KEY_LENGTH || !PAGE_KEY.test(pageKey))
    return result(state, "ACTION_REJECTED", entry);
  let detailValue: AdminCollectionDetailResult | null;
  let membersValue: AdminCollectionMemberListResult | null;
  try {
    detailValue = snapshotDetailResult(detail);
    membersValue = members === null ? null : snapshotMembersResult(members);
  } catch { return result(state, "ACTION_REJECTED", entry); }
  if (!detailValue || members !== null && !membersValue)
    return result(state, "ACTION_REJECTED", entry);
  const trustedBasic = detailValue.state === "COMPLETE" && detailValue.origin !== "NONE" &&
    detailValue.item && normalizedId(detailValue.item.id) === entry.collectionId
    ? detailValue.item : null;
  let basic = entry.basic;
  let basicSourceChanged = !trustedBasic;
  if (trustedBasic) {
    if (!basic || !basicSessionDirty(entry)) basic = createCollectionBasicSelection(trustedBasic);
    else basicSourceChanged = collectionBasicSourceChanged(basic.original, trustedBasic);
  }
  const complete = !!trustedBasic && membersValue?.state === "COMPLETE" &&
    membersValue.origin !== "NONE";
  const sourceState: CollectionDraftSessionEntry["sourceState"] = complete ? "COMPLETE" :
    detailValue.state !== "COMPLETE" ? detailValue.state : !trustedBasic || membersValue?.state === "COMPLETE"
      ? "INCOMPLETE" : membersValue?.state ?? "INCOMPLETE";
  const membership = complete && membersValue ? ingestMembershipPage(entry.membership, pageKey, membersValue) : entry.membership;
  const membershipBaseline = complete && membersValue ? ingestMembershipPage(entry.membershipBaseline, pageKey, membersValue)
    : entry.membershipBaseline;
  return publish(state, { ...entry, version: entry.version + 1, basic,
    latestBasicSource: trustedBasic, basicSourceChanged,
    membership, membershipBaseline, sourceState });
}

export function updateCollectionBasicField<K extends keyof CollectionBasicDraft>(
  state: AdminCollectionDraftSessions, token: CollectionDraftSessionToken,
  field: K, value: CollectionBasicDraft[K]): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  if (!entry) return rejectedToken(state, token);
  if (!BASIC_FIELD_SET.has(field) || typeof value !== "string")
    return result(state, "ACTION_REJECTED", entry);
  if (!entry.basic || !entry.activeVisitKey || !entry.latestBasicSource ||
    entry.basicSourceChanged)
    return result(state, "SOURCE_NOT_READY", entry);
  if (entry.basic.draft[field] === value) return result(state, "UNCHANGED", entry);
  const basic = { ...entry.basic, draft: { ...entry.basic.draft, [field]: value } };
  return publish(state, { ...entry, version: entry.version + 1, basic });
}

export function applyCollectionMembershipAction(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken, action: MembershipSessionAction): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  if (!entry) return rejectedToken(state, token);
  if (!entry.activeVisitKey) return result(state, "SOURCE_NOT_READY", entry);
  const current = entry.membership;
  let next: MembershipDraft;
  try {
    const input = snapshotAction(action);
    if (!input) return result(state, "ACTION_REJECTED", entry);
    switch (input.kind) {
      case "REMOVE": next = markMembershipRemoved(current, input.productId, true); break;
      case "RESTORE": next = markMembershipRemoved(current, input.productId, false); break;
      case "SORT_EXISTING": next = changeMembershipOrder(current, input.productId,
        input.sortOrderText); break;
      case "SORT_PROPOSED": next = changeProposedMemberOrder(current, input.productId,
        input.sortOrderText); break;
      case "CANCEL_PROPOSED": next = cancelProposedMember(current, input.productId); break;
      case "ADD_PROPOSED": {
        if (entry.sourceState !== "COMPLETE" || entry.basicSourceChanged ||
          entry.latestBasicSource?.status === "retired")
          return result(state, "SOURCE_NOT_READY", entry);
        if (input.verificationGeneration !== entry.generation)
          return result(state, "STALE_GENERATION", entry);
        next = addProposedMember(current, input.candidate, input.verification, input.context);
        const addedIds = Object.keys(next.proposedAdds ?? {}).filter((id) =>
          !Object.hasOwn(current.proposedAdds ?? {}, id));
        if (addedIds.length !== 1 || !cloneGate(action))
          return result(state, "ACTION_REJECTED", entry);
        break;
      }
      default: {
        const exhaustive: never = input;
        void exhaustive;
        return result(state, "ACTION_REJECTED", entry);
      }
    }
  } catch { return result(state, "ACTION_REJECTED", entry); }
  if (next === current) return result(state, "UNCHANGED", entry);
  return publish(state, { ...entry, version: entry.version + 1, membership: next });
}

function discardEntry(state: AdminCollectionDraftSessions, entry: CollectionDraftSessionEntry,
  which: "BASIC" | "MEMBERSHIP" | "BOTH"): CollectionDraftSessionResult {
  const basic = which === "MEMBERSHIP" ? entry.basic : discardedBasic(entry);
  const membership = which === "BASIC" ? entry.membership : discardedMembership(entry);
  return publish(state, { ...entry, generation: state.nextGeneration,
    version: entry.version + 1, basic,
    membership, membershipBaseline: which === "BASIC" ? entry.membershipBaseline : membership,
    basicSourceChanged: which === "MEMBERSHIP" ? entry.basicSourceChanged : !entry.latestBasicSource },
  state.nextGeneration + 1);
}

export function discardCollectionBasic(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  return entry ? discardEntry(state, entry, "BASIC") : rejectedToken(state, token);
}
export function discardCollectionMembership(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  return entry ? discardEntry(state, entry, "MEMBERSHIP") : rejectedToken(state, token);
}
export function discardCurrentCollection(state: AdminCollectionDraftSessions,
  token: CollectionDraftSessionToken): CollectionDraftSessionResult {
  const entry = currentEntry(state, token);
  return entry ? discardEntry(state, entry, "BOTH") : rejectedToken(state, token);
}

/** An explicit user discard may remove a stored collection, including when its view is absent. */
export function discardCollectionById(state: AdminCollectionDraftSessions,
  collectionId: string): CollectionDraftSessionResult {
  const id = normalizedId(collectionId);
  if (!id) return result(state, "INVALID_COLLECTION_ID");
  if (!state.entries[id]) return result(state, "NOT_FOUND");
  if (!Number.isSafeInteger(state.nextGeneration + 1))
    return result(state, "ACTION_REJECTED", state.entries[id]);
  const entries = { ...state.entries };
  delete entries[id];
  return result(freezeTree({ entries, nextGeneration: state.nextGeneration + 1 }), "APPLIED");
}

/** Never evict a dirty draft. The caller may protect a currently mounted clean entry. */
export function cleanupCleanCollectionSessions(state: AdminCollectionDraftSessions,
  protectedCollectionId: string | null = null): CollectionDraftSessionResult {
  const protectedId = protectedCollectionId ? normalizedId(protectedCollectionId) : null;
  const entries = { ...state.entries };
  let removed = false;
  for (const [id, entry] of Object.entries(entries)) {
    if (id !== protectedId && !collectionSessionDirty(entry)) {
      delete entries[id];
      removed = true;
    }
  }
  if (!removed) return result(state, "UNCHANGED");
  if (!Number.isSafeInteger(state.nextGeneration + 1)) return result(state, "ACTION_REJECTED");
  return result(freezeTree({ entries, nextGeneration: state.nextGeneration + 1 }), "APPLIED");
}
