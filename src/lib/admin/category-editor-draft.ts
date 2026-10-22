import type { AdminCategoryDTO, AdminCategoryReadResult, CatalogStatus } from "../catalog-read/types.ts";

export type CategoryDraft = {
  nameEn: string; nameZh: string; descriptionEn: string; descriptionZh: string;
  status: CatalogStatus; sortOrderText: string;
};
export type CategoryDraftIssue = { field_path: string; error_code: string; message: string };
export type CategoryDraftValidation = {
  localState: "VALID" | "INVALID";
  overallState: "INVALID" | "NOT_VERIFIED";
  issues: CategoryDraftIssue[]; notVerified: string[];
};
export type CategorySelection = {
  originalCategory: AdminCategoryDTO;
  originalDraft: CategoryDraft;
  draft: CategoryDraft;
};

const statuses = new Set(["draft", "published", "retired"]);
const integer = /^[+-]?[0-9]+$/;
const parsedSortOrder = (value: string) => integer.test(value) && Number.isInteger(Number(value)) &&
  Number(value) >= -2147483648 && Number(value) <= 2147483647 ? Number(value) : null;

export function createCategoryDraft(category: AdminCategoryDTO): CategoryDraft {
  return { nameEn: category.nameEn, nameZh: category.nameZh,
    descriptionEn: category.descriptionEn, descriptionZh: category.descriptionZh,
    status: category.status, sortOrderText: String(category.sortOrder) };
}

/** Copy every safe scalar at selection time; never retain a Repository object reference. */
export function createCategorySelection(category: AdminCategoryDTO): CategorySelection {
  return { originalCategory: Object.freeze({ ...category }),
    originalDraft: Object.freeze(createCategoryDraft(category)), draft: createCategoryDraft(category) };
}

export function categorySourceChanged(original: AdminCategoryDTO, current: AdminCategoryDTO | undefined): boolean {
  if (!current) return true;
  return JSON.stringify([original.id, original.parentId, original.slug, original.status,
    original.nameEn, original.nameZh, original.descriptionEn, original.descriptionZh, original.sortOrder]) !==
    JSON.stringify([current.id, current.parentId, current.slug, current.status,
      current.nameEn, current.nameZh, current.descriptionEn, current.descriptionZh, current.sortOrder]);
}

export function categoryDraftFingerprint(draft: CategoryDraft): string {
  const order = typeof draft.sortOrderText === "string" ? parsedSortOrder(draft.sortOrderText) : null;
  return JSON.stringify([draft.nameEn, draft.nameZh, draft.descriptionEn, draft.descriptionZh,
    draft.status, order === null ? draft.sortOrderText : order]);
}

/** Validate only evidence carried by the read-only category DTO. */
export function validateCategoryDraft(category: AdminCategoryDTO, draft: CategoryDraft,
  result: AdminCategoryReadResult): CategoryDraftValidation {
  const issues: CategoryDraftIssue[] = [];
  const notVerified: string[] = [];
  const add = (field_path: string, error_code: string, message: string) =>
    issues.push({ field_path, error_code, message });
  for (const [field, value] of [["name_en", draft.nameEn], ["name_zh", draft.nameZh],
    ["description_en", draft.descriptionEn], ["description_zh", draft.descriptionZh]] as const) {
    if (typeof value !== "string") add(field, "INVALID_TEXT", "Category text must be a string");
  }
  if (!statuses.has(draft.status)) add("status", "INVALID_STATUS", "Unknown category status");
  if (typeof draft.sortOrderText !== "string" || parsedSortOrder(draft.sortOrderText) === null)
    add("sort_order", "INVALID_SORT_ORDER", "Sort order must fit a PostgreSQL integer");

  const categories = new Map(result.items.map((item) => [item.id, item]));
  if (draft.status === "published" && category.parentId) {
    const parent = categories.get(category.parentId);
    if (parent && parent.status !== "published")
      add("status", "UNPUBLISHED_CATEGORY_PARENT", "Published category needs a published parent");
    else if (!parent) notVerified.push("Parent category status is unavailable");
  }
  if (category.status === "published" && draft.status !== "published") {
    const publishedChild = result.items.some((item) => item.parentId === category.id && item.status === "published");
    if (publishedChild) add("status", "PUBLISHED_CHILD_CATEGORY",
      "A published child category requires this parent to remain published");
    if (result.state !== "COMPLETE") notVerified.push("Other child categories may be outside the loaded set");
    notVerified.push("Published product associations are unavailable from the safe category DTO");
  }
  if (result.state !== "COMPLETE")
    notVerified.push("The loaded category set is incomplete; global hierarchy checks cannot be proven");
  notVerified.push("Category name completeness and length have no established database or import limit");
  notVerified.push("Publication eligibility and product association impact require unavailable context");
  return { localState: issues.length ? "INVALID" : "VALID",
    overallState: issues.length ? "INVALID" : "NOT_VERIFIED", issues, notVerified };
}
