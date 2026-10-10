import type { Product } from "@/lib/catalog/types";
import { isRFQCountryCode } from "./countries";
import { validateRFQItems } from "./items";
import type { RFQBuyerType, RFQContact, RFQCustomization, RFQDraft, RFQErrorCode, RFQPurchaseTimeline, RFQResult, RFQValidationError } from "./types";

export const RFQ_FIELD_LIMITS = {
  fullName: { min: 2, max: 100 },
  email: { max: 254 },
  companyName: { min: 2, max: 150 },
  country: { length: 2 },
  whatsapp: { max: 30 },
  website: { max: 2048 },
  requirements: { min: 10, max: 5000 },
} as const;

export const RFQ_BUYER_TYPES: readonly RFQBuyerType[] = ["wholesaler", "retailer", "nail_salon", "beauty_brand", "ecommerce_seller", "other"];
export const RFQ_CUSTOMIZATIONS: readonly RFQCustomization[] = ["oem", "odm", "private_label", "custom_packaging"];
export const RFQ_PURCHASE_TIMELINES: readonly RFQPurchaseTimeline[] = ["immediately", "within_1_month", "within_3_months", "planning"];

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textField(value: unknown, field: string, errors: RFQValidationError[], limits: { min?: number; max: number }, required = true) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    if (required) errors.push({ field, code: "REQUIRED" });
    return "";
  }
  if (typeof value !== "string") {
    errors.push({ field, code: "INVALID_FORMAT" });
    return "";
  }
  const normalized = value.trim();
  if (limits.min !== undefined && normalized.length < limits.min) errors.push({ field, code: "TOO_SHORT" });
  if (normalized.length > limits.max) errors.push({ field, code: "TOO_LONG" });
  return normalized;
}

function optionalEnum<T extends string>(value: unknown, field: string, choices: readonly T[], errors: RFQValidationError[]): T | undefined {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return undefined;
  const normalized = typeof value === "string" ? value.trim() : "";
  if (choices.includes(normalized as T)) return normalized as T;
  errors.push({ field, code: "INVALID_ENUM" });
  return undefined;
}

export function validateRFQDraft(input: unknown, products: readonly Product[]): RFQResult<RFQDraft> {
  const errors: RFQValidationError[] = [];
  const draft = record(input);
  const rawContact = record(draft?.contact);
  const fullName = textField(rawContact?.fullName, "contact.fullName", errors, RFQ_FIELD_LIMITS.fullName);
  const email = textField(rawContact?.email, "contact.email", errors, RFQ_FIELD_LIMITS.email);
  const companyName = textField(rawContact?.companyName, "contact.companyName", errors, RFQ_FIELD_LIMITS.companyName);
  const rawCountry = textField(rawContact?.country, "contact.country", errors, { max: RFQ_FIELD_LIMITS.country.length });
  const country = rawCountry.toUpperCase();
  const whatsapp = textField(rawContact?.whatsapp, "contact.whatsapp", errors, RFQ_FIELD_LIMITS.whatsapp, false);
  const website = textField(rawContact?.website, "contact.website", errors, RFQ_FIELD_LIMITS.website, false);
  const requirements = textField(draft?.requirements, "requirements", errors, RFQ_FIELD_LIMITS.requirements);

  if (email && email.length <= RFQ_FIELD_LIMITS.email.max && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errors.push({ field: "contact.email", code: "INVALID_EMAIL" });
  if (country && !isRFQCountryCode(country)) errors.push({ field: "contact.country", code: "INVALID_COUNTRY" });
  if (website && website.length <= RFQ_FIELD_LIMITS.website.max) {
    try {
      const url = new URL(website);
      if (!(["http:", "https:"].includes(url.protocol) && url.hostname.includes(".") && !url.username && !url.password)) throw new Error("Invalid website");
    } catch { errors.push({ field: "contact.website", code: "INVALID_WEBSITE" }); }
  }

  const buyerType = optionalEnum(draft?.buyerType, "buyerType", RFQ_BUYER_TYPES, errors);
  const purchaseTimeline = optionalEnum(draft?.purchaseTimeline, "purchaseTimeline", RFQ_PURCHASE_TIMELINES, errors);
  let customization: RFQCustomization[] | undefined;
  if (draft?.customization !== undefined && draft.customization !== null) {
    if (!Array.isArray(draft.customization)) errors.push({ field: "customization", code: "INVALID_ENUM" });
    else {
      customization = [];
      draft.customization.forEach((value, index) => {
        const choice = optionalEnum(value, `customization[${index}]`, RFQ_CUSTOMIZATIONS, errors);
        if (choice && !customization!.includes(choice)) customization!.push(choice);
      });
    }
  }
  const checkedItems = validateRFQItems(draft?.items, products);
  if (!checkedItems.ok) errors.push(...checkedItems.errors);
  if (errors.length) return { ok: false, errors };

  const contact: RFQContact = { fullName, email, companyName, country, ...(whatsapp ? { whatsapp } : {}), ...(website ? { website } : {}) };
  return { ok: true, value: {
    contact, ...(buyerType ? { buyerType } : {}), requirements,
    ...(customization ? { customization } : {}), ...(purchaseTimeline ? { purchaseTimeline } : {}),
    items: checkedItems.ok ? checkedItems.value : [],
  } };
}

// Keep the public code list typed alongside the validation result for UI translation.
export type RFQValidationCode = RFQErrorCode;
