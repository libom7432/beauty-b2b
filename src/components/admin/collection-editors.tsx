"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentProps } from "react";
import type { AdminCollectionDetailResult, AdminCollectionMemberListResult } from "@/lib/catalog-read/types";
import { createMembershipDraft, sortedMembershipEntries, sortedProposedMembers,
  validateMembershipDraft } from "@/lib/admin/collection-membership-draft";
import { candidateLocalMembershipStatus } from "@/lib/admin/collection-candidate-membership-status";
import { addVerifiedCandidateToDraft } from "@/lib/admin/collection-proposed-add-ui";
import { membershipSessionDirty, type CollectionDraftSessionCode } from
  "@/lib/admin/collection-draft-session";
import { candidateVerificationViewKey, isCurrentVerification, isFreshNotMemberVerification,
  readMembershipCheckResponse, verificationHasExpired,
  type VerificationIdentity, type VerifiedObservation } from "@/lib/admin/collection-membership-verification";
import { useAdminCollectionDraftSessions, useAdminCollectionDraftVisit } from
  "./admin-collection-draft-sessions";
import { CollectionBasicEditor } from "./collection-basic-editor";
import { CollectionCandidateSearch, type CandidateVerificationDisplay } from "./collection-candidate-search";

type VerificationState = Readonly<{ phase: "VERIFYING" | "FAILED" | "EXPIRED";
  identity: VerificationIdentity }> | Readonly<{ phase: "RESULT";
  identity: VerifiedObservation }>;

