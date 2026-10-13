import type { Product } from "./types";

export type InquiryItem = { productId: string; sku: string; quantity: number; addedAt: string };
export type InquiryRemoval = { item: InquiryItem; index: number };

export function validQuantity(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function findInquiryVariant(products: readonly Product[], productId: string, sku: string) {
  const product = products.find((entry) => entry.id === productId);
  const variant = product?.variants.find((entry) => entry.sku === sku);
  return product && variant && variant.sku.trim() && validQuantity(variant.moq.quantity) ? { product, variant } : undefined;
}

export function readInquiry(value: string | null, products: readonly Product[]): InquiryItem[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((entry): entry is InquiryItem => {
      if (!entry || typeof entry !== "object") return false;
      const item = entry as Partial<InquiryItem>;
      if (typeof item.productId !== "string" || typeof item.sku !== "string" ||
        typeof item.addedAt !== "string" || !Number.isFinite(Date.parse(item.addedAt)) ||
        !validQuantity(item.quantity) || !findInquiryVariant(products, item.productId, item.sku) || seen.has(item.sku)) return false;
      seen.add(item.sku);
      return true;
    });
  } catch {
    return [];
  }
}

export function addInquiryItem(items: readonly InquiryItem[], products: readonly Product[], productId: string, sku: string, addedAt: string): InquiryItem[] {
  const match = findInquiryVariant(products, productId, sku);
  if (!match || items.some((item) => item.sku === sku) || !Number.isFinite(Date.parse(addedAt))) return [...items];
  return [...items, { productId, sku, quantity: match.variant.moq.quantity, addedAt }];
}

export function updateInquiryQuantity(items: readonly InquiryItem[], sku: string, quantity: number): InquiryItem[] {
  if (!validQuantity(quantity)) return [...items];
  return items.map((item) => item.sku === sku ? { ...item, quantity } : item);
}

export function removeInquiryItem(items: readonly InquiryItem[], sku: string): { items: InquiryItem[]; removed?: InquiryRemoval } {
  const index = items.findIndex((item) => item.sku === sku);
  if (index < 0) return { items: [...items] };
  return { items: items.filter((item) => item.sku !== sku), removed: { item: items[index], index } };
}

export function restoreInquiryItem(items: readonly InquiryItem[], removal: InquiryRemoval): InquiryItem[] {
  if (items.some((item) => item.sku === removal.item.sku)) return [...items];
  const restored = [...items];
  restored.splice(Math.max(0, Math.min(removal.index, restored.length)), 0, removal.item);
  return restored;
}

// A successful RFQ only consumes items that still match the submitted cart.
// A later quantity change or remove-and-add creates a different cart item.
export function removeSubmittedInquiryItems(items: readonly InquiryItem[], submitted: readonly InquiryItem[]): InquiryItem[] {
  return items.filter((item) => !submitted.some((saved) =>
    saved.productId === item.productId && saved.sku === item.sku &&
    saved.quantity === item.quantity && saved.addedAt === item.addedAt));
}
