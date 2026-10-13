import type { RFQDraft } from "./types";

export type RFQFormValues = Omit<RFQDraft, "items">;

export function createInitialRFQFormValues(): RFQFormValues {
  return {
    contact: { fullName: "", email: "", companyName: "", country: "", whatsapp: "", website: "" },
    requirements: "",
    customization: [],
  };
}

export function isRFQFormDirty(values: RFQFormValues): boolean {
  const initial = createInitialRFQFormValues();
  return Object.keys(initial.contact).some((key) =>
    values.contact[key as keyof RFQFormValues["contact"]] !== initial.contact[key as keyof RFQFormValues["contact"]]
  ) || values.requirements !== initial.requirements
    || Boolean(values.buyerType || values.purchaseTimeline || values.customization?.length);
}

// Match the API's normalized fingerprint fields and ordering. This string is
// hashed in the browser only to choose a local idempotency key; the API remains
// authoritative for deciding whether two requests are equal.
export function canonicalRFQDraft(draft: RFQDraft): string {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return JSON.stringify({
    contact: draft.contact,
    buyerType: draft.buyerType ?? null,
    requirements: draft.requirements,
    customization: [...(draft.customization ?? [])].sort(),
    purchaseTimeline: draft.purchaseTimeline ?? null,
    items: [...draft.items].sort((a, b) =>
      compare(a.productId, b.productId) || compare(a.sku ?? "", b.sku ?? "")
    ).map(({ productId, sku, quantity }) => ({ productId, sku: sku ?? null, quantity })),
  });
}
