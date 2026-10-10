import type { InquiryItem } from "@/lib/catalog/inquiry";
import type { AttributeValue, LocalizedText } from "@/lib/catalog/types";

export type RFQContact = {
  fullName: string;
  email: string;
  companyName: string;
  country: string; // ISO 3166-1 alpha-2 code, normalized to uppercase.
  whatsapp?: string;
  website?: string;
};

export type RFQBuyerType = "wholesaler" | "retailer" | "nail_salon" | "beauty_brand" | "ecommerce_seller" | "other";
export type RFQCustomization = "oem" | "odm" | "private_label" | "custom_packaging";
export type RFQPurchaseTimeline = "immediately" | "within_1_month" | "within_3_months" | "planning";

// InquiryItem is SKU-based today. RFQ also allows products without variants.
export type RFQDraftItem = Pick<InquiryItem, "productId" | "quantity"> & { sku?: InquiryItem["sku"] };
export type RFQDraft = {
  contact: RFQContact;
  buyerType?: RFQBuyerType;
  requirements: string;
  customization?: RFQCustomization[];
  purchaseTimeline?: RFQPurchaseTimeline;
  items: RFQDraftItem[];
};

export type RFQItemSnapshot = RFQDraftItem & {
  productName: LocalizedText;
  productSlug: string;
  selectedVariant: { id: string; attributes: Record<string, AttributeValue> } | null;
};

// Only a future server workflow may assign id, createdAt and status.
export type RFQSubmission = Omit<RFQDraft, "items"> & {
  id: string;
  createdAt: string;
  status: "received";
  items: RFQItemSnapshot[];
};

export type RFQErrorCode =
  | "REQUIRED" | "INVALID_EMAIL" | "INVALID_WEBSITE" | "TOO_SHORT" | "TOO_LONG"
  | "INVALID_COUNTRY" | "INVALID_QUANTITY" | "INVALID_PRODUCT" | "DUPLICATE_PRODUCT"
  | "EMPTY_INQUIRY" | "INVALID_ENUM" | "INVALID_FORMAT";
export type RFQValidationError = { field: string; code: RFQErrorCode };
export type RFQResult<T> = { ok: true; value: T } | { ok: false; errors: RFQValidationError[] };
