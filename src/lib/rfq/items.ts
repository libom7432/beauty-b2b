import { validQuantity, type InquiryItem } from "@/lib/catalog/inquiry";
import type { Product } from "@/lib/catalog/types";
import type { RFQDraftItem, RFQItemSnapshot, RFQPublicCatalogLookup, RFQResult,
  RFQTrustedItemSnapshot, RFQValidationError } from "./types";

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

/** Candidate for the future server workflow. Caller must supply a connected public Catalog
 * repository; the existing Mock-backed RFQ API is deliberately not wired here. */
export async function snapshotRFQItemsFromPublicCatalog(input: unknown,
  catalog: RFQPublicCatalogLookup): Promise<RFQResult<RFQTrustedItemSnapshot[]>> {
  const checked = validateRFQItemStructure(input);
  if (!checked.ok) return checked;
  const productIds = [...new Set(checked.value.map((item) => item.productId))];
  // Lookup validates UUIDs, bounds the request, and rejects missing/unpublished products.
  const products = await catalog.getPublishedProductsByIds(productIds);
  const byId = new Map(products.map((product) => [product.id.toLowerCase(), product]));
  const errors: RFQValidationError[] = [];
  const snapshots = checked.value.flatMap((item, index): RFQTrustedItemSnapshot[] => {
    const product = byId.get(item.productId.toLowerCase());
    const variant = product?.variants.find((candidate) => candidate.sku === item.sku);
    if (!product || !variant || !item.sku) {
      errors.push({ field: `items[${index}].sku`, code: "INVALID_PRODUCT" });
      return [];
    }
    const { quantity: moq, unit } = variant.moq;
    if (!validQuantity(moq) || typeof unit !== "string" || !unit.trim() || unit !== unit.trim() ||
      unit.length > 64 || /[\x00-\x1f\x7f]/.test(unit)) {
      errors.push({ field: `items[${index}].sku`, code: "INVALID_PRODUCT" });
      return [];
    }
    const en = product.translations.en;
    const zh = product.translations.zh;
    if (en.state !== "available" || zh.state !== "available" || !en.value.name.trim() || !zh.value.name.trim()) {
      errors.push({ field: `items[${index}].productId`, code: "INVALID_PRODUCT" });
      return [];
    }
    return [{ productId: product.id, sku: variant.sku, quantity: item.quantity,
      productName: { en: en.value.name, zh: zh.value.name }, productSlug: product.slug,
      selectedVariant: { id: variant.id, attributes: { ...variant.attributes } },
      moqAtSubmission: moq, moqUnitAtSubmission: unit, belowMoq: item.quantity < moq }];
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: snapshots };
}
