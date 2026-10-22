import test from "node:test";
import assert from "node:assert/strict";
import { createProductEditorDraft, productEditorFingerprint, changePrimaryCategory,
  choosePrimaryImage, moveProductImage } from "../src/lib/admin/product-editor-draft.ts";
import { canEditProductSlug, validateProductEditorDraft } from "../src/lib/admin/product-editor-validation.ts";

const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
const date = "2026-10-01T00:00:00Z";
function product(status = "draft", publishedAt = null) {
  const productId = id(1);
  const category = (n) => ({ id: id(n), slug: `category-${n}`, name: { en: `Category ${n}`, zh: `分类 ${n}` },
    parentId: null, path: [`category-${n}`] });
  const translation = (locale) => ({ state: "available", value: { product_id: productId, locale,
    name: `Name ${locale}`, short_description: "Short", description: "Description",
    seo_title: "SEO title", seo_description: "SEO description", created_at: date, updated_at: date } });
  return { basic: { id: productId, product_code: "PN-1", slug: "pn-1", product_type: "press_on_nails",
    status, published_at: publishedAt, created_at: date, updated_at: date },
    translations: { en: translation("en"), zh: translation("zh") },
    categories: { primary: category(10), additional: [category(11)], ancestors: [], path: ["category-10"] },
    variants: [{ id: id(20), productId, sku: "SKU-1", status: "published", attributes: { color: "red" },
      moq: { quantity: 100, unit: "pieces" }, orderMultiple: null, package: null,
      referencePrice: { kind: "not_provided" }, imageIds: [] },
      { id: id(21), productId, sku: "SKU-2", status: "draft", attributes: { color: "blue" },
        moq: { quantity: 100, unit: "pieces" }, orderMultiple: null, package: null,
        referencePrice: { kind: "not_provided" }, imageIds: [] }],
    images: [{ id: id(30), variantId: null, role: "primary", status: "published", sortOrder: 0,
      alt: { en: "Front", zh: "正面" }, width: null, height: null, format: null },
      { id: id(31), variantId: null, role: "detail", status: "published", sortOrder: 1,
        alt: { en: "Side", zh: "侧面" }, width: null, height: null, format: null },
      { id: id(32), variantId: id(21), role: "variant", status: "draft", sortOrder: 2,
        alt: { en: "SKU view", zh: "" }, width: null, height: null, format: null }],
    seo: { indexable: false, en: { state: "available", value: { title: "SEO title", description: "SEO description" } },
      zh: { state: "available", value: { title: "SEO title", description: "SEO description" } } },
    publishing: { status, publishedAt }, priceTiers: { state: "unavailable", reason: "absent" },
    collections: { state: "unavailable", reason: "absent" } };
}

test("draft fingerprint compares semantic JSON and discard can restore every original field", () => {
  const initial = createProductEditorDraft(product());
  const changed = { ...initial, slug: "new-slug", variants: initial.variants.map((variant) =>
    variant.id === id(20) ? { ...variant, attributesText: '{ "color" : "red" }' } : variant) };
  assert.notEqual(productEditorFingerprint(changed), productEditorFingerprint(initial));
  assert.equal(productEditorFingerprint({ ...initial, variants: changed.variants }), productEditorFingerprint(initial));
  assert.deepEqual(createProductEditorDraft(product()), initial);
});

test("Product Code, existing SKU and previously published slug are immutable", () => {
  const old = product("draft", date);
  assert.equal(canEditProductSlug(old), false);
  assert.equal(canEditProductSlug(product("draft", null)), true);
  const draft = createProductEditorDraft(old);
  draft.slug = "changed";
  draft.variants[0].sku = "changed-sku";
  const codes = validateProductEditorDraft(old, draft).issues.map((issue) => issue.error_code);
  assert.ok(codes.includes("IMMUTABLE_PUBLISHED_SLUG"));
  assert.ok(codes.includes("IMMUTABLE_SKU"));
  assert.equal(old.basic.product_code, "PN-1");
});

test("field errors and complete publish eligibility remain separate", () => {
  const source = product();
  const draft = createProductEditorDraft(source);
  assert.deepEqual(validateProductEditorDraft(source, draft).localState, "VALID");
  assert.deepEqual(validateProductEditorDraft(source, draft).overallState, "NOT_VERIFIED");
  draft.slug = "Bad Slug";
  draft.variants[1].attributesText = '{"color":" RED "}';
  const result = validateProductEditorDraft(source, draft);
  assert.equal(result.localState, "INVALID");
  assert.ok(result.issues.some((issue) => issue.error_code === "INVALID_SLUG" && issue.field_path === "slug"));
  assert.ok(result.issues.some((issue) => issue.error_code === "DUPLICATE_SPECIFICATION" &&
    issue.field_path === "variants[1].attributes"));
});

test("category selection preserves all assigned categories; unknown choice changes nothing", () => {
  const initial = createProductEditorDraft(product());
  const changed = changePrimaryCategory(initial, id(11));
  assert.equal(changed.primaryCategoryId, id(11));
  assert.deepEqual(changed.additionalCategoryIds, [id(10)]);
  assert.equal(changePrimaryCategory(initial, id(99)), initial);
  assert.equal(validateProductEditorDraft(product(), changed).localState, "VALID");
});

test("image primary selection preserves variant associations and image order is reversible", () => {
  const initial = createProductEditorDraft(product());
  assert.equal(choosePrimaryImage(initial, id(32)), initial);
  assert.equal(choosePrimaryImage({ ...initial, status: "published" }, id(32)).images[2].role, "variant");
  const unavailable = { ...initial, status: "published", images: initial.images.map((image) =>
    image.id === id(31) ? { ...image, status: "draft" } : image) };
  assert.equal(choosePrimaryImage(unavailable, id(31)), unavailable);
  const selected = choosePrimaryImage(initial, id(31));
  assert.equal(selected.images.find((image) => image.id === id(31)).role, "primary");
  assert.equal(selected.images.find((image) => image.id === id(30)).role, "detail");
  assert.equal(selected.images.find((image) => image.id === id(32)).variantId, id(21));
  const moved = moveProductImage(selected, id(31), -1);
  assert.equal(moved.images.find((image) => image.id === id(31)).sortOrder, 0);
  assert.equal(validateProductEditorDraft(product(), moved).localState, "VALID");
  assert.equal(productEditorFingerprint(moveProductImage(moved, id(31), 1)), productEditorFingerprint(selected));
  const tied = { ...initial, images: initial.images.map((image) => ({ ...image, sortOrder: 0 })) };
  const untied = moveProductImage(tied, id(31), -1);
  assert.equal(untied.images.find((image) => image.id === id(31)).sortOrder, 0);
  assert.equal(untied.images.find((image) => image.id === id(30)).sortOrder, 1);
});
