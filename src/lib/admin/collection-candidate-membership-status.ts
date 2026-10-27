import type { AdminCollectionMemberListResult } from "../catalog-read/types.ts";
import type { MembershipDraft } from "./collection-membership-draft.ts";

export type CandidateLocalMembershipStatus = "DRAFT_ADDED" | "PENDING_REMOVAL" |
  "ALREADY_MEMBER" | "MEMBERSHIP_UNAVAILABLE" | "NOT_VERIFIED";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only loaded draft facts can identify a member. Missing rows never prove non-membership. */
export function candidateLocalMembershipStatus(draft: MembershipDraft, productId: string,
  currentSourceState: AdminCollectionMemberListResult["state"] | null = "COMPLETE"
): CandidateLocalMembershipStatus {
  if (typeof productId !== "string" || !UUID.test(productId)) return "MEMBERSHIP_UNAVAILABLE";
  const id = productId.toLowerCase();
  const proposed = Object.hasOwn(draft.proposedAdds ?? {}, id);
  const existing = Object.hasOwn(draft.entries, id) ? draft.entries[id] : undefined;
  // A newly observed member contradicts a proposed add for the same UUID.
  if (proposed && (existing || draft.draftConflicts.includes(id))) return "MEMBERSHIP_UNAVAILABLE";
  if (proposed) return "DRAFT_ADDED";
  if (existing) return existing.removed ? "PENDING_REMOVAL" : "ALREADY_MEMBER";
  if (currentSourceState !== "COMPLETE" || draft.sourceAnomalies.length > 0 ||
    draft.draftConflicts.length > 0 || draft.limitReached) return "MEMBERSHIP_UNAVAILABLE";
  return "NOT_VERIFIED";
}
