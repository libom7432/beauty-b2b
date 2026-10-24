"use client";

import { useState } from "react";
import { CollectionEditors } from "@/components/admin/collection-editors";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "@/lib/catalog-read/types";

// Copied into the temporary Playwright project only; never registered as a production route.
const collectionId = "550e8400-e29b-41d4-a716-446655440000";
const productId = "550e8400-e29b-41d4-a716-446655440001";
const detail: AdminCollectionDetailResult = { state: "COMPLETE", origin: "OFFLINE_FIXTURE",
  issues: [], item: { id: collectionId, slug: "fixture-collection", nameEn: "Fixture collection",
    nameZh: "测试集合", descriptionEn: "", descriptionZh: "", status: "draft",
    sortOrder: 0, publishedAt: null, createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z" } };
const complete = (sortOrder = 1, nameEn = "Original product"): AdminCollectionMemberListResult => ({
  state: "COMPLETE", origin: "OFFLINE_FIXTURE", issues: [], nextCursor: null,
  previousCursor: null, items: [{ productId, productCode: "TEST-1", nameEn,
    nameZh: "测试商品", productStatus: "published", sortOrder }] });
const duplicate = (): AdminCollectionMemberListResult => {
  const result = complete();
  return { ...result, items: [...result.items, { ...result.items[0], sortOrder: 2 }] };
};
const unavailable = (state: "INCOMPLETE" | "ERROR" | "NOT_CONNECTED" | "EMPTY_PAGE"):
  AdminCollectionMemberListResult => ({ state, origin: "NONE", issues: [], items: [],
    nextCursor: null, previousCursor: null });

export default function CollectionMembershipRefreshFixturePage() {
  const [members, setMembers] = useState<AdminCollectionMemberListResult>(() => complete());
  return <><div role="group" aria-label="Fixture member source updates">
    <button type="button" onClick={() => setMembers(complete())}>Same values, new object</button>
    <button type="button" onClick={() => setMembers(duplicate())}>Duplicate source IDs</button>
    <button type="button" onClick={() => setMembers(complete(2, "Updated product"))}>Update source</button>
    <button type="button" onClick={() => setMembers(unavailable("INCOMPLETE"))}>Incomplete source</button>
    <button type="button" onClick={() => setMembers(unavailable("ERROR"))}>Error source</button>
    <button type="button" onClick={() => setMembers(unavailable("NOT_CONNECTED"))}>Disconnect source</button>
    <button type="button" onClick={() => setMembers(unavailable("EMPTY_PAGE"))}>Empty page</button>
    <button type="button" onClick={() => setMembers(complete(2, "Updated product"))}>Reconnect</button>
  </div><CollectionEditors collectionId={collectionId} detail={detail}
    members={members} pageKey="fixture-first" /></>;
}
