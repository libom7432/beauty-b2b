"use client";

import { useState } from "react";
import type { AdminCollectionDetailResult } from "@/lib/catalog-read/types";
import { canEditCollectionSlug, validateCollectionBasicDraft,
  type CollectionBasicDraft } from "@/lib/admin/collection-basic-editor-draft";
import type { CollectionDraftSessionCode } from
  "@/lib/admin/collection-draft-session";
import { sessionBasicDirty, useAdminCollectionDraftSessions } from "./admin-collection-draft-sessions";

export function CollectionBasicEditor({ collectionId, detail, visitKey }: {
  collectionId: string; detail: AdminCollectionDetailResult; visitKey: string | null;
}) {
  const { state, capacityErrors, editBasic, discardBasic, identityVerified } =
    useAdminCollectionDraftSessions();
  const current = detail.state === "COMPLETE" ? detail.item : null;
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const entry = state.entries[collectionId.toLowerCase()];
  const selection = entry?.basic ?? null;
  const dirty = sessionBasicDirty(state, collectionId);
  const sourceChanged = !!selection && (!entry?.latestBasicSource || entry.basicSourceChanged);

  const feedbackFor = (code: CollectionDraftSessionCode): string | null => {
    if (code === "PAYLOAD_LIMIT") return "Session space is insufficient for this change. Your earlier draft is unchanged.";
    if (code === "DIRTY_COLLECTION_LIMIT") return "Only three Collections may have unsaved drafts. Your earlier draft is unchanged.";
    if (code === "SOURCE_NOT_READY" || code === "STALE_GENERATION")
      return "This source needs a fresh read before editing. Your earlier draft is unchanged.";
    if (code === "ACTION_REJECTED") return "This change could not be applied. Your earlier draft is unchanged.";
    return null;
  };

  const capacityError = capacityErrors[collectionId.toLowerCase()];
  const capacityMessage = capacityError === "DIRTY_COLLECTION_LIMIT"
    ? "Only three Collections may have unsaved drafts. Your earlier draft is unchanged."
    : "Session space is insufficient for this change. Your earlier draft is unchanged.";
  if (!identityVerified || !visitKey) return null;
  if (!selection || !current && !dirty) return feedback || capacityError
    ? <section className="admin-card admin-editor" role="region" aria-label="Local collection basic editor">
      <p role="alert">{feedback || capacityMessage}</p></section> : null;
  const { original, draft } = selection;
  const retired = original.status === "retired";
  const controlsDisabled = sourceChanged || retired;
  const validation = checked && !sourceChanged ? validateCollectionBasicDraft(original, draft) : null;
  const update = <K extends keyof CollectionBasicDraft>(field: K, value: CollectionBasicDraft[K]) => {
    const code = editBasic(collectionId, visitKey, field, value);
    setFeedback(feedbackFor(code));
    if (code === "APPLIED" || code === "UNCHANGED") setChecked(false);
  };
  const discard = () => {
    const result = discardBasic(collectionId, visitKey);
    setFeedback(feedbackFor(result.code));
    if (result.code === "APPLIED" || result.code === "UNCHANGED") {
      setChecked(false);
      setEditing(false);
    }
  };
  return <section className="admin-card admin-editor" role="region" aria-label="Local collection basic editor">
    <div className="admin-editor-heading"><div><h2>Local collection basic draft</h2>
      <p className="admin-editor-warning">LOCAL DEMO / NOT CONNECTED · This Basic draft stays in this tab during Admin navigation. Refresh, sign-out or closing the tab clears it. Nothing is saved to the server.</p>
    </div><span className="admin-badge admin-badge-warning">No database save</span></div>
    {sourceChanged && <p role="alert">Source data has changed or is unavailable. This draft is based on an earlier read. Check draft is paused. Discard changes to load the current trusted data.</p>}
    {(feedback || capacityError) && <p role="alert">{feedback || capacityMessage}</p>}
    <p role="status">{dirty ? "Unsaved local changes" : "No local changes"}</p>
    {!editing && !retired && !sourceChanged && <button type="button" onClick={() => setEditing(true)}>Edit local draft</button>}
    {retired && <p>Retired is terminal. All fields are read only.</p>}
    {editing && <>
      <div className="admin-editor-grid">
        <fieldset disabled={controlsDisabled}><legend>Names and descriptions</legend>
          <label>English name<input value={draft.nameEn} onChange={(event) => update("nameEn", event.target.value)} /></label>
          <label>中文名称<input value={draft.nameZh} onChange={(event) => update("nameZh", event.target.value)} /></label>
          <label>English description<textarea value={draft.descriptionEn} onChange={(event) => update("descriptionEn", event.target.value)} /></label>
          <label>中文描述<textarea value={draft.descriptionZh} onChange={(event) => update("descriptionZh", event.target.value)} /></label>
        </fieldset>
        <fieldset disabled={controlsDisabled}><legend>Collection state</legend>
          <label>Slug<input value={draft.slug} readOnly={!canEditCollectionSlug(original)}
            aria-readonly={!canEditCollectionSlug(original)} onChange={(event) => update("slug", event.target.value)} /></label>
          {!canEditCollectionSlug(original) && <p>Slug is locked because this collection was previously published or is not an unpublished Draft.</p>}
          <label>Status<select value={draft.status} onChange={(event) => update("status", event.target.value as CollectionBasicDraft["status"])}>
            {(["draft", "published", "retired"] as const).map((status) => <option key={status} value={status}>{status}</option>)}
          </select></label>
          <label>Sort order<input value={draft.sortOrderText} inputMode="numeric"
            onChange={(event) => update("sortOrderText", event.target.value)} /></label>
        </fieldset>
      </div>
      <div className="admin-editor-actions">
        <button type="button" disabled={controlsDisabled} onClick={() => setChecked(true)}>Check draft</button>
        <button type="button" onClick={discard}>Discard changes</button>
      </div>
      {validation && <div className="admin-editor-validation" aria-live="polite">
        <strong>Local fields: {validation.localState}</strong>
        <p>Full database and publication checks: {validation.overallState}</p>
        {validation.issues.length > 0 && <ul aria-label="Collection draft errors">{validation.issues.map((issue, index) =>
          <li key={`${issue.field_path}-${issue.error_code}-${index}`} data-field-path={issue.field_path}>
            {issue.field_path}: {issue.error_code} — {issue.message}</li>)}</ul>}
        <ul aria-label="Not verified checks">{validation.notVerified.map((reason) =>
          <li key={reason}>{reason}: NOT_VERIFIED</li>)}</ul>
      </div>}
    </>}
    <fieldset className="admin-editor-metadata"><legend>Read-only source metadata</legend>
      <dl className="admin-detail-list"><div><dt>Collection UUID</dt><dd>{original.id}</dd></div>
        <div><dt>Created at</dt><dd>{original.createdAt}</dd></div>
        <div><dt>Updated at</dt><dd>{original.updatedAt}</dd></div>
        <div><dt>Published at</dt><dd>{original.publishedAt ?? "Not published"}</dd></div></dl>
    </fieldset>
  </section>;
}
