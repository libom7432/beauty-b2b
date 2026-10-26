import type { AdminCollectionMember, AdminCollectionMemberListResult,
  AdminCollectionMembershipCheckResult, CatalogStatus } from "../catalog-read/types.ts";

export const MAX_LOADED_MEMBERS = 500;
/** A local freshness limit; it cannot guarantee the database has not changed. */
export const MAX_MEMBERSHIP_VERIFICATION_AGE_MS = 30_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^[+-]?[0-9]+$/;

export type MembershipPageStatus = "FULLY_ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED";
export type MembershipPageObservation = Readonly<{ pageKey: string; status: MembershipPageStatus }>;
export type MembershipSourceAnomaly = "INVALID_ID" | "DUPLICATE_ID";

export type MembershipEntry = Readonly<{
  original: AdminCollectionMember; latest: AdminCollectionMember;
  removed: boolean; sortOrderText: string;
}>;
export type ProposedMemberCandidate = Readonly<{
  productId: string; productCode: string; displayName: string | null;
  status: CatalogStatus;
}>;
export type ProposedMemberVerification = AdminCollectionMembershipCheckResult & Readonly<{
  viewKey: string; checkedAtMs: number; expiresAtMs: number;
}>;
export type ProposedMemberContext = Readonly<{
  collectionId: string; viewKey: string; nowMs: number;
  sourceState: AdminCollectionMemberListResult["state"];
}>;
export type ProposedMemberAdd = Readonly<{
  productId: string; productCode: string; displayName: string | null;
  productStatus: CatalogStatus; sortOrderText: string;
  verificationAtAdd: Readonly<{
    collectionId: string; productId: string; origin: AdminCollectionMembershipCheckResult["origin"];
    checkedAtMs: number; viewKey: string;
  }>;
}>;
export type MembershipDraft = Readonly<{
  collectionId: string; entries: Readonly<Record<string, MembershipEntry>>;
  /** Optional so callers holding a draft created before this extension remain compatible. */
  proposedAdds?: Readonly<Record<string, ProposedMemberAdd>>;
  pages: readonly MembershipPageObservation[];
  sourceAnomalies: readonly MembershipSourceAnomaly[];
  draftConflicts: readonly string[]; limitReached: boolean;
}>;
export type MembershipIssue = Readonly<{ field_path: string; error_code: string; message: string }>;

const key = (id: string) => id.toLowerCase();
const snapshot = (member: AdminCollectionMember): AdminCollectionMember => Object.freeze({
  productId: member.productId, productCode: member.productCode, nameEn: member.nameEn,
  nameZh: member.nameZh, productStatus: member.productStatus, sortOrder: member.sortOrder,
});
const fingerprint = (member: AdminCollectionMember) => JSON.stringify([
  member.productId.toLowerCase(), member.productCode, member.nameEn, member.nameZh,
  member.productStatus, member.sortOrder,
]);
const parsedOrder = (text: string): number | null => {
  if (typeof text !== "string" || !INTEGER.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number >= -2147483648 && number <= 2147483647
    ? number : null;
};
const orderChanged = (entry: MembershipEntry) => {
  const parsed = parsedOrder(entry.sortOrderText);
  return parsed === null || parsed !== entry.original.sortOrder;
};

/** Only plain, own data properties may cross the local Add boundary. */
function copyPlainData(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
    typeof value === "number") return value;
  if (typeof value !== "object" || ancestors.has(value)) throw new Error("UNSAFE_DATA");
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== (array ? Array.prototype : Object.prototype) &&
    !(prototype === null && !array)) throw new Error("UNSAFE_DATA");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((name) => typeof name !== "string")) throw new Error("UNSAFE_DATA");
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length?.value;
      if (!Number.isInteger(length) || length < 0 || length > 10_000 ||
        keys.length !== length + 1) throw new Error("UNSAFE_DATA");
      return Array.from({ length }, (_, index) => {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !("value" in descriptor)) throw new Error("UNSAFE_DATA");
        return copyPlainData(descriptor.value, ancestors);
      });
    }
    const copied: Record<string, unknown> = {};
    for (const name of keys) {
      const field = name as string;
      if (field === "__proto__" || field === "constructor" || field === "prototype" ||
        !("value" in descriptors[field])) throw new Error("UNSAFE_DATA");
      copied[field] = copyPlainData(descriptors[field].value, ancestors);
    }
    return copied;
  } finally { ancestors.delete(value); }
}

