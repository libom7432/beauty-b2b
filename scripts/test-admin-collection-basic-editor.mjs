import assert from "node:assert/strict";
import test from "node:test";
import { canEditCollectionSlug, collectionBasicFingerprint, collectionBasicSourceChanged,
  createCollectionBasicSelection, validateCollectionBasicDraft } from "../src/lib/admin/collection-basic-editor-draft.ts";

const id = "550e8400-e29b-41d4-a716-446655440000";
const date = "2026-10-01T00:00:00.000Z";
const original = Object.freeze({ id, slug: "new-arrivals", nameEn: "New Arrivals", nameZh: "新品",
  descriptionEn: "", descriptionZh: "", status: "draft", sortOrder: 0,
  createdAt: date, updatedAt: date, publishedAt: null });
const selection = (item = original) => createCollectionBasicSelection(item);
const check = (item, patch = {}) => validateCollectionBasicDraft(item,
  { ...selection(item).draft, ...patch });

test("selection copies safe scalars and deterministic dirty state can return to clean", () => {
  const source = { ...original };
  const state = selection(source);
  source.nameEn = "Source edited";
  assert.equal(state.original.nameEn, "New Arrivals");
  assert.equal(state.draft.nameEn, "New Arrivals");
  assert.equal(collectionBasicFingerprint(state.draft), collectionBasicFingerprint(state.originalDraft));
  assert.notEqual(collectionBasicFingerprint({ ...state.draft, nameEn: "Changed" }),
    collectionBasicFingerprint(state.originalDraft));
  assert.equal(collectionBasicFingerprint({ ...state.draft, nameEn: "New Arrivals" }),
    collectionBasicFingerprint(state.originalDraft));
});

test("source comparison uses values, including publication history, not object identity", () => {
  assert.equal(collectionBasicSourceChanged(original, { ...original }), false);
  assert.equal(collectionBasicSourceChanged(original, { ...original, updatedAt: "2026-10-02T00:00:00.000Z" }), true);
  assert.equal(collectionBasicSourceChanged(original, { ...original, nameEn: "Updated" }), true);
  assert.equal(collectionBasicSourceChanged(original, { ...original, publishedAt: date }), true);
  assert.equal(collectionBasicSourceChanged(original, null), true);
});

test("draft names optional, publication requires both nonblank; invalid takes priority", () => {
  assert.equal(check(original, { nameEn: "", nameZh: "" }).localState, "VALID");
  const published = check(original, { status: "published", nameEn: " ", nameZh: "" });
  assert.equal(published.localState, "INVALID");
  assert.equal(published.overallState, "INVALID");
  assert.deepEqual(published.issues.filter((issue) => issue.error_code === "REQUIRED_FOR_PUBLICATION")
    .map((issue) => issue.field_path), ["name_en", "name_zh"]);
  assert.equal(check(original, { status: "published" }).localState, "VALID");
  assert.equal(check(original, { status: "published" }).overallState, "NOT_VERIFIED");
  for (const key of ["nameEn", "nameZh", "descriptionEn", "descriptionZh"])
    assert.equal(check(original, { [key]: null }).localState, "INVALID", key);
});

test("status transitions and retired terminal state", () => {
  for (const status of ["draft", "published", "retired"])
    assert.equal(check(original, { status }).localState, "VALID", status);
  const published = { ...original, status: "published", publishedAt: date };
  for (const status of ["draft", "published", "retired"])
    assert.equal(check(published, { status }).localState, "VALID", status);
  assert.equal(check(original, { status: "archived" }).overallState, "INVALID");
  const retired = { ...original, status: "retired", publishedAt: date };
  assert.equal(check(retired).localState, "VALID");
  assert.equal(check(retired, { status: "published" }).overallState, "INVALID");
  assert.equal(check(retired, { nameEn: "New" }).overallState, "INVALID");
});

test("slug follows B5-S2 ASCII format, length and publication lock", () => {
  assert.equal(canEditCollectionSlug(original), true);
  for (const slug of ["", "-x", "x-", "x--y", "UPPER", "中文", "a_b", "a".repeat(201)])
    assert.equal(check(original, { slug }).overallState, "INVALID", slug.slice(0, 20));
  assert.equal(check(original, { slug: "a".repeat(200) }).localState, "VALID");
  const published = { ...original, status: "published", publishedAt: date };
  assert.equal(canEditCollectionSlug(published), false);
  assert.equal(check(published, { status: "draft", slug: "changed" }).overallState, "INVALID");
  assert.equal(canEditCollectionSlug({ ...original, publishedAt: date }), false);
  assert.equal(check({ ...original, publishedAt: date }, { slug: "changed" }).overallState, "INVALID");
});

test("sort order rejects blanks, decimals, non-finite and out-of-int32 values", () => {
  for (const value of ["", " ", "1.2", "NaN", "Infinity", "2147483648", "-2147483649", "abc", null])
    assert.equal(check(original, { sortOrderText: value }).overallState, "INVALID", String(value));
  for (const value of ["-2147483648", "0", "2147483647"])
    assert.equal(check(original, { sortOrderText: value }).localState, "VALID", value);
});

test("every locally valid result still lists independent NOT_VERIFIED gates", () => {
  const result = check(original);
  assert.equal(result.localState, "VALID");
  assert.equal(result.overallState, "NOT_VERIFIED");
  assert.match(result.notVerified.join(" "), /Slug global uniqueness/);
  assert.match(result.notVerified.join(" "), /concurrent changes/);
  assert.match(result.notVerified.join(" "), /server permissions/);
});
