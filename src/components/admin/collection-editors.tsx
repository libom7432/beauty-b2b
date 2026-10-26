"use client";

import { useCallback, useEffect, useState, type ComponentProps } from "react";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "@/lib/catalog-read/types";
import { changeMembershipOrder, createMembershipDraft, discardMembershipDraft,
  ingestMembershipPage, markMembershipRemoved, membershipIsDirty,
  sortedMembershipEntries, validateMembershipDraft } from "@/lib/admin/collection-membership-draft";
import { useAdminUnsavedChanges } from "./admin-unsaved-changes";
import { CollectionBasicEditor } from "./collection-basic-editor";
import { CollectionCandidateSearch } from "./collection-candidate-search";

export function CollectionEditors({ collectionId, detail, members, pageKey, candidate }: {
  collectionId: string; detail: AdminCollectionDetailResult;
  members: AdminCollectionMemberListResult | null; pageKey: string;
  candidate?: ComponentProps<typeof CollectionCandidateSearch> | null;
}) {
  const { setDirty } = useAdminUnsavedChanges();
  const [basicDirty, setBasicDirty] = useState(false);
  const [draft, setDraft] = useState(() => members?.state === "COMPLETE"
    ? ingestMembershipPage(createMembershipDraft(collectionId), pageKey, members)
    : createMembershipDraft(collectionId));
  const [checked, setChecked] = useState(false);
  const [observed, setObserved] = useState(() => ({ members, pageKey, collectionId }));
  // Adjust only this local draft when a trusted server page changes. React immediately
  // retries the render; shared navigation state is updated only from the effect below.
  if (members !== observed.members || pageKey !== observed.pageKey || collectionId !== observed.collectionId) {
    setObserved({ members, pageKey, collectionId });
    if (members?.state === "COMPLETE") setDraft((previous) => ingestMembershipPage(
      previous.collectionId === collectionId.toLowerCase() ? previous : createMembershipDraft(collectionId),
      pageKey, members));
  }
  const reportBasicDirty = useCallback((value: boolean) => setBasicDirty(value), []);
  const membershipDirty = membershipIsDirty(draft);
  const combinedDirty = basicDirty || membershipDirty;
  useEffect(() => { setDirty(combinedDirty); }, [combinedDirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);

  const sourceReady = detail.state === "COMPLETE" && !!detail.item && detail.item.status !== "retired" &&
    members?.state === "COMPLETE";
  const canCheck = sourceReady && draft.sourceAnomalies.length === 0 &&
    draft.draftConflicts.length === 0 && !draft.limitReached;
  const validation = checked && canCheck ? validateMembershipDraft(draft) : null;
  const entries = sortedMembershipEntries(draft);
  const discard = () => {
    setDraft((previous) => discardMembershipDraft(previous));
    setChecked(false);
  };
  const fullyAcceptedPages = draft.pages.filter((page) => page.status === "FULLY_ACCEPTED").length;
  const partiallyAcceptedPages = draft.pages.filter((page) => page.status === "PARTIALLY_ACCEPTED").length;
  const rejectedPages = draft.pages.filter((page) => page.status === "REJECTED").length;
  return <>
    <CollectionBasicEditor detail={detail} onDirtyChange={reportBasicDirty} />
    {(detail.state === "COMPLETE" || membershipDirty) &&
      <section className="admin-card admin-editor admin-membership-editor" role="region"
        aria-label="Local collection membership editor">
        <div className="admin-editor-heading"><div><h2>Local membership draft</h2>
          <p className="admin-editor-warning">LOCAL DEMO / NOT CONNECTED · Changes are only in this tab. Refresh or departure discards them. Nothing is saved to the server.</p>
        </div><span className="admin-badge admin-badge-warning">No database save</span></div>
        {detail.origin === "OFFLINE_FIXTURE" && <p><span className="admin-badge admin-badge-warning">TEST DATA</span></p>}
        <p role="status">{membershipDirty ? "Unsaved membership changes" : "No membership changes"}</p>
        <p>Only members from loaded, complete pages can be edited. Unloaded members and the total membership count remain unknown. Pages read at different times are not one database snapshot.</p>
        {members?.state !== "COMPLETE" && <p role="alert">Current member page: {members?.state ?? "UNAVAILABLE"}. No new member facts were accepted; checking is paused.</p>}
        {detail.item?.status === "retired" && <p role="alert">Retired collections are read only.</p>}
        {draft.sourceAnomalies.length > 0 && <p role="alert">A source page had duplicate or invalid member identities. Checking stays blocked for this editing session, including after Discard. Refresh to request a newly verified source page.</p>}
        {draft.draftConflicts.length > 0 && <p role="alert">Loaded member source data changed while this draft was dirty. Local changes remain; checking is paused until you discard this membership draft.</p>}
        {draft.limitReached && <p role="alert">The 500-member local draft capacity was reached. Later members were not loaded into this editor; checking stays paused even after Discard.</p>}
        <p>Loaded member records: {entries.length}. Page observations: {fullyAcceptedPages} fully accepted, {partiallyAcceptedPages} partially accepted, {rejectedPages} rejected. These are local observations, not a collection total.</p>
        <div className="admin-membership-rows">
          {entries.map((entry) => {
            const id = entry.original.productId;
            const fieldId = `membership-sort-${id}`;
            const error = checked && validation?.issues.find((issue) =>
              issue.field_path === `members.${id.toLowerCase()}.sort_order`);
            return <div className="admin-editor-row" key={id} data-product-id={id}>
              <div><strong>{entry.original.productCode ?? "Code unavailable"}</strong>
                <p>{entry.original.nameEn ?? entry.original.nameZh ?? "Name unavailable"}</p>
                <p>Product UUID: {id}</p><p>Product status: {entry.original.productStatus ?? "Unknown"}</p>
                <p>Source sort order: {entry.original.sortOrder}</p>
              </div>
              <div><label htmlFor={fieldId}>Local sort order for {entry.original.productCode ?? id}</label>
                <input id={fieldId} value={entry.sortOrderText} inputMode="numeric"
                  disabled={!sourceReady || entry.removed}
                  aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined}
                  onChange={(event) => { setDraft((previous) => changeMembershipOrder(previous, id, event.target.value)); setChecked(false); }} />
                {error && <p id={`${fieldId}-error`} role="alert">{error.message}</p>}
                <button type="button" disabled={!sourceReady}
                  onClick={() => { setDraft((previous) => markMembershipRemoved(previous, id, !entry.removed)); setChecked(false); }}>
                  {entry.removed ? "Restore locally" : "Remove locally"}</button>
                {entry.removed && <p>Proposed removal only. The original link remains unchanged.</p>}
              </div>
            </div>;
          })}
        </div>
        {entries.length === 0 && <p>No trusted member rows have been loaded into this local draft.</p>}
        <div className="admin-editor-actions">
          <button type="button" disabled={!canCheck} onClick={() => setChecked(true)}>Check membership draft</button>
          <button type="button" onClick={discard}>Discard membership changes</button>
        </div>
        {validation && <div className="admin-editor-validation" aria-live="polite">
          <strong>Local fields: {validation.localState}</strong>
          <p>Full membership and write checks: {validation.overallState}</p>
          {validation.issues.length > 0 && <ul aria-label="Membership draft errors">
            {validation.issues.map((issue) => <li key={issue.field_path}>
              {issue.field_path}: {issue.error_code} — {issue.message}</li>)}
          </ul>}
          <ul aria-label="Membership not verified checks">{validation.notVerified.map((reason) =>
            <li key={reason}>{reason}: NOT_VERIFIED</li>)}</ul>
        </div>}
      </section>}
    {candidate && <CollectionCandidateSearch {...candidate} />}
  </>;
}
