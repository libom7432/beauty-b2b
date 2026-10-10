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