/** Descriptor inspection alone cannot identify a Proxy. Refuse Add unless this
 * runtime also rejects Proxy values at the structured-clone boundary. */
function safeCloneGate(): typeof structuredClone {
  const clone = globalThis.structuredClone;
  if (typeof clone !== "function" || typeof Proxy !== "function")
    throw new Error("UNSAFE_DATA");
  let rejectedProxy = false;
  try { clone(new Proxy({}, {})); } catch { rejectedProxy = true; }
  if (!rejectedProxy) throw new Error("UNSAFE_DATA");
  return clone;
}

function ownScalarRecord(value: unknown, expected: readonly string[],
  clone: typeof structuredClone): Record<string, unknown> {
  const copied = copyPlainData(value);
  if (!copied || typeof copied !== "object" || Array.isArray(copied) ||
    Object.keys(copied).length !== expected.length ||
    expected.some((field) => !Object.hasOwn(copied, field))) throw new Error("UNSAFE_DATA");
  for (const field of expected) {
    const scalar = (copied as Record<string, unknown>)[field];
    if (scalar !== null && !["string", "number", "boolean"].includes(typeof scalar))
      throw new Error("UNSAFE_DATA");
  }
  // A Proxy may fabricate ordinary descriptors. The clone gate rejects its identity.
  clone(value);
  return copied as Record<string, unknown>;
}

