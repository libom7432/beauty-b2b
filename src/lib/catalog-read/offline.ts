import { decodeCursor } from "./repository-core.ts";
import { CatalogReadError } from "./errors.ts";
import { PUBLIC_CATALOG_PROJECTION } from "./types.ts";
import type { CatalogReadSource, PrivateCatalogBundle, PublicCatalogBundle, SourceQuery } from "./types.ts";

/** Exact catalog_public view columns. Visibility is applied before any public filter. */
export function projectPublicCatalogBundle(bundle: PrivateCatalogBundle): PublicCatalogBundle | null {
  const p = bundle.product;
  if (p.status !== "published") return null;
  const product: PublicCatalogBundle["product"] = {
    id: p.id, product_code: p.product_code, slug: p.slug, product_type: p.product_type,
    attributes: p.attributes, customization_options: p.customization_options, oem: p.oem, odm: p.odm,
    lead_time_min_days: p.lead_time_min_days, lead_time_max_days: p.lead_time_max_days,
    seo_indexable: p.seo_indexable, featured: p.featured, new_arrival: p.new_arrival,
    published_at: p.published_at,
  };
  const variants: PublicCatalogBundle["variants"] = bundle.variants
    .filter((v) => v.status === "published")
    .map((v) => ({ id: v.id, product_id: v.product_id, sku: v.sku, attributes: v.attributes,
      moq_quantity: v.moq_quantity, moq_unit: v.moq_unit, order_multiple: v.order_multiple,
      package_quantity: v.package_quantity, package_unit: v.package_unit,
      reference_price: v.reference_price, reference_currency: v.reference_currency, sort_order: v.sort_order }));
  const visibleVariantIds = new Set(variants.map((v) => v.id));
  const categories: PublicCatalogBundle["categories"] = bundle.categories
    .filter((c) => c.status === "published")
    .map((c) => ({ id: c.id, parent_id: c.parent_id, slug: c.slug, name_en: c.name_en,
      name_zh: c.name_zh, description_en: c.description_en, description_zh: c.description_zh,
      sort_order: c.sort_order }));
  const visibleCategoryIds = new Set(categories.map((c) => c.id));
  const categoryLinks: PublicCatalogBundle["categoryLinks"] = bundle.categoryLinks
    .filter((link) => link.product_id === p.id && visibleCategoryIds.has(link.category_id))
    .map((link) => ({ product_id: link.product_id, category_id: link.category_id,
      is_primary: link.is_primary, sort_order: link.sort_order }));
  const images: PublicCatalogBundle["images"] = bundle.images
    .filter((i) => i.status === "published" &&
      (i.variant_id === null || visibleVariantIds.has(i.variant_id)))
    .map((i) => ({ id: i.id, product_id: i.product_id, variant_id: i.variant_id,
      public_url: i.public_url, role: i.role, sort_order: i.sort_order, width: i.width,
      height: i.height, format: i.format, alt_en: i.alt_en, alt_zh: i.alt_zh }));
  const translations: PublicCatalogBundle["translations"] = bundle.translations
    .map((t) => ({ product_id: t.product_id, locale: t.locale, name: t.name,
      short_description: t.short_description, description: t.description,
      seo_title: t.seo_title, seo_description: t.seo_description }));
  return { [PUBLIC_CATALOG_PROJECTION]: true, product, variants, categories, categoryLinks, images, translations };
}

function compareAdmin(a: PrivateCatalogBundle, b: PrivateCatalogBundle): number {
  if (a.product.updated_at !== b.product.updated_at)
    return a.product.updated_at > b.product.updated_at ? -1 : 1;
  return a.product.id.localeCompare(b.product.id);
}
function comparePublic(a: PublicCatalogBundle, b: PublicCatalogBundle, query: SourceQuery): number {
  if (query.sort === "featured" && a.product.featured !== b.product.featured)
    return a.product.featured ? -1 : 1;
  if (query.sort === "newest" && a.product.published_at !== b.product.published_at)
    return (a.product.published_at ?? "") > (b.product.published_at ?? "") ? -1 : 1;
  return a.product.id.localeCompare(b.product.id);
}
function pageAdmin(rows: readonly PrivateCatalogBundle[], query: SourceQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor, "admin", query) : null;
  const after = cursor ? rows.findIndex((row) =>
    row.product.updated_at < cursor.timestamp ||
    row.product.updated_at === cursor.timestamp && row.product.id > cursor.id) : 0;
  const start = cursor ? (after < 0 ? rows.length : after) : 0;
  return { rows: rows.slice(start, start + query.limit), hasMore: start + query.limit < rows.length };
}
function pagePublic(rows: readonly PublicCatalogBundle[], query: SourceQuery) {
  const cursor = query.cursor ? decodeCursor(query.cursor, "public", query) : null;
  const after = cursor ? rows.findIndex((row) => {
    if (query.sort === "featured" && row.product.featured !== cursor.featured)
      return !row.product.featured && cursor.featured;
    if (query.sort === "newest" && row.product.published_at !== cursor.timestamp)
      return (row.product.published_at ?? "") < cursor.timestamp;
    return row.product.id > cursor.id;
  }) : 0;
  const start = cursor ? (after < 0 ? rows.length : after) : 0;
  return { rows: rows.slice(start, start + query.limit), hasMore: start + query.limit < rows.length };
}

/** In-memory private B2 rows. Public methods operate only on projected view-shaped rows. */
export function createOfflineCatalogSource(fixtures: readonly PrivateCatalogBundle[]): CatalogReadSource {
  const unique = <T>(values: readonly T[]) => new Set(values).size === values.length;
  if (!unique(fixtures.map((row) => row.product.id)) || !unique(fixtures.map((row) => row.product.product_code)) ||
    !unique(fixtures.map((row) => row.product.slug)) || !unique(fixtures.flatMap((row) => row.variants.map((variant) => variant.sku))))
    throw new CatalogReadError("INTERNAL_ERROR");
  const publicRows = fixtures.map(projectPublicCatalogBundle).filter((row): row is PublicCatalogBundle => row !== null);
  return {
    mode: "offline",
    async listPublished(query) {
      const rows = publicRows.filter((bundle) =>
        (!query.status || query.status === "published") &&
        (!query.productType || bundle.product.product_type === query.productType) &&
        (!query.categoryId || bundle.categoryLinks.some((link) => link.category_id === query.categoryId)))
        .sort((a, b) => comparePublic(a, b, query));
      return pagePublic(rows, query);
    },
    async getPublishedBySlug(slug) { return publicRows.find((row) => row.product.slug === slug) ?? null; },
    async listAdmin(query) {
      const rows = fixtures.filter((bundle) =>
        (!query.status || bundle.product.status === query.status) &&
        (!query.productType || bundle.product.product_type === query.productType) &&
        (!query.categoryId || bundle.categoryLinks.some((link) => link.category_id === query.categoryId)))
        .sort(compareAdmin);
      return pageAdmin(rows, query);
    },
    async getAdminByCode(code) { return fixtures.find((bundle) => bundle.product.product_code === code) ?? null; },
  };
}

export const notConfiguredCatalogSource: CatalogReadSource = {
  mode: "not_configured",
  async listPublished() { return { rows: [], hasMore: false }; },
  async getPublishedBySlug() { return null; },
  async listAdmin() { return { rows: [], hasMore: false }; },
  async getAdminByCode() { return null; },
};
