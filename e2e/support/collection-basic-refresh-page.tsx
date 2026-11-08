"use client";

import { useState } from "react";
import { CollectionBasicEditor } from "@/components/admin/collection-basic-editor";
import { useAdminCollectionDraftSessions, useAdminCollectionDraftVisit } from
  "@/components/admin/admin-collection-draft-sessions";
import type { AdminCollectionDetail, AdminCollectionDetailResult } from "@/lib/catalog-read/types";

// Copied into the isolated Playwright app only; never registered as a production route.
const item: AdminCollectionDetail = { id: "550e8400-e29b-41d4-a716-446655440000",
  slug: "fixture-collection", nameEn: "Original collection", nameZh: "原始集合",
  descriptionEn: "", descriptionZh: "", status: "draft", sortOrder: 1,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", publishedAt: null };
const complete = (value: AdminCollectionDetail): AdminCollectionDetailResult => ({
  state: "COMPLETE", item: value, origin: "OFFLINE_FIXTURE", issues: [] });

export default function CollectionBasicRefreshFixturePage() {
  const [detail, setDetail] = useState<AdminCollectionDetailResult>(() => complete(item));
  const visitKey = useAdminCollectionDraftVisit(item.id, detail);
  const { state, getAccessEpoch, loadMemberSource } = useAdminCollectionDraftSessions();
  const [sourceResult, setSourceResult] = useState("NOT_REQUESTED");
  const load = () => {
    if (!visitKey) return;
    void loadMemberSource(item.id, visitKey, getAccessEpoch(), "first")
      .then((result) => setSourceResult(result.code));
  };
  return <><div role="group" aria-label="Fixture collection source updates">
    <button type="button" onClick={() => setDetail(complete({ ...item }))}>Same values, new object</button>
    <button type="button" onClick={() => setDetail(complete({ ...item, nameEn: "Server changed collection" }))}>Update source</button>
    <button type="button" onClick={() => setDetail({ state: "NOT_CONNECTED", item: null,
      origin: "NONE", issues: [] })}>Disconnect source</button>
    <button type="button" onClick={load}>Load member source</button>
    <p data-testid="fixture-source-state">{state.entries[item.id]?.sourceState ?? "NONE"}</p>
    <p data-testid="fixture-source-result">{sourceResult}</p>
  </div><CollectionBasicEditor collectionId={item.id} detail={detail} visitKey={visitKey} /></>;
}
