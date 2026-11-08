"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { CollectionEditors } from "@/components/admin/collection-editors";
import { useAdminCollectionDraftSessions } from "@/components/admin/admin-collection-draft-sessions";
import type { CandidateQuery, CandidateResult } from "@/lib/admin/collection-candidate-search";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "@/lib/catalog-read/types";

// Copied into the temporary Playwright project only; never registered as a production route.
const collectionId = "550e8400-e29b-41d4-a716-446655440000";
const productId = "550e8400-e29b-41d4-a716-446655440001";
const candidateId = "550e8400-e29b-41d4-a716-446655440002";
const candidateQuery: CandidateQuery = { search: "", status: "all", cursor: null, direction: "after" };
const candidateResult: CandidateResult = { state: "RESULTS", items: [{ productId: candidateId,
  productCode: "TEST-2", displayName: "Fixture candidate", status: "published" }],
  nextCursor: null, previousCursor: null };
const detail: AdminCollectionDetailResult = { state: "COMPLETE", origin: "OFFLINE_FIXTURE",
  issues: [], item: { id: collectionId, slug: "fixture-collection", nameEn: "Fixture collection",
    nameZh: "测试集合", descriptionEn: "", descriptionZh: "", status: "draft",
    sortOrder: 0, publishedAt: null, createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z" } };
const complete = (sortOrder = 1, nameEn = "Original product", candidateIsMember = false): AdminCollectionMemberListResult => ({
  state: "COMPLETE", origin: "OFFLINE_FIXTURE", issues: [], nextCursor: null,
  previousCursor: null, items: [{ productId, productCode: "TEST-1", nameEn,
    nameZh: "测试商品", productStatus: "published", sortOrder },
    ...(candidateIsMember ? [{ productId: candidateId, productCode: "TEST-2",
      nameEn: "Fixture candidate", nameZh: null, productStatus: "published" as const,
      sortOrder: 3 }] : [])] });
const duplicate = (): AdminCollectionMemberListResult => {
  const result = complete();
  return { ...result, items: [...result.items, { ...result.items[0], sortOrder: 2 }] };
};
const unavailable = (state: "INCOMPLETE" | "ERROR" | "NOT_CONNECTED" | "EMPTY_PAGE"):
  AdminCollectionMemberListResult => ({ state, origin: "NONE", issues: [], items: [],
    nextCursor: null, previousCursor: null });

function VerificationFixtureProbe() {
  const { getSnapshot, getAccessEpoch, isCurrentAccess } = useAdminCollectionDraftSessions();
  useEffect(() => {
    const target = window as Window & { verificationFixtureSnapshot?: () => object };
    target.verificationFixtureSnapshot = () => {
      const entry = getSnapshot().state.entries[collectionId];
      const accessEpoch = getAccessEpoch();
      return { accessEpoch, accessOpen: isCurrentAccess(accessEpoch),
        generation: entry?.generation ?? null, sourceState: entry?.sourceState ?? null,
        visitActive: !!entry?.activeVisitKey };
    };
    return () => { delete target.verificationFixtureSnapshot; };
  }, [getSnapshot, getAccessEpoch, isCurrentAccess]);
  return null;
}

export default function CollectionMembershipRefreshFixturePage() {
  const [members, setMembers] = useState<AdminCollectionMemberListResult>(() => complete());
  useLayoutEffect(() => {
    document.cookie = "membership-source-mode=same; Path=/; SameSite=Lax";
  }, []);
  const change = (mode: string, next: AdminCollectionMemberListResult) => {
    // The isolated read-only fixture route observes the same source change that
    // the RSC-like props expose. Production membership never trusts these props.
    document.cookie = `membership-source-mode=${mode}; Path=/; SameSite=Lax`;
    setMembers(next);
  };
  return <><div role="group" aria-label="Fixture member source updates">
    <button type="button" onClick={() => change("same", complete())}>Same values, new object</button>
    <button type="button" onClick={() => change("duplicate", duplicate())}>Duplicate source IDs</button>
    <button type="button" onClick={() => change("updated", complete(2, "Updated product"))}>Update source</button>
    <button type="button" onClick={() => change("candidate-member", complete(2, "Updated product", true))}>Candidate becomes member</button>
    <button type="button" onClick={() => change("incomplete", unavailable("INCOMPLETE"))}>Incomplete source</button>
    <button type="button" onClick={() => change("error", unavailable("ERROR"))}>Error source</button>
    <button type="button" onClick={() => change("disconnected", unavailable("NOT_CONNECTED"))}>Disconnect source</button>
    <button type="button" onClick={() => change("empty", unavailable("EMPTY_PAGE"))}>Empty page</button>
    <button type="button" onClick={() => change("updated", complete(2, "Updated product"))}>Reconnect</button>
  </div><VerificationFixtureProbe /><CollectionEditors collectionId={collectionId} detail={detail}
    members={members} pageKey="first" candidate={{ collectionId, memberUrlEntries: [],
      query: candidateQuery, result: candidateResult, testData: true,
      hasCandidateCursor: false, urlPaused: false, nextHref: null, previousHref: null,
      firstHref: `/admin/collections/${collectionId}` }} /></>;
}
