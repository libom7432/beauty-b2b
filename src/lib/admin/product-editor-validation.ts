import { normalizeVariantAttributes } from "../catalog-validation/index.ts";
import type { ValidationIssue } from "../catalog-validation/index.ts";
import type { AdminProductDetailView } from "./product-detail-view.ts";
import type { ProductEditorDraft } from "./product-editor-draft.ts";

export type EditorValidation = { localState: "VALID" | "INVALID";
  overallState: "INVALID" | "NOT_VERIFIED"; issues: ValidationIssue[];
  notVerified: string[] };

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUS = new Set(["draft", "published", "retired"]);
const text = (value: string) => value.trim().length > 0;

/** The trusted published_at field is immutable after first publication in the B2 schema. */
export function canEditProductSlug(product: AdminProductDetailView): boolean {
  return product.basic.published_at === null && product.publishing.publishedAt === null &&
    product.basic.status !== "published";
}

/** Validate only fields present in the safe view. Never construct a fake import aggregate. */
export function validateProductEditorDraft(product: AdminProductDetailView,
  draft: ProductEditorDraft): EditorValidation {
  const issues: ValidationIssue[] = [];
  const add = (error_code: string, field_path: string, message: string, sku?: string) =>
    issues.push({ error_code, field_path, message, severity: "error", product_code: product.basic.product_code,
      ...(sku ? { sku } : {}) });

  if (!SLUG.test(draft.slug)) add("INVALID_SLUG", "slug", "Slug must use lowercase letters, digits and single hyphens");
  if (!canEditProductSlug(product) && draft.slug !== product.basic.slug)
    add("IMMUTABLE_PUBLISHED_SLUG", "slug", "Previously published slug cannot change");
  if (!STATUS.has(draft.status)) add("INVALID_STATUS", "status", "Status must be draft, published or retired");
  for (const [index, locale] of (["en", "zh"] as const).entries()) {
    const translation = draft.translations[locale];
    for (const [key, field] of [["name", "name"], ["shortDescription", "short_description"],
      ["description", "description"], ["seoTitle", "seo_title"],
      ["seoDescription", "seo_description"]] as const) {
      if (draft.status === "published" && !text(translation[key]))
        add("INCOMPLETE_TRANSLATION", `translations[${index}].${field}`,
          `Published product requires ${locale} ${field}`);
    }
  }

  const assigned = [draft.primaryCategoryId, ...draft.additionalCategoryIds].filter((id): id is string => !!id);
  const originalAssigned = [product.categories.primary?.id,
    ...product.categories.additional.map((category) => category.id)].filter((id): id is string => !!id);
  if (new Set(assigned).size !== assigned.length || assigned.some((id) => !originalAssigned.includes(id)) ||
    assigned.length !== originalAssigned.length) add("DUPLICATE_CATEGORY", "categories",
      "Only the current category associations can be rearranged in this local draft");
  if (draft.status === "published" && !draft.primaryCategoryId)
    add("MISSING_PRIMARY_CATEGORY", "categories", "Published product needs a primary category");

  const originalVariants = new Map(product.variants.map((variant) => [variant.id, variant]));
  const combinations = new Set<string>();
  for (const [index, variant] of draft.variants.entries()) {
    const path = `variants[${index}]`;
    const original = originalVariants.get(variant.id);
    if (!original || original.sku !== variant.sku) add("IMMUTABLE_SKU", `${path}.sku`, "Existing SKU code cannot change", variant.sku);
    if (!STATUS.has(variant.status)) add("INVALID_STATUS", `${path}.status`, "Invalid SKU status", variant.sku);
    if (draft.status === "retired" && variant.status === "published")
      add("RETIRED_PUBLISHED_SKU", `${path}.status`, "Retired product cannot have a published SKU", variant.sku);
    try {
      const parsed: unknown = JSON.parse(variant.attributesText);
      const normalized = normalizeVariantAttributes(parsed);
      const key = JSON.stringify(Object.keys(normalized).sort().map((name) => [name, normalized[name]]));
      if (combinations.has(key)) add("DUPLICATE_SPECIFICATION", `${path}.attributes`,
        "SKU attribute combination duplicates another SKU of this product", variant.sku);
      combinations.add(key);
    } catch (error) {
      add("INVALID_SPECIFICATION", `${path}.attributes`,
        error instanceof Error ? error.message : "Invalid SKU attributes", variant.sku);
    }
  }
  if (draft.variants.length !== product.variants.length) add("INVALID_LIST", "variants",
    "Existing SKUs cannot be added or removed in this local draft");
  if (draft.status === "published" && !draft.variants.some((variant) => variant.status === "published"))
    add("MISSING_PUBLISHED_SKU", "variants", "Published product needs a published SKU");

  const originalImages = new Map(product.images.map((image) => [image.id, image]));
  const primary = draft.images.filter((image) => image.role === "primary");
  if (primary.length > 1) add("MULTIPLE_PRIMARY_IMAGES", "images", "Only one primary image can be selected");
  for (const [index, image] of draft.images.entries()) {
    const original = originalImages.get(image.id);
    if (!original || original.variantId !== image.variantId || original.status !== image.status)
      add("IMAGE_VARIANT_MISMATCH", `images[${index}].variant_id`, "Image association cannot change");
    if (image.role === "primary" && image.variantId !== null)
      add("PRIMARY_IMAGE_VARIANT", `images[${index}].variant_id`, "Primary image cannot reference a SKU");
    if (image.role === "variant" && image.variantId === null)
      add("VARIANT_IMAGE_SKU", `images[${index}].variant_id`, "Variant image requires a SKU");
    if (!Number.isInteger(image.sortOrder) || Math.abs(image.sortOrder) > 2147483647)
      add("INVALID_SORT_ORDER", `images[${index}].sort_order`, "Image order must be a PostgreSQL integer");
    if (draft.status === "published" && image.role === "primary" && image.status === "published" &&
      (!text(image.alt.en) || !text(image.alt.zh)))
      add("MISSING_PRIMARY_ALT", `images[${index}].alt`, "Published primary image requires bilingual ALT");
  }
  if (draft.images.length !== product.images.length) add("INVALID_LIST", "images",
    "Existing images cannot be added or removed in this local draft");
  if (draft.status === "published" && !primary.some((image) => image.status === "published"))
    add("MISSING_PRIMARY_IMAGE", "images", "Published product needs a published primary image");

  return { localState: issues.length ? "INVALID" : "VALID",
    overallState: issues.length ? "INVALID" : "NOT_VERIFIED", issues,
    notVerified: ["Global Product Code, Slug and SKU uniqueness",
      "Complete category choices, category status and ancestry",
      "Private image metadata and Storage availability",
      "Publication history outside the trusted published_at contract and full publish eligibility"] };
}
