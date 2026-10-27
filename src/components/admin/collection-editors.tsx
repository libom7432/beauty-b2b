"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "@/lib/catalog-read/types";
import { changeMembershipOrder, createMembershipDraft, discardMembershipDraft,
  ingestMembershipPage, markMembershipRemoved, membershipIsDirty,
  sortedMembershipEntries, validateMembershipDraft } from "@/lib/admin/collection-membership-draft";
import { candidateLocalMembershipStatus } from "@/lib/admin/collection-candidate-membership-status";
import { candidateVerificationViewKey, isCurrentVerification, isFreshNotMemberVerification,
  readMembershipCheckResponse, verificationHasExpired,
  type VerificationIdentity, type VerifiedObservation } from "@/lib/admin/collection-membership-verification";
import { useAdminUnsavedChanges } from "./admin-unsaved-changes";
import { CollectionBasicEditor } from "./collection-basic-editor";
import { CollectionCandidateSearch, type CandidateVerificationDisplay } from "./collection-candidate-search";

type VerificationState = Readonly<{ phase: "VERIFYING" | "FAILED" | "EXPIRED";
  identity: VerificationIdentity }> | Readonly<{ phase: "RESULT";
  identity: VerifiedObservation }>;

export function CollectionEditors({ collectionId, detail, members, pageKey, candidate }: {
  collectionId: string; detail: AdminCollectionDetailResult;
  members: AdminCollectionMemberListResult | null; pageKey: string;
  candidate?: Omit<ComponentProps<typeof CollectionCandidateSearch>, "membershipStatuses" |
    "verification" | "canVerify" | "onVerify" | "onInvalidateVerification"> | null;
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
  const membershipStatuses = Object.fromEntries((candidate?.result.items ?? []).map((item) =>
    [item.productId, candidateLocalMembershipStatus(draft, item.productId, members?.state ?? null)]));
  const viewKey = candidate ? candidateVerificationViewKey(collectionId, candidate.query,
    candidate.result, !!candidate.urlPaused, `${pageKey}:${members?.state ?? "NONE"}`) : "";
  const sequenceRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const canVerify = sourceReady && !!candidate && candidate.result.state === "RESULTS" &&
    !candidate.urlPaused && draft.sourceAnomalies.length === 0 &&
    draft.draftConflicts.length === 0 && !draft.limitReached;
  const [verificationOwner, setVerificationOwner] = useState(() => ({
    key: viewKey, draft, canVerify, generation: 0 }));
  // A changed view or draft gets a new identity before old results can render.
  if (verificationOwner.key !== viewKey || verificationOwner.draft !== draft ||
    verificationOwner.canVerify !== canVerify) {
    setVerificationOwner({ key: viewKey, draft, canVerify,
      generation: verificationOwner.generation + 1 });
    setVerification(null);
  }
  const invalidateVerification = useCallback(() => {
    sequenceRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    setVerification(null);
  }, []);
  useEffect(() => {
    sequenceRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
  }, [viewKey, draft, canVerify]);
  useEffect(() => () => { sequenceRef.current++; requestRef.current?.abort(); }, []);
  const verify = (productId: string) => {
    if (!canVerify || !candidate?.result.items.some((item) => item.productId === productId) ||
      membershipStatuses[productId] !== "NOT_VERIFIED" ||
      verification?.phase === "VERIFYING" && verification.identity.productId === productId) return;
    invalidateVerification();
    const controller = new AbortController();
    requestRef.current = controller;
    const identity: VerificationIdentity = { collectionId: collectionId.toLowerCase(),
      productId, viewKey, generation: verificationOwner.generation,
      sequence: sequenceRef.current, checkedAtMs: performance.now() };
    const startingUrl = window.location.href;
    setVerification({ phase: "VERIFYING", identity });
    const isCurrent = () => !controller.signal.aborted && startingUrl === window.location.href &&
      isCurrentVerification(identity, { collectionId: collectionId.toLowerCase(), productId,
        viewKey, generation: verificationOwner.generation,
        sequence: sequenceRef.current });
    void (async () => {
      try {
        const url = `/api/admin/collections/${encodeURIComponent(collectionId)}/membership-check?productId=${encodeURIComponent(productId)}`;
        const response = await fetch(url, { method: "GET", cache: "no-store", signal: controller.signal });
        if (!isCurrent()) return;
        if (response.status !== 200 || !response.headers.get("Content-Type")?.includes("application/json") ||
          !response.headers.get("Cache-Control")?.includes("no-store")) {
          setVerification({ phase: "FAILED", identity }); return;
        }
        const body: unknown = await response.json();
        if (!isCurrent()) return;
        const now = performance.now();
        const observation = readMembershipCheckResponse(response.status, body, identity, now);
        setVerification(observation ? { phase: "RESULT", identity: observation } :
          { phase: now >= identity.checkedAtMs + 30_000 ? "EXPIRED" : "FAILED", identity });
      } catch {
        if (isCurrent()) setVerification({ phase: "FAILED", identity });
      } finally { if (requestRef.current === controller) requestRef.current = null; }
    })();
  };
  const expireCurrentVerification = useCallback((expected?: VerifiedObservation) => {
    const nowMs = performance.now();
    setVerification((current) => {
      if (current?.phase !== "RESULT" || expected && current.identity !== expected ||
        !canVerify || verificationOwner.key !== viewKey || verificationOwner.draft !== draft) return current;
      const currentIdentity = { collectionId: collectionId.toLowerCase(),
          productId: current.identity.productId, viewKey,
          generation: verificationOwner.generation, sequence: sequenceRef.current };
      const expired = current.identity.status === "NOT_MEMBER"
        ? !isFreshNotMemberVerification(current.identity, currentIdentity, canVerify, nowMs)
        : verificationHasExpired(current.identity, nowMs);
      if (!isCurrentVerification(current.identity, currentIdentity) || !expired) return current;
      return { phase: "EXPIRED", identity: current.identity };
    });
  }, [canVerify, collectionId, draft, verificationOwner, viewKey]);
  useEffect(() => {
    if (verification?.phase !== "RESULT") return;
    const remaining = verification.identity.expiresAtMs - performance.now();
    if (remaining <= 0) { expireCurrentVerification(verification.identity); return; }
    const timer = window.setTimeout(() => expireCurrentVerification(verification.identity), remaining);
    return () => window.clearTimeout(timer);
  }, [verification, expireCurrentVerification]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") expireCurrentVerification();
    };
    const onFocus = () => expireCurrentVerification();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [expireCurrentVerification]);
  // A separate render can happen while a background timer is delayed. Correct the
  // stored phase before that render is painted, without reading time during render.
  useLayoutEffect(() => {
    if (verification?.phase === "RESULT") expireCurrentVerification();
  });
  const visibleVerification = verification && canVerify && verificationOwner.key === viewKey &&
    verificationOwner.draft === draft &&
    verification.identity.viewKey === viewKey &&
    verification.identity.generation === verificationOwner.generation ? verification : null;
  const candidateVerification: CandidateVerificationDisplay | null = visibleVerification
    ? { productId: visibleVerification.identity.productId, phase: visibleVerification.phase,
      status: visibleVerification.phase === "RESULT" ? visibleVerification.identity.status : undefined }
    : null;
  return <div data-testid="collection-editors" data-collection-id={collectionId.toLowerCase()}>
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
    {candidate && <CollectionCandidateSearch {...candidate} membershipStatuses={membershipStatuses}
      verification={candidateVerification} canVerify={canVerify} onVerify={verify}
      onInvalidateVerification={invalidateVerification} />}
  </div>;
}
