"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/dictionaries";
import { products } from "@/lib/catalog/products";
import type { InquiryItem } from "@/lib/catalog/inquiry";
import type { RFQCountryOption } from "@/lib/rfq/country-options";
import { inquiryItemsToRFQDraftItems, snapshotRFQItems } from "@/lib/rfq/items";
import { canonicalRFQDraft, createInitialRFQFormValues, isRFQFormDirty, type RFQFormValues } from "@/lib/rfq/form-state";
import type { RFQBuyerType, RFQDraft, RFQPurchaseTimeline, RFQValidationError } from "@/lib/rfq/types";
import { RFQ_BUYER_TYPES, RFQ_CUSTOMIZATIONS, RFQ_FIELD_LIMITS, RFQ_PURCHASE_TIMELINES, validateRFQDraft } from "@/lib/rfq/validation";
import { localizedPath } from "@/lib/site/paths";
import { CatalogMedia } from "./catalog-media";
import { useInquiry } from "./inquiry-provider";

const fieldIds: Record<string, string> = {
  "contact.fullName": "rfq-full-name", "contact.email": "rfq-email", "contact.companyName": "rfq-company",
  "contact.country": "rfq-country", "contact.whatsapp": "rfq-whatsapp", "contact.website": "rfq-website",
  buyerType: "rfq-buyer-type", purchaseTimeline: "rfq-timeline", requirements: "rfq-requirements", items: "rfq-summary",
};

const ATTEMPTS_KEY = "beauty-b2b-rfq-attempts-v1";
type RFQReceipt = { id: string; rfqNumber: string; status: "received"; createdAt: string; replayed: boolean };
type RFQAttempt = { key: string; digest: string; receipt?: RFQReceipt };
type SubmitStatus = "idle" | "validating" | "submitting" | "success" | "error";
type SubmitState = { status: SubmitStatus; message?: string; receipt?: RFQReceipt; digest?: string; conflict?: boolean };

function storedAttempts(fallback: RFQAttempt[]): RFQAttempt[] {
  try {
    const raw = sessionStorage.getItem(ATTEMPTS_KEY);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const valid = parsed.filter((value): value is RFQAttempt => {
      if (!value || typeof value !== "object") return false;
      const attempt = value as Partial<RFQAttempt>;
      return typeof attempt.key === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attempt.key) &&
        typeof attempt.digest === "string" && /^[0-9a-f]{64}$/.test(attempt.digest);
    });
    // A failed storage write must not replace an in-memory retry key.
    return [...valid.filter((attempt) => !fallback.some((item) => item.digest === attempt.digest)), ...fallback];
  } catch { return fallback; }
}

function validReceipt(value: unknown): value is RFQReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<RFQReceipt>;
  return typeof receipt.id === "string" && typeof receipt.rfqNumber === "string" &&
    receipt.rfqNumber.length > 0 && receipt.status === "received" &&
    typeof receipt.createdAt === "string" && typeof receipt.replayed === "boolean";
}

