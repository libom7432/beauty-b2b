"use client";

import Link from "next/link";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { products } from "@/lib/catalog/products";
import type { RFQCountryOption } from "@/lib/rfq/country-options";
import { inquiryItemsToRFQDraftItems, snapshotRFQItems } from "@/lib/rfq/items";
import type { RFQBuyerType, RFQDraft, RFQPurchaseTimeline, RFQValidationError } from "@/lib/rfq/types";
import { RFQ_BUYER_TYPES, RFQ_CUSTOMIZATIONS, RFQ_FIELD_LIMITS, RFQ_PURCHASE_TIMELINES, validateRFQDraft } from "@/lib/rfq/validation";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "./catalog-media";
import { useInquiry } from "./inquiry-provider";

type FormValues = Omit<RFQDraft, "items">;
const initialValues: FormValues = {
  contact: { fullName: "", email: "", companyName: "", country: "", whatsapp: "", website: "" },
  requirements: "", customization: [],
};
const fieldIds: Record<string, string> = {
  "contact.fullName": "rfq-full-name", "contact.email": "rfq-email", "contact.companyName": "rfq-company",
  "contact.country": "rfq-country", "contact.whatsapp": "rfq-whatsapp", "contact.website": "rfq-website",
  buyerType: "rfq-buyer-type", purchaseTimeline: "rfq-timeline", requirements: "rfq-requirements", items: "rfq-summary",
};

