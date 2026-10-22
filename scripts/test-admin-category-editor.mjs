import test from "node:test";
import assert from "node:assert/strict";
import { categoryDraftFingerprint, categorySourceChanged, createCategoryDraft,
  createCategorySelection, validateCategoryDraft } from
  "../src/lib/admin/category-editor-draft.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const category = (n, status = "draft", parentId = null) => ({ id: id(n), parentId,
  slug: `category-${n}`, status, nameEn: `Category ${n}`, nameZh: `分类 ${n}`,
  descriptionEn: "Description", descriptionZh: "描述", sortOrder: 0 });
const result = (items, state = "COMPLETE") => ({ state, items, treeIds: items.map((item) => item.id),
  issues: [], totalCount: items.length, origin: "OFFLINE_FIXTURE" });

test("draft is detached, dirty comparison is deterministic and discard restores every value", () => {
  const original = category(1);
  const start = createCategoryDraft(original);
  assert.equal(start.nameEn, original.nameEn);
  assert.equal(start.sortOrderText, "0");
  const changed = { ...start, nameEn: "Changed", sortOrderText: "1" };
  assert.notEqual(categoryDraftFingerprint(changed), categoryDraftFingerprint(start));
  assert.equal(categoryDraftFingerprint({ ...start, sortOrderText: "+00" }), categoryDraftFingerprint(start));
  assert.equal(original.nameEn, "Category 1");
  assert.equal(categoryDraftFingerprint(createCategoryDraft(original)), categoryDraftFingerprint(start));
});

test("selection snapshot is copied and remains stable when source rows disappear or change", () => {
  const original = category(1);
  const selected = createCategorySelection(original);
  original.nameEn = "Mutated source object";
  assert.equal(selected.originalCategory.nameEn, "Category 1");
  assert.equal(selected.originalDraft.nameEn, "Category 1");
  selected.draft.nameEn = "Local draft";
  assert.notEqual(categoryDraftFingerprint(selected.draft), categoryDraftFingerprint(selected.originalDraft));
  assert.equal(categorySourceChanged(selected.originalCategory, undefined), true);
  assert.equal(categorySourceChanged(selected.originalCategory,
    { ...selected.originalCategory, nameEn: "Local draft" }), true);
  assert.equal(categorySourceChanged(selected.originalCategory,
    { ...selected.originalCategory }), false);
});

test("status and PostgreSQL integer boundaries produce field errors", () => {
  const item = category(1);
  const baseline = createCategoryDraft(item);
  assert.equal(validateCategoryDraft(item, baseline, result([item])).localState, "VALID");
  assert.equal(validateCategoryDraft(item, baseline, result([item])).overallState, "NOT_VERIFIED");
  for (const value of ["2147483647", "-2147483648", "0", "01", "+1"]) {
    assert.equal(validateCategoryDraft(item, { ...baseline, sortOrderText: value }, result([item])).localState, "VALID");
  }
  for (const value of ["2147483648", "-2147483649", "1.5", "", "1e3", " 1"]) {
    const checked = validateCategoryDraft(item, { ...baseline, sortOrderText: value }, result([item]));
    assert.ok(checked.issues.some((issue) => issue.field_path === "sort_order" && issue.error_code === "INVALID_SORT_ORDER"), value);
  }
  const invalid = validateCategoryDraft(item, { ...baseline, status: "unknown" }, result([item]));
  assert.equal(invalid.overallState, "INVALID");
  assert.ok(invalid.issues.some((issue) => issue.error_code === "INVALID_STATUS"));
  assert.ok(validateCategoryDraft(item, { ...baseline, nameEn: null }, result([item])).issues
    .some((issue) => issue.field_path === "name_en" && issue.error_code === "INVALID_TEXT"));
});

test("publishing requires a visible published parent; incomplete ancestry stays unverified", () => {
  const parent = category(1, "draft");
  const child = category(2, "draft", parent.id);
  const draft = { ...createCategoryDraft(child), status: "published" };
  const invalid = validateCategoryDraft(child, draft, result([parent, child]));
  assert.ok(invalid.issues.some((issue) => issue.error_code === "UNPUBLISHED_CATEGORY_PARENT"));
  const missing = validateCategoryDraft(child, draft, result([child], "INCOMPLETE"));
  assert.equal(missing.localState, "VALID");
  assert.ok(missing.notVerified.some((reason) => reason.includes("Parent category")));
  assert.ok(missing.notVerified.some((reason) => reason.includes("incomplete")));
});

test("retiring a parent with published children is invalid; product impact remains unverified", () => {
  const parent = category(1, "published");
  const child = category(2, "published", parent.id);
  const draft = { ...createCategoryDraft(parent), status: "retired" };
  const invalid = validateCategoryDraft(parent, draft, result([parent, child]));
  assert.ok(invalid.issues.some((issue) => issue.error_code === "PUBLISHED_CHILD_CATEGORY"));
  assert.ok(invalid.notVerified.some((reason) => reason.includes("product associations")));
  const partial = validateCategoryDraft(parent, draft, result([parent], "INCOMPLETE"));
  assert.equal(partial.overallState, "NOT_VERIFIED");
  assert.ok(partial.notVerified.some((reason) => reason.includes("Other child categories")));
});