export class MembershipDraftSnapshotError extends Error {
  constructor() { super("MEMBERSHIP_DRAFT_SNAPSHOT_FAILED"); this.name = "MembershipDraftSnapshotError"; }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const validStatus = (value: unknown): value is CatalogStatus =>
  value === "draft" || value === "published" || value === "retired";
const validMember = (value: unknown, id: string): value is AdminCollectionMember =>
  isRecord(value) && typeof value.productId === "string" && key(value.productId) === id &&
  (value.productCode === null || typeof value.productCode === "string") &&
  (value.nameEn === null || typeof value.nameEn === "string") &&
  (value.nameZh === null || typeof value.nameZh === "string") &&
  (value.productStatus === null || validStatus(value.productStatus)) &&
  Number.isInteger(value.sortOrder);

function snapshotDraft(state: MembershipDraft, clone: typeof structuredClone): MembershipDraft {
  try {
    const copied = copyPlainData(state);
    clone(state);
    if (!copied || typeof copied !== "object" || Array.isArray(copied))
      throw new Error("UNSAFE_DATA");
    const draft = copied as MembershipDraft;
    if (typeof draft.collectionId !== "string" || !UUID.test(draft.collectionId) ||
      !draft.entries || typeof draft.entries !== "object" || Array.isArray(draft.entries) ||
      draft.proposedAdds !== undefined && (!draft.proposedAdds ||
        typeof draft.proposedAdds !== "object" || Array.isArray(draft.proposedAdds)) ||
      !Array.isArray(draft.pages) || !Array.isArray(draft.sourceAnomalies) ||
      !Array.isArray(draft.draftConflicts) || typeof draft.limitReached !== "boolean" ||
      !draft.sourceAnomalies.every((item) => item === "INVALID_ID" || item === "DUPLICATE_ID") ||
      !draft.draftConflicts.every((item) => typeof item === "string" && UUID.test(item)) ||
      !draft.pages.every((page) => isRecord(page) && typeof page.pageKey === "string" &&
        ["FULLY_ACCEPTED", "PARTIALLY_ACCEPTED", "REJECTED"].includes(page.status as string)) ||
      Object.keys(draft.entries).some((id) => !UUID.test(id)) ||
      Object.keys(draft.proposedAdds ?? {}).some((id) => !UUID.test(id)))
      throw new Error("UNSAFE_DATA");
    for (const [id, entry] of Object.entries(draft.entries)) {
      if (!isRecord(entry) || !validMember(entry.original, id) ||
        !validMember(entry.latest, id) || typeof entry.removed !== "boolean" ||
        typeof entry.sortOrderText !== "string") throw new Error("UNSAFE_DATA");
    }
    for (const [id, proposed] of Object.entries(draft.proposedAdds ?? {})) {
      if (!isRecord(proposed) || proposed.productId !== id ||
        typeof proposed.productCode !== "string" ||
        proposed.displayName !== null && typeof proposed.displayName !== "string" ||
        !validStatus(proposed.productStatus) || typeof proposed.sortOrderText !== "string" ||
        !isRecord(proposed.verificationAtAdd) ||
        proposed.verificationAtAdd.collectionId !== draft.collectionId ||
        proposed.verificationAtAdd.productId !== id ||
        !["OFFLINE_FIXTURE", "READ_ONLY_DATABASE"].includes(
          proposed.verificationAtAdd.origin as string) ||
        typeof proposed.verificationAtAdd.checkedAtMs !== "number" ||
        typeof proposed.verificationAtAdd.viewKey !== "string")
        throw new Error("UNSAFE_DATA");
    }
    return draft;
  } catch { throw new MembershipDraftSnapshotError(); }
}

export function createMembershipDraft(collectionId: string): MembershipDraft {
  return { collectionId: key(collectionId), entries: {}, proposedAdds: {}, pages: [], sourceAnomalies: [],
    draftConflicts: [], limitReached: false };
}
export function membershipIsDirty(state: MembershipDraft): boolean {
  return Object.keys(state.proposedAdds ?? {}).length > 0 ||
    Object.values(state.entries).some((entry) => entry.removed || orderChanged(entry));
}

/** The caller must obtain the exact check from the authorized Repository/GET route.
 * These local checks do not turn that observation into future write authorization. */
export function addProposedMember(state: MembershipDraft, candidate: ProposedMemberCandidate,
  verification: ProposedMemberVerification, context: ProposedMemberContext): MembershipDraft {
  let clone: typeof structuredClone;
  try { clone = safeCloneGate(); }
  catch { throw new MembershipDraftSnapshotError(); }
  const source = snapshotDraft(state, clone);
  try {
    // Data descriptors contain values without invoking ordinary getters.
    // Clone probing rejects Proxy identities before copied values are trusted.
    const candidateValue = ownScalarRecord(candidate,
      ["productId", "productCode", "displayName", "status"], clone);
    const verificationValue = ownScalarRecord(verification,
      ["collectionId", "productId", "status", "origin", "viewKey", "checkedAtMs",
        "expiresAtMs"], clone);
    const contextValue = ownScalarRecord(context,
      ["collectionId", "viewKey", "nowMs", "sourceState"], clone);
    if (typeof source.collectionId !== "string" || !UUID.test(source.collectionId) ||
      typeof contextValue.collectionId !== "string" || !UUID.test(contextValue.collectionId) ||
      typeof candidateValue.productId !== "string" || !UUID.test(candidateValue.productId) ||
      typeof verificationValue.collectionId !== "string" ||
      !UUID.test(verificationValue.collectionId) ||
      typeof verificationValue.productId !== "string" ||
      !UUID.test(verificationValue.productId) ||
      typeof candidateValue.productCode !== "string" ||
      candidateValue.displayName !== null && typeof candidateValue.displayName !== "string" ||
      candidateValue.status !== "draft" && candidateValue.status !== "published" &&
        candidateValue.status !== "retired" ||
      typeof contextValue.viewKey !== "string" || !contextValue.viewKey ||
      typeof contextValue.nowMs !== "number" ||
      typeof verificationValue.checkedAtMs !== "number" ||
      typeof verificationValue.expiresAtMs !== "number") return source;
    const collectionId = key(contextValue.collectionId);
    const productId = key(candidateValue.productId);
    if (collectionId !== source.collectionId ||
      key(verificationValue.collectionId) !== collectionId ||
      key(verificationValue.productId) !== productId ||
      verificationValue.status !== "NOT_MEMBER" ||
      verificationValue.origin !== "OFFLINE_FIXTURE" &&
        verificationValue.origin !== "READ_ONLY_DATABASE" ||
      verificationValue.viewKey !== contextValue.viewKey ||
      !Number.isFinite(contextValue.nowMs) ||
      !Number.isFinite(verificationValue.checkedAtMs) ||
      !Number.isFinite(verificationValue.expiresAtMs) ||
      verificationValue.checkedAtMs > contextValue.nowMs ||
      verificationValue.expiresAtMs <= contextValue.nowMs ||
      verificationValue.expiresAtMs - verificationValue.checkedAtMs >
        MAX_MEMBERSHIP_VERIFICATION_AGE_MS ||
      contextValue.sourceState !== "COMPLETE" || source.sourceAnomalies.length > 0 ||
      source.draftConflicts.length > 0 || source.limitReached ||
      source.entries[productId] || source.proposedAdds?.[productId] ||
      new Set([...Object.keys(source.entries), ...Object.keys(source.proposedAdds ?? {})]).size >=
        MAX_LOADED_MEMBERS) return source;
    const proposed: ProposedMemberAdd = {
      productId, productCode: candidateValue.productCode,
      displayName: candidateValue.displayName,
      productStatus: candidateValue.status, sortOrderText: "0",
      verificationAtAdd: { collectionId, productId, origin: verificationValue.origin,
        checkedAtMs: verificationValue.checkedAtMs, viewKey: contextValue.viewKey },
    };
    return { collectionId: source.collectionId, entries: source.entries,
      proposedAdds: { ...source.proposedAdds, [productId]: proposed }, pages: source.pages,
      sourceAnomalies: source.sourceAnomalies, draftConflicts: source.draftConflicts,
      limitReached: source.limitReached };
  } catch { return source; }
}

export function cancelProposedMember(state: MembershipDraft, productId: string): MembershipDraft {
  const id = key(productId);
  if (!state.proposedAdds?.[id]) return state;
  const proposedAdds = { ...state.proposedAdds };
  delete proposedAdds[id];
  return { ...state, proposedAdds };
}

export function changeProposedMemberOrder(state: MembershipDraft, productId: string,
  sortOrderText: string): MembershipDraft {
  const id = key(productId);
  const proposed = state.proposedAdds?.[id];
  if (!proposed) return state;
  return { ...state, proposedAdds: { ...state.proposedAdds,
    [id]: { ...proposed, sortOrderText } } };
}

export function sortedProposedMembers(state: MembershipDraft): ProposedMemberAdd[] {
  return Object.values(state.proposedAdds ?? {}).map((item) => ({ ...item,
    verificationAtAdd: { ...item.verificationAtAdd } })).sort((a, b) =>
    (parsedOrder(a.sortOrderText) ?? 0) - (parsedOrder(b.sortOrderText) ?? 0) ||
    (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
}

/** A COMPLETE page proves only its own rows. It never proves absence on other pages. */
export function ingestMembershipPage(state: MembershipDraft, pageKey: string,
  result: AdminCollectionMemberListResult): MembershipDraft {
  if (result.state !== "COMPLETE") return state;
  const entries = { ...state.entries };
  const proposedAdds = state.proposedAdds ?? {};
  const sourceAnomalies = new Set(state.sourceAnomalies);
  const draftConflicts = new Set(state.draftConflicts);
  const seen = new Set<string>();
  const dirty = membershipIsDirty(state);
  let limitReached = state.limitReached;
  let acceptedRows = 0;
  let rejectedRows = 0;
  for (const member of result.items) {
    if (!UUID.test(member.productId)) {
      sourceAnomalies.add("INVALID_ID"); rejectedRows++; continue;
    }
    const id = key(member.productId);
    if (seen.has(id)) {
      sourceAnomalies.add("DUPLICATE_ID"); rejectedRows++; continue;
    }
    seen.add(id);
    const current = snapshot(member);
    const prior = entries[id];
    if (!prior) {
      if (!proposedAdds[id] && new Set([...Object.keys(entries), ...Object.keys(proposedAdds)]).size >=
        MAX_LOADED_MEMBERS) {
        limitReached = true; rejectedRows++; continue;
      }
      entries[id] = { original: current, latest: current, removed: false,
        sortOrderText: String(current.sortOrder) };
    } else if (fingerprint(prior.latest) !== fingerprint(current)) {
      if (dirty) {
        entries[id] = { ...prior, latest: current };
        draftConflicts.add(id);
      } else {
        entries[id] = { original: current, latest: current, removed: false,
          sortOrderText: String(current.sortOrder) };
      }
    }
    // Keep the proposed item intact while recording that the newly observed source
    // contradicts its exact-check observation. Discard can then keep this real member.
    if (proposedAdds[id]) draftConflicts.add(id);
    acceptedRows++;
  }
  const status: MembershipPageStatus = rejectedRows === 0 ? "FULLY_ACCEPTED"
    : acceptedRows === 0 ? "REJECTED" : "PARTIALLY_ACCEPTED";
  const pages = state.pages.filter((page) => page.pageKey !== pageKey);
  pages.push({ pageKey, status });
  return { ...state, entries, pages, sourceAnomalies: [...sourceAnomalies],
    draftConflicts: [...draftConflicts], limitReached };
}

export function changeMembershipOrder(state: MembershipDraft, productId: string,
  sortOrderText: string): MembershipDraft {
  const id = key(productId);
  const entry = state.entries[id];
  if (!entry) return state;
  return { ...state, entries: { ...state.entries,
    [id]: { ...entry, sortOrderText } } };
}
export function markMembershipRemoved(state: MembershipDraft, productId: string,
  removed: boolean): MembershipDraft {
  const id = key(productId);
  const entry = state.entries[id];
  if (!entry) return state;
  return { ...state, entries: { ...state.entries, [id]: { ...entry, removed } } };
}
export function discardMembershipDraft(state: MembershipDraft): MembershipDraft {
  const entries: Record<string, MembershipEntry> = {};
  for (const [id, entry] of Object.entries(state.entries)) {
    entries[id] = { original: entry.latest, latest: entry.latest, removed: false,
      sortOrderText: String(entry.latest.sortOrder) };
  }
  // Discard cannot repair an anomalous source page or a reached capacity limit.
  return { ...state, entries, proposedAdds: {}, draftConflicts: [] };
}
export function sortedMembershipEntries(state: MembershipDraft): MembershipEntry[] {
  const compareId = (a: MembershipEntry, b: MembershipEntry) =>
    a.original.productId.toLowerCase() < b.original.productId.toLowerCase() ? -1 : 1;
  return Object.values(state.entries).sort((a, b) =>
    (parsedOrder(a.sortOrderText) ?? a.original.sortOrder) -
    (parsedOrder(b.sortOrderText) ?? b.original.sortOrder) || compareId(a, b));
}
export function validateMembershipDraft(state: MembershipDraft) {
  const issues: MembershipIssue[] = [];
  for (const [id, entry] of Object.entries(state.entries)) {
    if (parsedOrder(entry.sortOrderText) === null)
      issues.push({ field_path: `members.${id}.sort_order`, error_code: "INVALID_SORT_ORDER",
        message: "Use a PostgreSQL int32 integer" });
  }
  for (const [id, proposed] of Object.entries(state.proposedAdds ?? {})) {
    if (parsedOrder(proposed.sortOrderText) === null)
      issues.push({ field_path: `proposedAdds.${id}.sort_order`, error_code: "INVALID_SORT_ORDER",
        message: "Use a PostgreSQL int32 integer" });
  }
  return { localState: issues.length ? "INVALID" as const : "VALID" as const,
    overallState: issues.length || state.sourceAnomalies.length
      ? "INVALID" as const : "NOT_VERIFIED" as const,
    issues, sourceAnomalies: state.sourceAnomalies,
    notVerified: ["Unloaded collection members", "Current database state",
      "Final server permissions and write eligibility"] };
}