export function RFQForm({ locale, countryOptions }: { locale: Locale; countryOptions: readonly RFQCountryOption[] }) {
  const { items, ready, invalidItemCount, discardInvalidItems } = useInquiry();
  const dictionary = getDictionary(locale);
  const copy = dictionary.rfqForm;
  const [values, setValues] = useState<FormValues>(initialValues);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [review, setReview] = useState<RFQDraft | null>(null);
  const rawItems = useMemo(() => items.map(({ productId, sku, quantity }) => ({ productId, sku, quantity })), [items]);
  const checkedItems = useMemo(() => inquiryItemsToRFQDraftItems(items, products), [items]);
  const validation = useMemo(() => validateRFQDraft({ ...values, items: rawItems }, products), [values, rawItems]);
  const errors = validation.ok ? [] : validation.errors;
  const reviewItemsMatch = review && JSON.stringify(review.items) === JSON.stringify(rawItems);
  const showReview = Boolean(review && reviewItemsMatch && checkedItems.ok && invalidItemCount === 0);
  const countryNames = useMemo(() => new Map(countryOptions.map(({ code, name }) => [code, name])), [countryOptions]);

  function errorFor(field: string) {
    if (!attempted && !touched[field]) return undefined;
    return errors.find((error) => error.field === field);
  }
  function errorText(error?: RFQValidationError) {
    return error ? dictionary.rfqErrors[error.code] : undefined;
  }
  function contactField(field: keyof FormValues["contact"], value: string) {
    setValues((current) => ({ ...current, contact: { ...current.contact, [field]: value } }));
  }
  function markTouched(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }
  function field(field: string, label: string, control: ReactNode, required = false) {
    const error = errorFor(field);
    const id = fieldIds[field];
    return <div className="rfq-field" key={field}><label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>{control}<p id={`${id}-error`} className="rfq-field-error" data-empty={!error} aria-hidden={!error}>{errorText(error)}</p></div>;
  }
  function input(fieldName: keyof FormValues["contact"], type: string, maxLength: number, autoComplete?: string) {
    const field = `contact.${fieldName}`;
    return <input id={fieldIds[field]} type={type} value={values.contact[fieldName] ?? ""} maxLength={maxLength} autoComplete={autoComplete} required={["fullName", "email", "companyName"].includes(fieldName)} onChange={(event) => contactField(fieldName, event.currentTarget.value)} onBlur={() => markTouched(field)} aria-invalid={Boolean(errorFor(field))} aria-describedby={errorFor(field) ? `${fieldIds[field]}-error` : undefined} />;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    const result = validateRFQDraft({ ...values, items: rawItems }, products);
    if (!result.ok || !ready || !checkedItems.ok || invalidItemCount > 0) {
      const first = !ready ? undefined : !result.ok ? result.errors[0] : !checkedItems.ok ? checkedItems.errors[0] : undefined;
      const id = invalidItemCount > 0 || first?.field.startsWith("items") ? "rfq-summary" : first?.field.startsWith("customization") ? "rfq-customization" : fieldIds[first?.field ?? ""];
      if (id) document.getElementById(id)?.focus();
      return;
    }
    setReview(result.value);
    document.getElementById("rfq-form-top")?.scrollIntoView({ block: "start" });
  }

  const summary = <aside className="rfq-summary" id="rfq-summary" tabIndex={-1} aria-label={copy.summary}>
    <h2>{copy.summary}</h2><p>{copy.itemCount.replace("{count}", String(items.length))}</p>
    {ready && items.length === 0 && <p className="rfq-summary-error">{copy.noItems}</p>}
    {invalidItemCount > 0 && <div className="rfq-invalid-items"><p className="rfq-summary-error">{copy.invalidItems.replace("{count}", String(invalidItemCount))}</p><button type="button" onClick={discardInvalidItems}>{copy.discardInvalid}</button></div>}
    {items.map((item, index) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      const variant = product?.variants.find((candidate) => candidate.sku === item.sku);
      const image = product?.images[variant?.imageIndex ?? 0] ?? product?.images[0];
      const itemError = errors.find((error) => error.field.startsWith(`items[${index}]`));
      return <div className="rfq-summary-item" key={`${item.productId}:${item.sku}`}>
        {product && <CatalogMedia visual={image?.visual ?? product.images[0]?.visual ?? "press-on"} image={image} alt={image?.alt[locale] ?? product.name[locale]} sizes="80px" />}
        <div><strong>{product?.name[locale] ?? item.productId}</strong><span>SKU: {item.sku}</span>{variant && <span>{copy.variant}: {Object.values(variant.attributes).map(String).join(" · ") || variant.sku}</span>}<span>{copy.quantity}: {item.quantity}</span>{image?.isPlaceholder && <small>{copy.placeholder}</small>}{itemError && <small className="rfq-summary-error">{errorText(itemError)}</small>}</div>
      </div>;
    })}
    {attempted && errors.some((error) => error.field === "items") && <p className="rfq-summary-error">{errorText(errors.find((error) => error.field === "items"))}</p>}
    {!checkedItems.ok && items.length > 0 && <p className="rfq-summary-error">{copy.issue}</p>}
    <Link href={localizedPath(locale, "/inquiry")}>{copy.back}</Link>
  </aside>;

  if (showReview && review) {
    const snapshots = snapshotRFQItems(review.items, products);
    return <section className="rfq-review" id="rfq-form-top"><div className="rfq-review-heading"><h2>{copy.reviewTitle}</h2><p>{copy.reviewNote}</p></div><div className="rfq-layout"><div className="rfq-review-content">
      <section><h3>{copy.contact}</h3><dl><dt>{copy.fullName}</dt><dd>{review.contact.fullName}</dd><dt>{copy.email}</dt><dd>{review.contact.email}</dd><dt>{copy.companyName}</dt><dd>{review.contact.companyName}</dd><dt>{copy.country}</dt><dd>{countryNames.get(review.contact.country) ?? review.contact.country} ({review.contact.country})</dd>{review.contact.whatsapp && <><dt>{copy.whatsapp}</dt><dd>{review.contact.whatsapp}</dd></>}{review.contact.website && <><dt>{copy.website}</dt><dd>{review.contact.website}</dd></>}</dl></section>
      <section><h3>{copy.business}</h3>{review.buyerType && <p>{copy.buyerType}: {copy.buyerTypes[review.buyerType]}</p>}{review.purchaseTimeline && <p>{copy.timeline}: {copy.timelines[review.purchaseTimeline]}</p>}{Boolean(review.customization?.length) && <p>{copy.customization}: {review.customization?.map((option) => copy.customizations[option]).join(", ")}</p>}</section>
      <section><h3>{copy.requirementsSection}</h3><p className="rfq-review-requirements">{review.requirements}</p></section>
      <div className="rfq-actions"><button type="button" onClick={() => setReview(null)}>{copy.edit}</button><Link href={localizedPath(locale, "/inquiry")}>{copy.back}</Link></div><p className="rfq-disclaimer">{copy.notSubmitted}</p>
    </div><aside className="rfq-summary"><h2>{copy.summary}</h2><p>{copy.itemCount.replace("{count}", String(review.items.length))}</p>{snapshots.ok && snapshots.value.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      const image = product?.images[product.variants.find((variant) => variant.sku === item.sku)?.imageIndex ?? 0] ?? product?.images[0];
      return <div className="rfq-summary-item" key={`${item.productId}:${item.sku}`}>{product && <CatalogMedia visual={image?.visual ?? product.images[0]?.visual ?? "press-on"} image={image} alt={image?.alt[locale] ?? item.productName[locale]} sizes="80px" />}<div><strong>{item.productName[locale]}</strong>{item.sku && <span>SKU: {item.sku}</span>}{item.selectedVariant && <span>{copy.variant}: {Object.values(item.selectedVariant.attributes).map(String).join(" · ") || item.sku}</span>}<span>{copy.quantity}: {item.quantity}</span></div></div>;
    })}</aside></div></section>;
  }

  return <section className="rfq-layout" id="rfq-form-top"><form className="rfq-form" onSubmit={submit} noValidate>
    <fieldset><legend>{copy.contact}</legend><div className="rfq-field-grid">
      {field("contact.fullName", copy.fullName, input("fullName", "text", RFQ_FIELD_LIMITS.fullName.max, "name"), true)}
      {field("contact.email", copy.email, input("email", "email", RFQ_FIELD_LIMITS.email.max, "email"), true)}
      {field("contact.companyName", copy.companyName, input("companyName", "text", RFQ_FIELD_LIMITS.companyName.max, "organization"), true)}
      {field("contact.country", copy.country, <select id="rfq-country" value={values.contact.country} required onChange={(event) => contactField("country", event.currentTarget.value)} onBlur={() => markTouched("contact.country")} aria-invalid={Boolean(errorFor("contact.country"))} aria-describedby={errorFor("contact.country") ? "rfq-country-error" : undefined}><option value="">{copy.countryPrompt}</option>{countryOptions.map(({ code, name }) => <option value={code} key={code}>{name} ({code})</option>)}</select>, true)}
      {field("contact.whatsapp", copy.whatsapp, input("whatsapp", "tel", RFQ_FIELD_LIMITS.whatsapp.max, "tel"))}
      {field("contact.website", copy.website, input("website", "url", RFQ_FIELD_LIMITS.website.max, "url"))}
    </div></fieldset>
    <fieldset><legend>{copy.business}</legend>{field("buyerType", copy.buyerType, <select id="rfq-buyer-type" value={values.buyerType ?? ""} onChange={(event) => { const value = event.currentTarget.value; setValues((current) => ({ ...current, buyerType: value as RFQBuyerType || undefined })); }} onBlur={() => markTouched("buyerType")} aria-invalid={Boolean(errorFor("buyerType"))} aria-describedby={errorFor("buyerType") ? "rfq-buyer-type-error" : undefined}><option value="">{copy.buyerPrompt}</option>{RFQ_BUYER_TYPES.map((option) => <option value={option} key={option}>{copy.buyerTypes[option]}</option>)}</select>)}</fieldset>
    <fieldset id="rfq-customization" tabIndex={-1}><legend>{copy.customization}</legend><div className="rfq-options">{RFQ_CUSTOMIZATIONS.map((option) => <label key={option}><input type="checkbox" checked={values.customization?.includes(option) ?? false} onChange={(event) => { const checked = event.currentTarget.checked; setValues((current) => ({ ...current, customization: checked ? [...(current.customization ?? []), option] : (current.customization ?? []).filter((value) => value !== option) })); }} /><span>{copy.customizations[option]}</span></label>)}</div></fieldset>
    <fieldset><legend>{copy.timeline}</legend>{field("purchaseTimeline", copy.timeline, <select id="rfq-timeline" value={values.purchaseTimeline ?? ""} onChange={(event) => { const value = event.currentTarget.value; setValues((current) => ({ ...current, purchaseTimeline: value as RFQPurchaseTimeline || undefined })); }} onBlur={() => markTouched("purchaseTimeline")} aria-invalid={Boolean(errorFor("purchaseTimeline"))} aria-describedby={errorFor("purchaseTimeline") ? "rfq-timeline-error" : undefined}><option value="">{copy.timelinePrompt}</option>{RFQ_PURCHASE_TIMELINES.map((option) => <option value={option} key={option}>{copy.timelines[option]}</option>)}</select>)}</fieldset>
    <fieldset><legend>{copy.requirementsSection}</legend>{field("requirements", copy.requirements, <textarea id="rfq-requirements" value={values.requirements} required maxLength={RFQ_FIELD_LIMITS.requirements.max} rows={6} onChange={(event) => { const value = event.currentTarget.value; setValues((current) => ({ ...current, requirements: value })); }} onBlur={() => markTouched("requirements")} aria-invalid={Boolean(errorFor("requirements"))} aria-describedby={errorFor("requirements") ? "rfq-requirements-error" : undefined} />, true)}</fieldset>
    <div className="rfq-actions"><button type="submit" disabled={!ready}>{copy.review}</button><Link href={localizedPath(locale, "/inquiry")}>{copy.back}</Link></div><p className="rfq-disclaimer">{copy.notSubmitted}</p>
  </form>{summary}</section>;
}
