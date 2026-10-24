import type { AdminCollectionMember, AdminCollectionMemberListResult } from "../catalog-read/types.ts";

export const MAX_LOADED_MEMBERS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^[+-]?[0-9]+$/;

export type MembershipPageStatus = "FULLY_ACCEPTED" | "PARTIALLY_ACCEPTED" | "REJECTED";
export type MembershipPageObservation = Readonly<{ pageKey: string; status: MembershipPageStatus }>;
export type MembershipSourceAnomaly = "INVALID_ID" | "DUPLICATE_ID";

export type MembershipEntry = Readonly<{
  original: AdminCollectionMember; latest: AdminCollectionMember;
  removed: boolean; sortOrderText: string;
}>;
export type MembershipDraft = Readonly<{
  collectionId: string; entries: Readonly<Record<string, MembershipEntry>>;
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

export function createMembershipDraft(collectionId: string): MembershipDraft {
  return { collectionId: key(collectionId), entries: {}, pages: [], sourceAnomalies: [],
    draftConflicts: [], limitReached: false };
}
export function membershipIsDirty(state: MembershipDraft): boolean {
  return Object.values(state.entries).some((entry) => entry.removed || orderChanged(entry));
}

/** A COMPLETE page proves only its own rows. It never proves absence on other pages. */
export function ingestMembershipPage(state: MembershipDraft, pageKey: string,
  result: AdminCollectionMemberListResult): MembershipDraft {
  if (result.state !== "COMPLETE") return state;
  const entries = { ...state.entries };
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
      if (Object.keys(entries).length >= MAX_LOADED_MEMBERS) {
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
  return { ...state, entries, draftConflicts: [] };
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
  return { localState: issues.length ? "INVALID" as const : "VALID" as const,
    overallState: issues.length || state.sourceAnomalies.length
      ? "INVALID" as const : "NOT_VERIFIED" as const,
    issues, sourceAnomalies: state.sourceAnomalies,
    notVerified: ["Unloaded collection members", "Current database state",
      "Final server permissions and write eligibility"] };
}
