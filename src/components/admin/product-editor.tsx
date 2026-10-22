"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminProductDetailView } from "@/lib/admin/product-detail-view";
import { canEditProductSlug, validateProductEditorDraft } from "@/lib/admin/product-editor-validation";
import { changePrimaryCategory, choosePrimaryImage, createProductEditorDraft,
  moveProductImage, productEditorFingerprint, type ProductEditorDraft } from "@/lib/admin/product-editor-draft";
import { useAdminUnsavedChanges } from "./admin-unsaved-changes";

type Locale = "en" | "zh";
type TranslationField = keyof ProductEditorDraft["translations"]["en"];
const statusChoices = ["draft", "published", "retired"] as const;

export function ProductEditor({ product }: { product: AdminProductDetailView }) {
  const original = useMemo(() => createProductEditorDraft(product), [product]);
  const originalFingerprint = useMemo(() => productEditorFingerprint(original), [original]);
  const [draft, setDraft] = useState<ProductEditorDraft>(original);
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState(false);
  const { setDirty } = useAdminUnsavedChanges();
  const dirty = editing && productEditorFingerprint(draft) !== originalFingerprint;
  useEffect(() => { setDirty(dirty); }, [dirty, setDirty]);
  useEffect(() => () => setDirty(false), [setDirty]);
  const validation = checked ? validateProductEditorDraft(product, draft) : null;
  const slugEditable = canEditProductSlug(product);
  const categories = [product.categories.primary, ...product.categories.additional]
    .filter((category): category is NonNullable<typeof category> => category !== null);
  const images = [...draft.images].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));

  const update = (change: (current: ProductEditorDraft) => ProductEditorDraft) => {
    setDraft(change); setChecked(false);
  };
  const translation = (locale: Locale, field: TranslationField, value: string) => update((current) => ({
    ...current, translations: { ...current.translations,
      [locale]: { ...current.translations[locale], [field]: value } },
  }));
  const discard = () => { setDraft(createProductEditorDraft(product)); setChecked(false); setEditing(false); };

  return <section className="admin-card admin-editor" aria-label="Local product editor">
    <div className="admin-editor-heading"><div><h2>Local product draft</h2>
      <p className="admin-editor-warning">LOCAL DEMO / NOT CONNECTED · Changes are kept only in this tab and will be lost on refresh or departure.</p>
    </div><span className="admin-badge admin-badge-warning">No database save</span></div>
    {!editing ? <button type="button" onClick={() => setEditing(true)}>Edit local draft</button> : <>
      <p role="status">{dirty ? "Unsaved local changes" : "No local changes"}</p>
      <div className="admin-editor-grid">
        <fieldset><legend>Basic information</legend>
          <label>Product Code<input value={product.basic.product_code} readOnly aria-readonly="true" /></label>
          <p>Product Code is an immutable product identity.</p>
          <label>Slug<input value={draft.slug} readOnly={!slugEditable} aria-readonly={!slugEditable}
            onChange={(event) => update((current) => ({ ...current, slug: event.target.value }))} /></label>
          {!slugEditable && <p>Slug is read only because prior publication cannot be ruled out.</p>}
          <label>Product status<select value={draft.status} onChange={(event) => update((current) => ({
            ...current, status: event.target.value as ProductEditorDraft["status"] }))}>
            {statusChoices.map((status) => <option key={status} value={status}>{status}</option>)}
          </select></label>
        </fieldset>
        {(["en", "zh"] as const).map((locale) => <fieldset key={locale} lang={locale}>
          <legend>{locale === "en" ? "English" : "Chinese"} translation</legend>
          {product.translations[locale].state === "unavailable" &&
            <p>No stored translation is available; entries here remain a local draft.</p>}
          <label>Name<input value={draft.translations[locale].name}
            onChange={(event) => translation(locale, "name", event.target.value)} /></label>
          <label>Short description<textarea value={draft.translations[locale].shortDescription}
            onChange={(event) => translation(locale, "shortDescription", event.target.value)} /></label>
          <label>Description<textarea value={draft.translations[locale].description}
            onChange={(event) => translation(locale, "description", event.target.value)} /></label>
          <label>SEO title<input value={draft.translations[locale].seoTitle}
            onChange={(event) => translation(locale, "seoTitle", event.target.value)} /></label>
          <label>SEO description<textarea value={draft.translations[locale].seoDescription}
            onChange={(event) => translation(locale, "seoDescription", event.target.value)} /></label>
        </fieldset>)}
      </div>
      <fieldset><legend>Categories</legend>
        <p>Only existing associations are available. The complete category list, status and ancestry are NOT_VERIFIED.</p>
        {categories.length ? <label>Primary category<select value={draft.primaryCategoryId ?? ""}
          onChange={(event) => update((current) => changePrimaryCategory(current, event.target.value))}>
          {!draft.primaryCategoryId && <option value="">No primary category</option>}
          {categories.map((category) => <option key={category.id} value={category.id}>
            {category.name.en || category.name.zh || category.slug}</option>)}
        </select></label> : <p>No assigned category is available; category selection is read only.</p>}
        <p>Additional categories: {draft.additionalCategoryIds.map((id) => categories.find((item) => item.id === id)?.name.en || id).join(", ") || "None"}</p>
      </fieldset>
      <fieldset><legend>SKUs</legend>
        {draft.variants.map((variant, index) => <div className="admin-editor-row" key={variant.id}>
          <label>SKU Code<input value={variant.sku} readOnly aria-readonly="true" /></label>
          <label>SKU status<select value={variant.status} onChange={(event) => update((current) => ({
            ...current, variants: current.variants.map((item) => item.id === variant.id
              ? { ...item, status: event.target.value as typeof item.status } : item) }))}>
            {statusChoices.map((status) => <option key={status} value={status}>{status}</option>)}
          </select></label>
          <label>SKU attributes JSON<textarea value={variant.attributesText}
            aria-describedby={`variant-${index}-help`} onChange={(event) => update((current) => ({
              ...current, variants: current.variants.map((item) => item.id === variant.id
                ? { ...item, attributesText: event.target.value } : item) }))} /></label>
          <p id={`variant-${index}-help`}>Flat string, number or boolean values only. SKU identity is immutable.</p>
        </div>)}
      </fieldset>
      <fieldset><legend>Images</legend><p>Private image preview unavailable. Only safe metadata is shown; no upload or Storage access.</p>
        {images.map((image, index) => {
          const variant = product.variants.find((item) => item.id === image.variantId);
          return <div className="admin-editor-image" key={image.id}>
            <span className="admin-editor-placeholder" aria-label="Private image placeholder">Image preview unavailable</span>
            <span>{image.alt.en || image.alt.zh || "No ALT"} · {variant ? `SKU ${variant.sku}` : "Product"} · {image.status}</span>
            <label><input type="radio" name="local-primary-image" checked={image.role === "primary"}
              disabled={image.variantId !== null || draft.status === "published" && image.status !== "published"}
              onChange={() => update((current) => choosePrimaryImage(current, image.id))} /> Primary image</label>
            <span>Order {image.sortOrder}</span>
            <button type="button" disabled={index === 0} onClick={() => update((current) => moveProductImage(current, image.id, -1))}>Move up</button>
            <button type="button" disabled={index === images.length - 1} onClick={() => update((current) => moveProductImage(current, image.id, 1))}>Move down</button>
          </div>;
        })}
      </fieldset>
      <div className="admin-editor-actions">
        <button type="button" onClick={() => setChecked(true)}>Check draft</button>
        <button type="button" onClick={discard}>Discard changes</button>
      </div>
      {validation && <div className="admin-editor-validation" aria-live="polite">
        <strong>Local fields: {validation.localState}</strong>
        <p>Full catalog and publication checks: {validation.overallState}</p>
        {validation.issues.length > 0 && <ul aria-label="Draft errors">{validation.issues.map((issue, index) =>
          <li key={`${issue.field_path}-${issue.error_code}-${index}`} data-field-path={issue.field_path}>
            {issue.field_path}: {issue.error_code} — {issue.message}</li>)}</ul>}
        <ul aria-label="Not verified checks">{validation.notVerified.map((reason) => <li key={reason}>{reason}: NOT_VERIFIED</li>)}</ul>
      </div>}
    </>}
  </section>;
}
