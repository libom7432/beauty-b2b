import type { AdminCollectionMemberListResult } from "../catalog-read/types.ts";
import type { CandidateRow } from "./collection-candidate-search.ts";
import { addProposedMember, type MembershipDraft } from "./collection-membership-draft.ts";
import { isFreshNotMemberVerification, type VerificationIdentity,
  type VerifiedObservation } from "./collection-membership-verification.ts";

export type ProposedAddAttempt = Readonly<{
  draft: MembershipDraft; result: "ADDED" | "VERIFY_AGAIN" | "DRAFT_UNAVAILABLE";
}>;

/** The click-time adapter checks current UI identity before calling the strict draft transition. */
export function addVerifiedCandidateToDraft(draft: MembershipDraft, candidate: CandidateRow,
  observation: VerifiedObservation | null,
  current: Pick<VerificationIdentity, "collectionId" | "productId" | "viewKey" |
    "generation" | "sequence">,
  sourceState: AdminCollectionMemberListResult["state"] | null,
  sourceReady: boolean, candidateVisible: boolean, nowMs: number): ProposedAddAttempt {
  if (!sourceReady || sourceState !== "COMPLETE" || !candidateVisible ||
    draft.sourceAnomalies.length > 0 || draft.draftConflicts.length > 0 || draft.limitReached)
    return { draft, result: "DRAFT_UNAVAILABLE" };
  if (!observation || candidate.productId !== current.productId ||
    !isFreshNotMemberVerification(observation, current, true, nowMs))
    return { draft, result: "VERIFY_AGAIN" };
  const verification = {
    collectionId: observation.collectionId, productId: observation.productId,
    status: observation.status, origin: observation.origin, viewKey: observation.viewKey,
    checkedAtMs: observation.checkedAtMs, expiresAtMs: observation.expiresAtMs,
  };
  const context = { collectionId: current.collectionId, viewKey: current.viewKey,
    nowMs, sourceState };
  const next = addProposedMember(draft, {
    productId: candidate.productId, productCode: candidate.productCode,
    displayName: candidate.displayName, status: candidate.status,
  }, verification, context);
  return Object.hasOwn(next.proposedAdds ?? {}, candidate.productId.toLowerCase()) &&
    !Object.hasOwn(draft.proposedAdds ?? {}, candidate.productId.toLowerCase())
    ? { draft: next, result: "ADDED" }
    : { draft: next, result: "DRAFT_UNAVAILABLE" };
}
