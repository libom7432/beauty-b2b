import { validQuantity, type InquiryItem } from "@/lib/catalog/inquiry";
import type { Product } from "@/lib/catalog/types";
import type { RFQDraftItem, RFQItemSnapshot, RFQResult, RFQValidationError } from "./types";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

// Normalize client fields without consulting the current catalog. Existing
// idempotency keys must remain replayable after a product or SKU is retired.
// A variantless item may omit sku or send an empty string; both become absent.
export function validateRFQItemStructure(input: unknown): RFQResult<RFQDraftItem[]> {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, errors: [{ field: "items", code: "EMPTY_INQUIRY" }] };
  const errors: RFQValidationError[] = [];
  const items: RFQDraftItem[] = [];
  const seen = new Set<string>();

  input.forEach((raw, index) => {
    const path = `items[${index}]`;
    const item = record(raw);
    const productId = typeof item?.productId === "string" ? item.productId.trim() : "";
    const skuPresent = item !== null && Object.hasOwn(item, "sku");
    const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
    if (!productId) errors.push({ field: `${path}.productId`, code: "INVALID_PRODUCT" });
    if (skuPresent && typeof item?.sku !== "string") errors.push({ field: `${path}.sku`, code: "INVALID_FORMAT" });
    if (!validQuantity(item?.quantity)) errors.push({ field: `${path}.quantity`, code: "INVALID_QUANTITY" });
    const key = `${productId}\u0000${sku}`;
    if (seen.has(key)) errors.push({ field: path, code: "DUPLICATE_PRODUCT" });
    seen.add(key);
    if (productId && (!skuPresent || typeof item?.sku === "string") && validQuantity(item?.quantity)) {
      items.push({ productId, ...(sku ? { sku } : {}), quantity: item.quantity });
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: items };
}

export function validateRFQItems(input: unknown, products: readonly Product[]): RFQResult<RFQDraftItem[]> {
  const structured = validateRFQItemStructure(input);
  if (!structured.ok) return structured;
  const errors: RFQValidationError[] = [];
  structured.value.forEach((item, index) => {
    const product = products.find((candidate) => candidate.id === item.productId);
    const sku = item.sku ?? "";
    const variant = product?.variants.find((candidate) => candidate.sku === sku);
    if (!product || (product.variants.length > 0 ? !sku || !variant : !!sku)) {
      errors.push({ field: `items[${index}].sku`, code: "INVALID_PRODUCT" });
    }
  });
  return errors.length ? { ok: false, errors } : structured;
}

export function inquiryItemsToRFQDraftItems(inquiryItems: readonly InquiryItem[], products: readonly Product[]): RFQResult<RFQDraftItem[]> {
  const draftItems = inquiryItems.map((item) => ({ productId: item.productId, sku: item.sku, quantity: item.quantity }));
  return validateRFQItems(draftItems, products);
}

// Call this with the current trusted catalog when the server constructs a submission.
export function snapshotRFQItems(input: unknown, products: readonly Product[]): RFQResult<RFQItemSnapshot[]> {
  const checked = validateRFQItems(input, products);
  if (!checked.ok) return checked;
  const snapshots = checked.value.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId)!;
    const variant = item.sku ? product.variants.find((candidate) => candidate.sku === item.sku) : undefined;
    return {
      ...item,
      productName: { ...product.name },
      productSlug: product.slug,
      selectedVariant: variant ? { id: variant.id, attributes: Object.fromEntries(Object.entries(variant.attributes).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value])) } : null,
    };
  });
  return { ok: true, value: snapshots };
}
