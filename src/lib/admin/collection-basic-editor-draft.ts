import type { AdminCollectionDetail, CatalogStatus } from "../catalog-read/types.ts";

export type CollectionBasicDraft = {
  nameEn: string; nameZh: string; descriptionEn: string; descriptionZh: string;
  slug: string; status: CatalogStatus; sortOrderText: string;
};
export type CollectionBasicSelection = {
  original: AdminCollectionDetail; originalDraft: CollectionBasicDraft; draft: CollectionBasicDraft;
};
export type CollectionBasicIssue = { field_path: string; error_code: string; message: string };
export type CollectionBasicValidation = {
  localState: "VALID" | "INVALID"; overallState: "INVALID" | "NOT_VERIFIED";
  issues: CollectionBasicIssue[]; notVerified: string[];
};

const statuses = new Set(["draft", "published", "retired"]);
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const integerPattern = /^[+-]?[0-9]+$/;

export function createCollectionBasicDraft(item: AdminCollectionDetail): CollectionBasicDraft {
  return { nameEn: item.nameEn, nameZh: item.nameZh, descriptionEn: item.descriptionEn,
    descriptionZh: item.descriptionZh, slug: item.slug, status: item.status,
    sortOrderText: String(item.sortOrder) };
}

/** Retain copied safe scalars, never the mutable source object's identity. */
export function createCollectionBasicSelection(item: AdminCollectionDetail): CollectionBasicSelection {
  return { original: Object.freeze({ ...item }),
    originalDraft: Object.freeze(createCollectionBasicDraft(item)), draft: createCollectionBasicDraft(item) };
}

export function collectionBasicFingerprint(draft: CollectionBasicDraft): string {
  return JSON.stringify([draft.nameEn, draft.nameZh, draft.descriptionEn, draft.descriptionZh,
    draft.slug, draft.status, draft.sortOrderText]);
}

export function collectionBasicSourceChanged(original: AdminCollectionDetail,
  current: AdminCollectionDetail | null): boolean {
  if (!current) return true;
  return JSON.stringify([original.id, original.nameEn, original.nameZh, original.descriptionEn,
    original.descriptionZh, original.slug, original.status, original.sortOrder,
    original.createdAt, original.updatedAt, original.publishedAt]) !==
    JSON.stringify([current.id, current.nameEn, current.nameZh, current.descriptionEn,
      current.descriptionZh, current.slug, current.status, current.sortOrder,
      current.createdAt, current.updatedAt, current.publishedAt]);
}

export function canEditCollectionSlug(original: AdminCollectionDetail): boolean {
  return original.status === "draft" && original.publishedAt === null;
}

export function validateCollectionBasicDraft(original: AdminCollectionDetail,
  draft: CollectionBasicDraft): CollectionBasicValidation {
  const issues: CollectionBasicIssue[] = [];
  const add = (field_path: string, error_code: string, message: string) =>
    issues.push({ field_path, error_code, message });
  for (const [field, value] of [["name_en", draft.nameEn], ["name_zh", draft.nameZh],
    ["description_en", draft.descriptionEn], ["description_zh", draft.descriptionZh]] as const) {
    if (typeof value !== "string") add(field, "INVALID_TEXT", "Must be text");
  }
  if (!statuses.has(draft.status)) add("status", "INVALID_STATUS", "Unknown collection status");
  if (original.status === "retired" &&
    collectionBasicFingerprint(draft) !== collectionBasicFingerprint(createCollectionBasicDraft(original)))
    add("status", "RETIRED_TERMINAL", "A retired collection is read only");
  else if (original.status === "published" && !["published", "draft", "retired"].includes(draft.status))
    add("status", "INVALID_TRANSITION", "This status transition is not allowed");
  else if (original.status === "draft" && !["draft", "published", "retired"].includes(draft.status))
    add("status", "INVALID_TRANSITION", "This status transition is not allowed");
  if (draft.status === "published") {
    if (typeof draft.nameEn !== "string" || !draft.nameEn.trim())
      add("name_en", "REQUIRED_FOR_PUBLICATION", "English name is required for a proposed published state");
    if (typeof draft.nameZh !== "string" || !draft.nameZh.trim())
      add("name_zh", "REQUIRED_FOR_PUBLICATION", "Chinese name is required for a proposed published state");
  }
  if (typeof draft.slug !== "string" || draft.slug.length > 200 || !slugPattern.test(draft.slug))
    add("slug", "INVALID_SLUG", "Use up to 200 lowercase ASCII letters, digits and single internal hyphens");
  if (!canEditCollectionSlug(original) && draft.slug !== original.slug)
    add("slug", "SLUG_LOCKED", "Slug is permanently locked after first publication");
  if (typeof draft.sortOrderText !== "string" || !integerPattern.test(draft.sortOrderText) ||
    !Number.isSafeInteger(Number(draft.sortOrderText)) || Number(draft.sortOrderText) < -2147483648 ||
    Number(draft.sortOrderText) > 2147483647)
    add("sort_order", "INVALID_SORT_ORDER", "Sort order must be a PostgreSQL int32 integer");
  return { localState: issues.length ? "INVALID" : "VALID",
    overallState: issues.length ? "INVALID" : "NOT_VERIFIED", issues,
    notVerified: ["Slug global uniqueness", "Current database state and concurrent changes",
      "Final server permissions and write rules"] };
}
