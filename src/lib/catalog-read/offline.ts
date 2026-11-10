import { decodeCursor } from "./repository-core.ts";
import { adminBoundaryWitness, type AdminCursorBoundary } from "./admin-cursor.ts";
import { CatalogReadError } from "./errors.ts";
import { PUBLIC_CATALOG_PROJECTION } from "./types.ts";
import type { CatalogReadSource, CategoryRow, PrivateCatalogBundle, PublicCatalogBundle, SourceQuery } from "./types.ts";
import { MAX_ADMIN_CATEGORIES } from "./admin-categories.ts";

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

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
function compareAdmin(a: PrivateCatalogBundle, b: PrivateCatalogBundle, query: SourceQuery): number {
  const codeSort = query.sort === "product_code_asc" || query.sort === "product_code_desc";
  const left = codeSort ? a.product.product_code : a.product.updated_at;
  const right = codeSort ? b.product.product_code : b.product.updated_at;
  const direction = query.sort === "updated_asc" || query.sort === "product_code_asc" ? 1 : -1;
  return direction * compareText(left, right) || compareText(a.product.id, b.product.id);
}
function comparePublic(a: PublicCatalogBundle, b: PublicCatalogBundle, query: SourceQuery): number {
  if (query.sort === "featured" && a.product.featured !== b.product.featured)
    return a.product.featured ? -1 : 1;
  if (query.sort === "newest" && a.product.published_at !== b.product.published_at)
    return (a.product.published_at ?? "") > (b.product.published_at ?? "") ? -1 : 1;
  return a.product.id.localeCompare(b.product.id);
}
function pageAdmin(rows: readonly PrivateCatalogBundle[], query: SourceQuery) {
  if (query.cursor && !query.adminCursorReference) throw new CatalogReadError("INVALID_INPUT");
  const reference = query.adminCursorReference;
  const matched = reference ? rows.find((row) => row.product.id.toLowerCase() === reference.id.toLowerCase()) : null;
  if (reference && (!matched || adminBoundaryWitness(matched.product) !== reference.witness))
    throw new CatalogReadError("INVALID_INPUT");
  const cursor: AdminCursorBoundary | null = matched ? {
    id: matched.product.id, timestamp: matched.product.updated_at,
    productCode: matched.product.product_code,
  } : null;
  const compareToCursor = (row: PrivateCatalogBundle) => {
    if (!cursor) return 0;
    const codeSort = query.sort === "product_code_asc" || query.sort === "product_code_desc";
    const value = codeSort ? row.product.product_code : row.product.updated_at;
    const boundary = codeSort ? cursor.productCode! : cursor.timestamp!;
    const direction = query.sort === "updated_asc" || query.sort === "product_code_asc" ? 1 : -1;
    return direction * compareText(value, boundary) || compareText(row.product.id, cursor.id);
  };
  if (query.direction === "before" && cursor) {
    const at = rows.findIndex((row) => compareToCursor(row) >= 0);
    const end = at < 0 ? rows.length : at;
    const start = Math.max(0, end - query.limit);
    const page = rows.slice(start, end);
    return { rows: page, hasMore: page.length > 0 && end < rows.length,
      hasPrevious: page.length > 0 && start > 0 };
  }
  const after = cursor ? rows.findIndex((row) => compareToCursor(row) > 0) : 0;
  const start = cursor ? (after < 0 ? rows.length : after) : 0;
  const page = rows.slice(start, start + query.limit);
  return { rows: page, hasMore: start + query.limit < rows.length,
    hasPrevious: page.length > 0 && start > 0 };
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
export function createOfflineCatalogSource(fixtures: readonly PrivateCatalogBundle[],
  allAdminCategories?: readonly CategoryRow[]): CatalogReadSource {
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
    async getPublishedByIds(ids) {
      const selected = new Set(ids.map((id) => id.toLowerCase()));
      return publicRows.filter((row) => selected.has(row.product.id.toLowerCase()));
    },
    async listAdmin(query) {
      const rows = fixtures.filter((bundle) =>
        (!query.status || bundle.product.status === query.status) &&
        (!query.productType || bundle.product.product_type === query.productType) &&
        (!query.categoryId || bundle.categoryLinks.some((link) => link.category_id === query.categoryId)) &&
        (!query.primaryCategoryId || bundle.categoryLinks.some((link) =>
          link.is_primary && link.category_id === query.primaryCategoryId)) &&
        (!query.search || bundle.product.product_code.toLowerCase().includes(query.search) ||
          bundle.translations.some((translation) =>
            (translation.locale === "en" || translation.locale === "zh") &&
            translation.name.toLowerCase().includes(query.search!))))
        .sort((a, b) => compareAdmin(a, b, query));
      return pageAdmin(rows, query);
    },
    async getAdminByCode(code) { return fixtures.find((bundle) => bundle.product.product_code === code) ?? null; },
    async getAdminById(id) { return fixtures.find((bundle) => bundle.product.id.toLowerCase() === id.toLowerCase()) ?? null; },
    async listAdminCategories() {
      const rows = allAdminCategories ?? [...new Map(fixtures.flatMap((bundle) =>
        bundle.categories.map((category) => [category.id, category] as const))).values()];
      return { rows: rows.slice(0, MAX_ADMIN_CATEGORIES + 1),
        totalCount: allAdminCategories ? rows.length : null,
        allCategories: allAdminCategories !== undefined };
    },
    async listAdminPrimaryCategoryOptions() {
      const options = new Map<string, { id: string; nameEn: string; nameZh: string }>();
      for (const bundle of fixtures) for (const link of bundle.categoryLinks) {
        if (!link.is_primary || link.product_id !== bundle.product.id) continue;
        const category = bundle.categories.find((item) => item.id === link.category_id);
        if (category) options.set(category.id, {
          id: category.id, nameEn: category.name_en, nameZh: category.name_zh,
        });
      }
      const sorted = [...options.values()].sort((a, b) =>
        compareText(a.nameEn, b.nameEn) || compareText(a.id, b.id));
      return { items: sorted.slice(0, 50), hasMore: sorted.length > 50 };
    },
  };
}

export const notConfiguredCatalogSource: CatalogReadSource = {
  mode: "not_configured",
  async listPublished() { return { rows: [], hasMore: false }; },
  async getPublishedBySlug() { return null; },
  async listAdmin() { return { rows: [], hasMore: false }; },
  async getAdminByCode() { return null; },
  async getAdminById() { return null; },
  async listAdminPrimaryCategoryOptions() { return { items: [], hasMore: false }; },
};