async function draftDigest(draft: RFQDraft): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalRFQDraft(draft));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function RFQForm({ locale, countryOptions, submitEnabled = false }: { locale: Locale; countryOptions: readonly RFQCountryOption[]; submitEnabled?: boolean }) {
  const { items, ready, invalidItemCount, discardInvalidItems, removeSubmittedItems } = useInquiry();
  const dictionary = getDictionary(locale);
  const copy = dictionary.rfqForm;
  const submitCopy = dictionary.rfqSubmit;
  const [values, setValues] = useState<RFQFormValues>(createInitialRFQFormValues);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [submission, setSubmission] = useState<SubmitState>({ status: "idle" });
  const [serverErrors, setServerErrors] = useState<RFQValidationError[]>([]);
  const [activeDraft, setActiveDraft] = useState<RFQDraft | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const attempts = useRef<RFQAttempt[]>([]);
  const leaveDialog = useRef<HTMLDialogElement>(null);
  const stayButton = useRef<HTMLButtonElement>(null);
  const leaveTarget = useRef<string | null>(null);
  const leaveTrigger = useRef<HTMLElement | null>(null);
  const leaveApproved = useRef(false);
  const dirty = submission.status !== "success" && isRFQFormDirty(values);
  const rawItems = useMemo(() => items.map(({ productId, sku, quantity }) => ({ productId, sku, quantity })), [items]);
  const checkedItems = useMemo(() => inquiryItemsToRFQDraftItems(items, products), [items]);
  const validation = useMemo(() => validateRFQDraft({ ...values, items: rawItems }, products), [values, rawItems]);
  const errors = serverErrors.length ? serverErrors : validation.ok ? [] : validation.errors;
  const busy = submission.status === "validating" || submission.status === "submitting";
  const review = reviewOpen && busy && activeDraft ? activeDraft :
    reviewOpen && ready && validation.ok && checkedItems.ok && invalidItemCount === 0 ? validation.value : null;
  const countryNames = useMemo(() => new Map(countryOptions.map(({ code, name }) => [code, name])), [countryOptions]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);

  function saveAttempts(next: RFQAttempt[]) {
    attempts.current = next;
    try { sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts.current)); }
    catch { /* Keep the current tab's attempt in memory if storage is unavailable. */ }
  }

  function changed() {
    setServerErrors([]);
    setSubmission((current) => current.status === "error" ? { status: "idle" } : current);
  }

  useEffect(() => {
    if (!dirty) return;
    const openLeaveDialog = (href: string, trigger: HTMLElement | null) => {
      leaveTarget.current = href;
      leaveTrigger.current = trigger;
      leaveDialog.current?.showModal();
      stayButton.current?.focus();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (leaveApproved.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const onLinkClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !(event.target instanceof Element)) return;
      const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
      const target = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (!/^https?:$/.test(target.protocol) || (target.pathname === current.pathname && target.search === current.search)) return;
      event.preventDefault();
      event.stopPropagation();
      openLeaveDialog(target.href, anchor);
    };
    const onProgrammaticNavigation = (event: Event) => {
      const href = (event as CustomEvent<{ href?: string }>).detail?.href;
      if (!href) return;
      const target = new URL(href, window.location.href);
      if (!/^https?:$/.test(target.protocol)) return;
      event.preventDefault();
      openLeaveDialog(target.href, document.activeElement instanceof HTMLElement ? document.activeElement : null);
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("site:navigate-request", onProgrammaticNavigation);
    document.addEventListener("click", onLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("site:navigate-request", onProgrammaticNavigation);
      document.removeEventListener("click", onLinkClick, true);
    };
  }, [dirty]);

  function stayOnPage() {
    leaveDialog.current?.close();
    leaveTarget.current = null;
    leaveTrigger.current?.focus();
  }
  function leavePage() {
    const target = leaveTarget.current;
    if (!target) return;
    leaveApproved.current = true;
    leaveDialog.current?.close();
    window.location.assign(target);
  }

  const leaveConfirmation = <dialog ref={leaveDialog} className="rfq-leave-dialog" aria-labelledby="rfq-leave-title" aria-describedby="rfq-leave-body" onCancel={(event) => { event.preventDefault(); stayOnPage(); }} onKeyDown={(event) => {
    if (event.key !== "Tab") return;
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
    const first = buttons[0];
    const last = buttons[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}>
    <h2 id="rfq-leave-title">{copy.leaveTitle}</h2>
    <p id="rfq-leave-body">{copy.leaveBody}</p>
    <div className="rfq-leave-actions"><button ref={stayButton} type="button" onClick={stayOnPage}>{copy.stayOnPage}</button><button type="button" onClick={leavePage}>{copy.leavePage}</button></div>
  </dialog>;

  function errorFor(field: string) {
    if (!attempted && !touched[field]) return undefined;
    return errors.find((error) => error.field === field);
  }
  function errorText(error?: RFQValidationError) {
    return error ? dictionary.rfqErrors[error.code] : undefined;
  }
  function contactField(field: keyof RFQFormValues["contact"], value: string) {
    setValues((current) => ({ ...current, contact: { ...current.contact, [field]: value } }));
    changed();
  }
  function markTouched(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }
  function field(field: string, label: string, control: ReactNode, required = false) {
    const error = errorFor(field);
    const id = fieldIds[field];
    return <div className="rfq-field" key={field}><label htmlFor={id}>{label}{required && <span aria-hidden="true"> *</span>}</label>{control}<p id={`${id}-error`} className="rfq-field-error" data-empty={!error} aria-hidden={!error}>{errorText(error)}</p></div>;
  }
  function input(fieldName: keyof RFQFormValues["contact"], type: string, maxLength: number, autoComplete?: string) {
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
    setReviewOpen(true);
    setServerErrors([]);
    setSubmission({ status: "idle" });
    document.getElementById("rfq-form-top")?.scrollIntoView({ block: "start" });
  }

  async function submitRFQ() {
    if (!submitEnabled || inFlight.current) return;
    inFlight.current = true;
    setSubmission({ status: "validating" });
    try {
      // Freeze both snapshots before the first await. Later cart changes must
      // not alter the request or cause unrelated products to be removed.
      const cartSnapshot: InquiryItem[] = items.map((item) => ({ ...item }));
      const result = validateRFQDraft({ ...values, items: cartSnapshot.map(({ productId, sku, quantity }) =>
        ({ productId, sku, quantity })) }, products);
      if (!result.ok || !ready || invalidItemCount > 0) {
        setAttempted(true);
        setReviewOpen(false);
        setSubmission({ status: "error", message: submitCopy.invalid });
        return;
      }
      const draft = result.value;
      const body = JSON.stringify(draft);
      setActiveDraft(draft);
      const digest = await draftDigest(draft);
      const known = storedAttempts(attempts.current);
      const previous = known.find((attempt) => attempt.digest === digest);
      if (previous?.receipt && validReceipt(previous.receipt)) {
        if (mounted.current) setSubmission({ status: "success", receipt: previous.receipt, digest });
        return;
      }
      const key = previous?.key ?? crypto.randomUUID();
      const currentAttempts = previous ? known : [...known, { key, digest }];
      if (!previous) saveAttempts(currentAttempts);
      const abort = new AbortController();
      controller.current = abort;
      let timedOut = false;
      const timer = window.setTimeout(() => { timedOut = true; abort.abort(); }, 12_000);
      setSubmission({ status: "submitting" });
      let response: Response;
      let data: unknown;
      try {
        response = await fetch("/api/rfq", {
          method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key },
          body, signal: abort.signal, credentials: "same-origin", cache: "no-store",
        });
        try { data = await response.json(); }
        catch {
          if (mounted.current) setSubmission({ status: "error", message: submitCopy.unexpected });
          return;
        }
      } catch {
        if (mounted.current) setSubmission({ status: "error", message: timedOut ? submitCopy.timeout :
          abort.signal.aborted ? submitCopy.unexpected : submitCopy.network });
        return;
      } finally {
        window.clearTimeout(timer);
        controller.current = null;
      }
      if ((response.status === 201 || response.status === 200) && validReceipt(data) &&
          data.replayed === (response.status === 200)) {
        saveAttempts(currentAttempts.map((attempt) => attempt.digest === digest ? { ...attempt, receipt: data } : attempt));
        if (mounted.current) {
          setSubmission({ status: "success", receipt: data, digest });
          removeSubmittedItems(cartSnapshot);
        }
        return;
      }
      if (!mounted.current) return;
      const messages: Record<number, string> = {
        400: submitCopy.badRequest, 403: submitCopy.forbidden, 409: submitCopy.conflict,
        413: submitCopy.tooLarge, 415: submitCopy.mediaType, 422: submitCopy.fieldError,
        429: submitCopy.rateLimit, 503: submitCopy.unavailable,
      };
      if (response.status === 422 && data && typeof data === "object" && "fields" in data &&
          Array.isArray(data.fields)) {
        const accepted = data.fields.filter((field): field is RFQValidationError =>
          field && typeof field.field === "string" && typeof field.code === "string" &&
          Object.hasOwn(dictionary.rfqErrors, field.code));
        setServerErrors(accepted);
        setReviewOpen(false);
      }
      setSubmission({ status: "error", message: messages[response.status] ?? submitCopy.unexpected,
        conflict: response.status === 409 });
    } catch {
      if (mounted.current) setSubmission({ status: "error", message: submitCopy.unexpected });
    } finally {
      inFlight.current = false;
    }
  }

  function startNewRFQ() {
    if (submission.digest) saveAttempts(storedAttempts(attempts.current).filter((attempt) => attempt.digest !== submission.digest));
    setValues(createInitialRFQFormValues());
    setTouched({});
    setAttempted(false);
    setServerErrors([]);
    setReviewOpen(false);
    setActiveDraft(null);
    setSubmission({ status: "idle" });
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

  if (submission.status === "success" && submission.receipt) {
    return <><section className="rfq-submit-result" id="rfq-form-top" role="status">
      <h2>{submission.receipt.replayed ? submitCopy.replayed : submitCopy.success}</h2>
      <p>{submitCopy.number}: <strong>{submission.receipt.rfqNumber}</strong></p>
      <div className="rfq-actions"><button type="button" onClick={startNewRFQ}>{submitCopy.newRequest}</button>
        <Link href={localizedPath(locale, "/inquiry")}>{copy.back}</Link></div>
    </section>{leaveConfirmation}</>;
  }

  if (review) {
    const snapshots = snapshotRFQItems(review.items, products);
    return <><section className="rfq-review" id="rfq-form-top"><div className="rfq-review-heading"><h2>{copy.reviewTitle}</h2><p>{copy.reviewNote}</p></div><div className="rfq-layout"><div className="rfq-review-content">
      <section><h3>{copy.contact}</h3><dl><dt>{copy.fullName}</dt><dd>{review.contact.fullName}</dd><dt>{copy.email}</dt><dd>{review.contact.email}</dd><dt>{copy.companyName}</dt><dd>{review.contact.companyName}</dd><dt>{copy.country}</dt><dd>{countryNames.get(review.contact.country) ?? review.contact.country} ({review.contact.country})</dd>{review.contact.whatsapp && <><dt>{copy.whatsapp}</dt><dd>{review.contact.whatsapp}</dd></>}{review.contact.website && <><dt>{copy.website}</dt><dd>{review.contact.website}</dd></>}</dl></section>
      <section><h3>{copy.business}</h3>{review.buyerType && <p>{copy.buyerType}: {copy.buyerTypes[review.buyerType]}</p>}{review.purchaseTimeline && <p>{copy.timeline}: {copy.timelines[review.purchaseTimeline]}</p>}{Boolean(review.customization?.length) && <p>{copy.customization}: {review.customization?.map((option) => copy.customizations[option]).join(", ")}</p>}</section>
      <section><h3>{copy.requirementsSection}</h3><p className="rfq-review-requirements">{review.requirements}</p></section>
      {submission.status === "error" && <p className="rfq-submit-message rfq-submit-error" role="alert">{submission.message}</p>}
      {busy && <p className="rfq-submit-message" role="status">{submitCopy.sending}</p>}
      <div className="rfq-actions">{submitEnabled && <button type="button" onClick={submitRFQ} disabled={busy || submission.conflict}>{submission.status === "error" ? submitCopy.retry : submitCopy.action}</button>}
        <button type="button" disabled={busy} onClick={() => setReviewOpen(false)}>{copy.edit}</button>
        {!busy && <Link href={localizedPath(locale, "/inquiry")}>{copy.back}</Link>}
      </div><p className="rfq-disclaimer">{copy.notSubmitted}</p>
    </div><aside className="rfq-summary"><h2>{copy.summary}</h2><p>{copy.itemCount.replace("{count}", String(review.items.length))}</p>{snapshots.ok && snapshots.value.map((item) => {
      const product = products.find((candidate) => candidate.id === item.productId);
      const image = product?.images[product.variants.find((variant) => variant.sku === item.sku)?.imageIndex ?? 0] ?? product?.images[0];
      return <div className="rfq-summary-item" key={`${item.productId}:${item.sku}`}>{product && <CatalogMedia visual={image?.visual ?? product.images[0]?.visual ?? "press-on"} image={image} alt={image?.alt[locale] ?? item.productName[locale]} sizes="80px" />}<div><strong>{item.productName[locale]}</strong>{item.sku && <span>SKU: {item.sku}</span>}{item.selectedVariant && <span>{copy.variant}: {Object.values(item.selectedVariant.attributes).map(String).join(" · ") || item.sku}</span>}<span>{copy.quantity}: {item.quantity}</span></div></div>;
    })}</aside></div></section>{leaveConfirmation}</>;
  }

  return <><section className="rfq-layout" id="rfq-form-top"><form className="rfq-form" onSubmit={submit} noValidate>
    {submission.status === "error" && <p className="rfq-submit-message rfq-submit-error" role="alert">{submission.message}</p>}
    <fieldset><legend>{copy.contact}</legend><div className="rfq-field-grid">
      {field("contact.fullName", copy.fullName, input("fullName", "text", RFQ_FIELD_LIMITS.fullName.max, "name"), true)}
      {field("contact.email", copy.email, input("email", "email", RFQ_FIELD_LIMITS.email.max, "email"), true)}
      {field("contact.companyName", copy.companyName, input("companyName", "text", RFQ_FIELD_LIMITS.companyName.max, "organization"), true)}
      {field("contact.country", copy.country, <select id="rfq-country" value={values.contact.country} required onChange={(event) => contactField("country", event.currentTarget.value)} onBlur={() => markTouched("contact.country")} aria-invalid={Boolean(errorFor("contact.country"))} aria-describedby={errorFor("contact.country") ? "rfq-country-error" : undefined}><option value="">{copy.countryPrompt}</option>{countryOptions.map(({ code, name }) => <option value={code} key={code}>{name} ({code})</option>)}</select>, true)}
      {field("contact.whatsapp", copy.whatsapp, input("whatsapp", "tel", RFQ_FIELD_LIMITS.whatsapp.max, "tel"))}
      {field("contact.website", copy.website, input("website", "url", RFQ_FIELD_LIMITS.website.max, "url"))}
    </div></fieldset>
    <fieldset><legend>{copy.business}</legend>{field("buyerType", copy.buyerType, <select id="rfq-buyer-type" value={values.buyerType ?? ""} onChange={(event) => { const value = event.currentTarget.value; setValues((current) => ({ ...current, buyerType: value as RFQBuyerType || undefined })); changed(); }} onBlur={() => markTouched("buyerType")} aria-invalid={Boolean(errorFor("buyerType"))} aria-describedby={errorFor("buyerType") ? "rfq-buyer-type-error" : undefined}><option value="">{copy.buyerPrompt}</option>{RFQ_BUYER_TYPES.map((option) => <option value={option} key={option}>{copy.buyerTypes[option]}</option>)}</select>)}</fieldset>
    <fieldset id="rfq-customization" tabIndex={-1}><legend>{copy.customization}</legend><div className="rfq-options">{RFQ_CUSTOMIZATIONS.map((option) => <label key={option}><input type="checkbox" checked={values.customization?.includes(option) ?? false} onChange={(event) => { const checked = event.currentTarget.checked; setValues((current) => ({ ...current, customization: checked ? [...(current.customization ?? []), option] : (current.customization ?? []).filter((value) => value !== option) })); changed(); }} /><span>{copy.customizations[option]}</span></label>)}</div></fieldset>
    <fieldset><legend>{copy.timeline}</legend>{field("purchaseTimeline", copy.timeline, <select id="rfq-timeline" value={values.purchaseTimeline ?? ""} onChange={(event) => { const value = event.currentTarget.value; setValues((current) => ({ ...current, purchaseTimeline: value as RFQPurchaseTimeline || undefined })); changed(); }} onBlur={() => markTouched("purchaseTimeline")} aria-invalid={Boolean(errorFor("purchaseTimeline"))} aria-describedby={errorFor("purchaseTimeline") ? "rfq-timeline-error" : undefined}><option value="">{copy.timelinePrompt}</option>{RFQ_PURCHASE_TIMELINES.map((option) => <option value={option} key={option}>{copy.timelines[option]}</option>)}</select>)}</fieldset>
    <fieldset><legend>{copy.requirementsSection}</legend>{field("requirements", copy.requirements, <textarea id="rfq-requirements" value={values.requirements} required maxLength={RFQ_FIELD_LIMITS.requirements.max} rows={6} onChange={(event) => { const value = event.currentTarget.value; setValues((current) => ({ ...current, requirements: value })); changed(); }} onBlur={() => markTouched("requirements")} aria-invalid={Boolean(errorFor("requirements"))} aria-describedby={errorFor("requirements") ? "rfq-requirements-error" : undefined} />, true)}</fieldset>
    <div className="rfq-actions"><button type="submit" disabled={!ready}>{copy.review}</button><Link href={localizedPath(locale, "/inquiry")}>{copy.back}</Link></div><p className="rfq-disclaimer">{copy.notSubmitted}</p>
  </form>{summary}</section>{leaveConfirmation}</>;
}