export function CollectionEditors({ collectionId, detail, members, pageKey, candidate }: {
  collectionId: string; detail: AdminCollectionDetailResult;
  members: AdminCollectionMemberListResult | null; pageKey: string;
  candidate?: Omit<ComponentProps<typeof CollectionCandidateSearch>, "membershipStatuses" |
    "verification" | "canVerify" | "onVerify" | "onAdd" |
    "onInvalidateVerification" | "actionFeedback"> | null;
}) {
  const { state, capacityErrors, identityVerified, getAccessEpoch, isCurrentAccess,
    getSnapshot, loadMemberSource, membershipAction, discardMembership } =
    useAdminCollectionDraftSessions();
  const visitKey = useAdminCollectionDraftVisit(collectionId, detail);
  const accessEpoch = getAccessEpoch();
  // The Owner locks synchronously, before React can hide an old editor. Capturing
  // this epoch also prevents a saved callback from becoming valid after unlock.
  const mayEdit = useCallback(() => identityVerified && isCurrentAccess(accessEpoch) &&
    !!visitKey && getSnapshot().state.entries[collectionId.toLowerCase()]?.activeVisitKey === visitKey,
  [identityVerified, isCurrentAccess, accessEpoch, visitKey, getSnapshot, collectionId]);
  const session = state.entries[collectionId.toLowerCase()];
  const draft = session?.membership ?? createMembershipDraft(collectionId);
  const [checked, setChecked] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const membershipDirty = session ? membershipSessionDirty(session) : false;
  const currentMembership = () => {
    if (!mayEdit()) return null;
    const current = getSnapshot().state.entries[collectionId.toLowerCase()];
    return current?.activeVisitKey === visitKey ? current : null;
  };
  const actionMessage = (code: CollectionDraftSessionCode): string =>
    code === "PAYLOAD_LIMIT" ? "Session space is insufficient. Your earlier membership draft is unchanged." :
    code === "DIRTY_COLLECTION_LIMIT" ? "Only three Collections may have unsaved drafts. Your earlier membership draft is unchanged." :
    code === "STALE_GENERATION" || code === "SOURCE_NOT_READY"
      ? "Membership source or access changed. Reopen this view and try again." :
      "Local membership draft is unavailable. No change was applied.";
  const applyMembership = (action: Parameters<typeof membershipAction>[4]) => {
    const current = currentMembership();
    return current && visitKey && session ? membershipAction(collectionId, visitKey, accessEpoch,
      session.generation, action) : "STALE_GENERATION";
  };

  const memberViewState = members?.state !== "COMPLETE" ? members?.state ?? null :
    session?.sourceState === "NEEDS_REVALIDATION" ? null : session?.sourceState ?? null;
  const sourceReady = members?.state === "COMPLETE" && !candidate?.urlPaused &&
    !!session && session.activeVisitKey === visitKey &&
    session.sourceState === "COMPLETE" && !!session.latestBasicSource &&
    !session.basicSourceChanged && session.latestBasicSource.status !== "retired";
  const canCheck = sourceReady && draft.sourceAnomalies.length === 0 &&
    draft.draftConflicts.length === 0 && !draft.limitReached;
  const validation = checked && canCheck ? validateMembershipDraft(draft) : null;
  const entries = sortedMembershipEntries(draft);
  const proposed = sortedProposedMembers(draft);
  const proposedIssues = validateMembershipDraft(draft).issues;
  const discard = () => {
    const current = currentMembership();
    if (!current || !visitKey) return;
    const code = discardMembership(collectionId, visitKey, accessEpoch,
      session?.generation ?? -1);
    if (code !== "APPLIED" && code !== "UNCHANGED") {
      setActionFeedback(actionMessage(code)); return;
    }
    setChecked(false);
    setActionFeedback(null);
    invalidateVerification();
  };
  const fullyAcceptedPages = draft.pages.filter((page) => page.status === "FULLY_ACCEPTED").length;
  const partiallyAcceptedPages = draft.pages.filter((page) => page.status === "PARTIALLY_ACCEPTED").length;
  const rejectedPages = draft.pages.filter((page) => page.status === "REJECTED").length;
  const membershipStatuses = Object.fromEntries((candidate?.result.items ?? []).map((item) =>
    [item.productId, candidateLocalMembershipStatus(draft, item.productId, memberViewState)]));
  const viewKey = candidate ? candidateVerificationViewKey(collectionId, candidate.query,
    candidate.result, !!candidate.urlPaused, `${pageKey}:${memberViewState ?? "NONE"}`) : "";
  const sequenceRef = useRef(0);
  const requestRef = useRef<AbortController | null>(null);
  const verifiedUrlRef = useRef<string | null>(null);
  const verifiedSessionGenerationRef = useRef<number | null>(null);
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const canVerify = sourceReady && !!candidate && candidate.result.state === "RESULTS" &&
    !candidate.urlPaused && draft.sourceAnomalies.length === 0 &&
    draft.draftConflicts.length === 0 && !draft.limitReached;
  const [verificationOwner, setVerificationOwner] = useState(() => ({
    key: viewKey, source: session?.generation, canVerify, generation: 0 }));
  // Local sort/remove edits keep the exact check usable. A changed source, view,
  // or blocking condition gets a new identity before old results can render.
  if (verificationOwner.key !== viewKey || verificationOwner.source !== session?.generation ||
    verificationOwner.canVerify !== canVerify) {
    setVerificationOwner({ key: viewKey, source: session?.generation, canVerify,
      generation: verificationOwner.generation + 1 });
    setVerification(null);
  }
  const invalidateVerification = useCallback(() => {
    sequenceRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
    verifiedUrlRef.current = null;
    verifiedSessionGenerationRef.current = null;
    setVerification(null);
  }, [setVerification]);
  // The Owner binds a fresh member read to this visit before sending GET. RSC
  // member props only decide whether this URL permits a read; they are not merged.
  useLayoutEffect(() => {
    if (!visitKey || !mayEdit() || members?.state !== "COMPLETE" ||
      candidate?.urlPaused || detail.state !== "COMPLETE") return;
    let live = true;
    void loadMemberSource(collectionId, visitKey, accessEpoch, pageKey).then((result) => {
      if (!live || !isCurrentAccess(accessEpoch)) return;
      if (result.code === "APPLIED" || result.code === "UNCHANGED")
        setActionFeedback(null);
      else if (result.code === "PAYLOAD_LIMIT" || result.code === "DIRTY_COLLECTION_LIMIT" ||
        result.code === "ACTION_REJECTED" || result.code === "SOURCE_NOT_READY")
        setActionFeedback(actionMessage(result.code));
    });
    return () => { live = false; };
  // A new RSC detail or member page belongs to a new read. Owner generations
  // and AbortController reject responses from a superseded visit or page.
  }, [visitKey, accessEpoch, collectionId, pageKey, detail, members, candidate?.urlPaused,
    mayEdit, loadMemberSource, isCurrentAccess]);
  useLayoutEffect(() => { invalidateVerification(); }, [accessEpoch, invalidateVerification]);
  useEffect(() => {
    sequenceRef.current++;
    requestRef.current?.abort();
    requestRef.current = null;
  }, [viewKey, session?.generation, canVerify]);
  useEffect(() => () => { sequenceRef.current++; requestRef.current?.abort(); }, []);
  const verify = (productId: string) => {
    if (!mayEdit() || !canVerify || !candidate?.result.items.some((item) => item.productId === productId) ||
      membershipStatuses[productId] !== "NOT_VERIFIED" ||
      verification?.phase === "VERIFYING" && verification.identity.productId === productId) return;
    const currentSource = currentMembership();
    if (!currentSource || currentSource.sourceState !== "COMPLETE" ||
      currentSource.generation !== session?.generation) return;
    invalidateVerification();
    setActionFeedback(null);
    const controller = new AbortController();
    requestRef.current = controller;
    const sourceGeneration = currentSource.generation;
    verifiedSessionGenerationRef.current = sourceGeneration;
    const identity: VerificationIdentity = { collectionId: collectionId.toLowerCase(),
      productId, viewKey, generation: verificationOwner.generation,
      sequence: sequenceRef.current, checkedAtMs: performance.now() };
    const startingUrl = window.location.href;
    verifiedUrlRef.current = startingUrl;
    setVerification({ phase: "VERIFYING", identity });
    const isCurrent = () => isCurrentAccess(accessEpoch) &&
      !controller.signal.aborted && startingUrl === window.location.href &&
      getSnapshot().state.entries[collectionId.toLowerCase()]?.generation === sourceGeneration &&
      getSnapshot().state.entries[collectionId.toLowerCase()]?.sourceState === "COMPLETE" &&
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
  const add = (productId: string) => {
    if (!mayEdit()) return;
    const item = candidate?.result.items.find((row) => row.productId === productId);
    const currentReady = candidate?.result.state === "RESULTS" &&
      !candidate.urlPaused && verifiedUrlRef.current === window.location.href;
    if (!item || !currentReady || !verification || verification.phase !== "RESULT") {
      setActionFeedback("Add unavailable. Verify this candidate again in the current view.");
      invalidateVerification();
      return;
    }
    try {
      const nowMs = performance.now();
      const current = currentMembership();
      if (!current || !visitKey || current.sourceState !== "COMPLETE" ||
        current.generation !== verifiedSessionGenerationRef.current) {
        setActionFeedback("Membership source changed. Verify this candidate again.");
        invalidateVerification(); return;
      }
      const attempt = addVerifiedCandidateToDraft(current.membership, item, verification.identity,
          { collectionId: collectionId.toLowerCase(), productId, viewKey,
            generation: verificationOwner.generation, sequence: sequenceRef.current },
          current.sourceState, canVerify && sourceReady, true, nowMs);
      if (attempt.result === "ADDED") {
        const code = membershipAction(collectionId, visitKey, accessEpoch,
          session?.generation ?? -1, {
          kind: "ADD_PROPOSED",
          candidate: { productId: item.productId, productCode: item.productCode,
            displayName: item.displayName, status: item.status },
          verification: { collectionId: verification.identity.collectionId,
            productId: verification.identity.productId, status: verification.identity.status,
            origin: verification.identity.origin, viewKey: verification.identity.viewKey,
            checkedAtMs: verification.identity.checkedAtMs,
            expiresAtMs: verification.identity.expiresAtMs },
          context: { collectionId: collectionId.toLowerCase(), viewKey, nowMs,
            sourceState: current.sourceState }, verificationGeneration: current.generation,
        });
        if (code !== "APPLIED") { setActionFeedback(actionMessage(code)); return; }
        setChecked(false);
        setActionFeedback("Added to local membership draft. Nothing was saved.");
      } else setActionFeedback(attempt.result === "VERIFY_AGAIN"
        ? "Verification expired or changed. Verify this candidate again."
        : "Local membership draft is unavailable for this candidate.");
      if (attempt.result === "ADDED" || attempt.result === "VERIFY_AGAIN") invalidateVerification();
    } catch {
      setActionFeedback("Local membership draft could not be checked. No product was added.");
    }
  };
  const cancel = (productId: string) => {
    if (!mayEdit()) return;
    const code = applyMembership({ kind: "CANCEL_PROPOSED", productId });
    if (code !== "APPLIED") {
      setActionFeedback("Proposed add is no longer available to cancel.");
      return;
    }
    setChecked(false);
    setActionFeedback("Proposed add canceled. Verify again before adding this product.");
    invalidateVerification();
  };
  const expireCurrentVerification = useCallback((expected?: VerifiedObservation) => {
    const nowMs = performance.now();
    setVerification((current) => {
      if (current?.phase !== "RESULT" || expected && current.identity !== expected ||
        !canVerify || verificationOwner.key !== viewKey ||
        verificationOwner.source !== session?.generation) return current;
      const currentIdentity = { collectionId: collectionId.toLowerCase(),
          productId: current.identity.productId, viewKey,
          generation: verificationOwner.generation, sequence: sequenceRef.current };
      const expired = current.identity.status === "NOT_MEMBER"
        ? !isFreshNotMemberVerification(current.identity, currentIdentity, canVerify, nowMs)
        : verificationHasExpired(current.identity, nowMs);
      if (!isCurrentVerification(current.identity, currentIdentity) || !expired) return current;
      return { phase: "EXPIRED", identity: current.identity };
    });
  }, [canVerify, collectionId, session?.generation, setVerification, verificationOwner, viewKey]);
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
    verificationOwner.source === session?.generation &&
    verification.identity.viewKey === viewKey &&
    verification.identity.generation === verificationOwner.generation ? verification : null;
  const candidateVerification: CandidateVerificationDisplay | null = visibleVerification
    ? { productId: visibleVerification.identity.productId, phase: visibleVerification.phase,
      status: visibleVerification.phase === "RESULT" ? visibleVerification.identity.status : undefined }
    : null;
  return <div data-testid="collection-editors" data-collection-id={collectionId.toLowerCase()}>
    <CollectionBasicEditor collectionId={collectionId} detail={detail} visitKey={visitKey} />
    {(detail.state === "COMPLETE" || membershipDirty) &&
      <section className="admin-card admin-editor admin-membership-editor" role="region"
        aria-label="Local collection membership editor">
        <div className="admin-editor-heading"><div><h2>Local membership draft</h2>
          <p className="admin-editor-warning">LOCAL DEMO / NOT CONNECTED · This draft stays in this tab during Admin navigation. Refresh, sign-out or closing the tab clears it. Nothing is saved to the server.</p>
        </div><span className="admin-badge admin-badge-warning">No database save</span></div>
        {detail.origin === "OFFLINE_FIXTURE" && <p><span className="admin-badge admin-badge-warning">TEST DATA</span></p>}
        <p role="status">{membershipDirty ? "Unsaved membership changes" : "No membership changes"}</p>
        <p>Only members from loaded, complete pages can be edited. Unloaded members and the total membership count remain unknown. Pages read at different times are not one database snapshot.</p>
        {memberViewState !== "COMPLETE" && <p role="alert">Current member source: {memberViewState ?? session?.sourceState ?? "UNAVAILABLE"}. No new member facts were accepted; checking is paused.</p>}
        {capacityErrors[collectionId.toLowerCase()] && <p role="alert">{actionMessage(capacityErrors[collectionId.toLowerCase()])}</p>}
        {detail.item?.status === "retired" && <p role="alert">Retired collections are read only.</p>}
        {draft.sourceAnomalies.length > 0 && <p role="alert">A source page had duplicate or invalid member identities. Checking stays blocked for this editing session, including after Discard. Refresh to request a newly verified source page.</p>}
        {draft.draftConflicts.length > 0 && <p role="alert">Loaded member source data changed while this draft was dirty. Local changes remain; checking is paused until you discard this membership draft.</p>}
        {draft.limitReached && <p role="alert">The 500-member local draft capacity was reached. Later members were not loaded into this editor; checking stays paused even after Discard.</p>}
        <p>Loaded member records: {entries.length}. Page observations: {fullyAcceptedPages} fully accepted, {partiallyAcceptedPages} partially accepted, {rejectedPages} rejected. These are local observations, not a collection total.</p>
        <p>Proposed new members: {proposed.length}. Local observed identity capacity: {new Set([
          ...Object.keys(draft.entries), ...Object.keys(draft.proposedAdds ?? {})]).size}/500. This is not the database member total.</p>
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
                  onChange={(event) => {
                    const code = applyMembership({ kind: "SORT_EXISTING", productId: id,
                      sortOrderText: event.target.value });
                    if (code === "APPLIED" || code === "UNCHANGED") setChecked(false);
                    else setActionFeedback(actionMessage(code));
                  }} />
                {error && <p id={`${fieldId}-error`} role="alert">{error.message}</p>}
                <button type="button" disabled={!sourceReady}
                  onClick={() => {
                    const current = currentMembership();
                    if (!current) return;
                    const code = applyMembership({ kind: current.membership.entries[id.toLowerCase()]?.removed
                      ? "RESTORE" : "REMOVE", productId: id });
                    if (code === "APPLIED" || code === "UNCHANGED") setChecked(false);
                    else setActionFeedback(actionMessage(code));
                  }}>
                  {entry.removed ? "Restore locally" : "Remove locally"}</button>
                {entry.removed && <p>Proposed removal only. The original link remains unchanged.</p>}
              </div>
            </div>;
          })}
        </div>
        {entries.length === 0 && <p>No trusted member rows have been loaded into this local draft.</p>}
        {proposed.length > 0 && <div className="admin-membership-proposed" role="group" aria-label="Proposed new members">
          <h3>Proposed new members — local draft only</h3>
          <div className="admin-membership-rows">{proposed.map((item) => {
            const fieldId = `proposed-sort-${item.productId}`;
            const error = proposedIssues.find((issue) =>
              issue.field_path === `proposedAdds.${item.productId}.sort_order`);
            return <div className="admin-editor-row" key={item.productId} data-proposed-product-id={item.productId}>
              <div><strong>{item.productCode}</strong><p>{item.displayName?.trim() || "名称不可用"}</p>
                <p>Product UUID: {item.productId}</p><p>Product status: {item.productStatus}</p>
                <p>Proposed addition only. No collection link has been saved.</p></div>
              <div><label htmlFor={fieldId}>Local sort order for proposed {item.productCode}</label>
                <input id={fieldId} value={item.sortOrderText} inputMode="numeric"
                  aria-invalid={!!error} aria-describedby={error ? `${fieldId}-error` : undefined}
                  onChange={(event) => {
                    const code = applyMembership({ kind: "SORT_PROPOSED",
                      productId: item.productId, sortOrderText: event.target.value });
                    if (code === "APPLIED" || code === "UNCHANGED") setChecked(false);
                    else setActionFeedback(actionMessage(code));
                  }} />
                {error && <p id={`${fieldId}-error`} role="alert">{error.message}</p>}
                <button type="button" onClick={() => cancel(item.productId)}>Cancel proposed add</button>
              </div>
            </div>;
          })}</div>
        </div>}
        <div className="admin-editor-actions">
          <button type="button" disabled={!canCheck} onClick={() => { if (mayEdit()) setChecked(true); }}>Check membership draft</button>
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
      onAdd={add} onInvalidateVerification={invalidateVerification} actionFeedback={actionFeedback} />}
  </div>;
}
