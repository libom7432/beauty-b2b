import type { AdminProductDetailView } from "./product-detail-view.ts";
import type { CatalogStatus } from "../catalog-read/types.ts";

export type EditorTranslation = { name: string; shortDescription: string; description: string;
  seoTitle: string; seoDescription: string };
export type EditorVariant = { id: string; sku: string; status: CatalogStatus; attributesText: string };
export type EditorImage = { id: string; variantId: string | null; status: CatalogStatus;
  role: "primary" | "detail" | "variant"; sortOrder: number; alt: { en: string; zh: string } };
export type ProductEditorDraft = { slug: string; status: CatalogStatus;
  translations: { en: EditorTranslation; zh: EditorTranslation };
  primaryCategoryId: string | null; additionalCategoryIds: string[];
  variants: EditorVariant[]; images: EditorImage[] };

const blankTranslation = (): EditorTranslation => ({ name: "", shortDescription: "", description: "",
  seoTitle: "", seoDescription: "" });

export function createProductEditorDraft(product: AdminProductDetailView): ProductEditorDraft {
  const translation = (locale: "en" | "zh") => {
    const entry = product.translations[locale];
    if (entry.state !== "available") return blankTranslation();
    const value = entry.value;
    return { name: value.name, shortDescription: value.short_description,
      description: value.description, seoTitle: value.seo_title, seoDescription: value.seo_description };
  };
  return {
    slug: product.basic.slug, status: product.basic.status,
    translations: { en: translation("en"), zh: translation("zh") },
    primaryCategoryId: product.categories.primary?.id ?? null,
    additionalCategoryIds: product.categories.additional.map((category) => category.id),
    variants: product.variants.map((variant) => ({ id: variant.id, sku: variant.sku,
      status: variant.status, attributesText: JSON.stringify(variant.attributes, null, 2) })),
    images: product.images.map((image) => ({ id: image.id, variantId: image.variantId,
      status: image.status, role: image.role, sortOrder: image.sortOrder,
      alt: { en: image.alt.en, zh: image.alt.zh } })),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

function attributeValue(text: string): string {
  try { return stableJson(JSON.parse(text)); }
  catch { return `invalid:${text}`; }
}

/** Formatting-only JSON edits do not make the draft dirty. No browser storage is involved. */
export function productEditorFingerprint(draft: ProductEditorDraft): string {
  return stableJson({ slug: draft.slug, status: draft.status, translations: draft.translations,
    primaryCategoryId: draft.primaryCategoryId, additionalCategoryIds: draft.additionalCategoryIds,
    variants: draft.variants.map((variant) => ({ id: variant.id, sku: variant.sku,
      status: variant.status, attributes: attributeValue(variant.attributesText) })),
    images: draft.images.map((image) => ({ id: image.id, variantId: image.variantId,
      status: image.status, role: image.role, sortOrder: image.sortOrder, alt: image.alt })) });
}

export function changePrimaryCategory(draft: ProductEditorDraft, categoryId: string): ProductEditorDraft {
  const assigned = [draft.primaryCategoryId, ...draft.additionalCategoryIds].filter((id): id is string => !!id);
  if (!assigned.includes(categoryId)) return draft;
  return { ...draft, primaryCategoryId: categoryId,
    additionalCategoryIds: assigned.filter((id) => id !== categoryId) };
}

export function choosePrimaryImage(draft: ProductEditorDraft, imageId: string): ProductEditorDraft {
  const target = draft.images.find((image) => image.id === imageId);
  if (!target || target.variantId !== null || target.role === "variant" ||
    (draft.status === "published" && target.status !== "published")) return draft;
  return { ...draft, images: draft.images.map((image) => image.variantId !== null ? image :
    { ...image, role: image.id === imageId ? "primary" : image.role === "primary" ? "detail" : image.role }) };
}

export function moveProductImage(draft: ProductEditorDraft, imageId: string, direction: -1 | 1): ProductEditorDraft {
  const order = [...draft.images].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
  const index = order.findIndex((image) => image.id === imageId);
  const neighbor = order[index + direction];
  if (index < 0 || !neighbor) return draft;
  if (neighbor.sortOrder === order[index].sortOrder) {
    const reordered = [...order];
    [reordered[index], reordered[index + direction]] = [reordered[index + direction], reordered[index]];
    const ranks = new Map(reordered.map((image, position) => [image.id, position]));
    return { ...draft, images: draft.images.map((image) => ({ ...image, sortOrder: ranks.get(image.id)! })) };
  }
  return { ...draft, images: draft.images.map((image) => image.id === imageId
    ? { ...image, sortOrder: neighbor.sortOrder } : image.id === neighbor.id
      ? { ...image, sortOrder: order[index].sortOrder } : image) };
}
