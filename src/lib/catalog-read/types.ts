/** Exact private B2 row shapes. PostgreSQL numeric and bigint cross this boundary as strings. */
export type CatalogStatus = "draft" | "published" | "retired";
export type Locale = "en" | "zh";
export type ProductRow = Readonly<{ id: string; product_code: string; slug: string; product_type: string;
  status: CatalogStatus; attributes: unknown; customization_options: unknown; oem: boolean; odm: boolean;
  lead_time_min_days: number | null; lead_time_max_days: number | null; seo_indexable: boolean;
  featured: boolean; new_arrival: boolean; published_at: string | null; created_at: string; updated_at: string }>;
export type ProductTranslationRow = Readonly<{ product_id: string; locale: Locale; name: string;
  short_description: string; description: string; seo_title: string; seo_description: string;
  created_at: string; updated_at: string }>;
export type ProductVariantRow = Readonly<{ id: string; product_id: string; sku: string; status: CatalogStatus;
  attributes: unknown; moq_quantity: string; moq_unit: string; order_multiple: string | null;
  package_quantity: string | null; package_unit: string | null; reference_price: string | null;
  reference_currency: string | null; sort_order: number; created_at: string; updated_at: string }>;
export type CategoryRow = Readonly<{ id: string; parent_id: string | null; slug: string; status: CatalogStatus;
  name_en: string; name_zh: string; description_en: string; description_zh: string;
  sort_order: number; created_at: string; updated_at: string }>;
export type ProductCategoryRow = Readonly<{ product_id: string; category_id: string; is_primary: boolean;
  sort_order: number; created_at: string; updated_at: string }>;
export type ProductImageRow = Readonly<{ id: string; product_id: string; variant_id: string | null;
  storage_key: string; public_url: string; role: "primary" | "detail" | "variant";
  status: CatalogStatus; sort_order: number; width: number | null; height: number | null;
  format: "jpeg" | "png" | "webp" | "avif" | null; alt_en: string; alt_zh: string;
  created_at: string; updated_at: string }>;

export type PrivateCatalogBundle = Readonly<{ product: ProductRow; translations: readonly ProductTranslationRow[];
  variants: readonly ProductVariantRow[]; categoryLinks: readonly ProductCategoryRow[];
  categories: readonly CategoryRow[]; images: readonly ProductImageRow[] }>;
/** Columns of the six catalog_public views, with no private-only fields or synthetic status. */
export type PublicProductViewRow = Pick<ProductRow, "id" | "product_code" | "slug" | "product_type" |
  "attributes" | "customization_options" | "oem" | "odm" | "lead_time_min_days" |
  "lead_time_max_days" | "seo_indexable" | "featured" | "new_arrival" | "published_at">;
export type PublicVariantViewRow = Pick<ProductVariantRow, "id" | "product_id" | "sku" |
  "attributes" | "moq_quantity" | "moq_unit" | "order_multiple" | "package_quantity" |
  "package_unit" | "reference_price" | "reference_currency" | "sort_order">;
export type PublicCategoryViewRow = Pick<CategoryRow, "id" | "parent_id" | "slug" |
  "name_en" | "name_zh" | "description_en" | "description_zh" | "sort_order">;
export type PublicCategoryLinkViewRow = Pick<ProductCategoryRow, "product_id" | "category_id" |
  "is_primary" | "sort_order">;
export type PublicImageViewRow = Pick<ProductImageRow, "id" | "product_id" | "variant_id" |
  "public_url" | "role" | "sort_order" | "width" | "height" | "format" | "alt_en" | "alt_zh">;
export type PublicTranslationViewRow = Pick<ProductTranslationRow, "product_id" | "locale" |
  "name" | "short_description" | "description" | "seo_title" | "seo_description">;
/** Internal provenance marker, not a SQL column or a serialized DTO field. */
export const PUBLIC_CATALOG_PROJECTION = Symbol("catalog_public");
export type PublicCatalogBundle = Readonly<{ [PUBLIC_CATALOG_PROJECTION]: true; product: PublicProductViewRow;
  translations: readonly PublicTranslationViewRow[]; variants: readonly PublicVariantViewRow[];
  categoryLinks: readonly PublicCategoryLinkViewRow[]; categories: readonly PublicCategoryViewRow[];
  images: readonly PublicImageViewRow[] }>;
export type Availability<T> = Readonly<{ state: "available"; value: T } | { state: "unavailable"; reason: string }>;
export type ReferencePriceDTO = Readonly<
  { kind: "not_provided" } | { kind: "usd_reference" | "non_usd_reference"; amount: string; currency: string }
>;
export type CategoryDTO = Readonly<{ id: string; slug: string; name: { en: string; zh: string };
  parentId: string | null; path: readonly string[] }>;
export type CategoryAssignmentDTO = Readonly<{ primary: CategoryDTO | null;
  additional: readonly CategoryDTO[]; ancestors: readonly CategoryDTO[]; path: readonly string[] }>;
export type AdminVariantDTO = Readonly<{ id: string; productId: string; sku: string; status: CatalogStatus;
  attributes: Readonly<Record<string, string | number | boolean>>; moq: { quantity: number; unit: string };
  orderMultiple: number | null; package: { quantity: number; unit: string } | null;
  referencePrice: ReferencePriceDTO; imageIds: readonly string[] }>;
export type AdminImageDTO = Readonly<{ id: string; variantId: string | null; storageKey: string;
  publicUrl: string; role: ProductImageRow["role"]; status: CatalogStatus; sortOrder: number;
  alt: { en: string; zh: string }; width: number | null; height: number | null; format: ProductImageRow["format"] }>;
export type AdminProductListDTO = Readonly<{ id: string; productCode: string; slug: string;
  name: Availability<string>; productType: string; status: CatalogStatus;
  primaryCategory: CategoryDTO | null; variantCount: number; updatedAt: string }>;
export type AdminProductDetailDTO = Readonly<{ basic: ProductRow; translations: { en: Availability<ProductTranslationRow>;
  zh: Availability<ProductTranslationRow> }; categories: CategoryAssignmentDTO;
  variants: readonly AdminVariantDTO[]; images: readonly AdminImageDTO[];
  seo: { indexable: boolean; en: Availability<{ title: string; description: string }>;
    zh: Availability<{ title: string; description: string }> };
  publishing: { status: CatalogStatus; publishedAt: string | null };
  priceTiers: Availability<never>; collections: Availability<never> }>;
export type PublicVariantDTO = Readonly<{ id: string; sku: string;
  attributes: Readonly<Record<string, string | number | boolean>>; moq: { quantity: number; unit: string };
  referencePrice: ReferencePriceDTO; imageIds: readonly string[];
  tieredPricing: Availability<never> }>;
export type PublicImageDTO = Readonly<{ id: string; variantId: string | null; publicUrl: string;
  role: ProductImageRow["role"]; sortOrder: number; alt: { en: string; zh: string } }>;
export type PublicProductDTO = Readonly<{ id: string; productCode: string; slug: string;
  productType: string; featured: boolean; newArrival: boolean;
  translations: { en: Availability<{ name: string; shortDescription: string; description: string;
    seoTitle: string; seoDescription: string }>;
    zh: Availability<{ name: string; shortDescription: string; description: string;
    seoTitle: string; seoDescription: string }> };
  categories: CategoryAssignmentDTO; variants: readonly PublicVariantDTO[];
  images: readonly PublicImageDTO[]; collections: Availability<never> }>;
export type CatalogScope = "public" | "admin";
export type CatalogSort = "featured" | "newest" | "updated" | "updated_desc" |
  "updated_asc" | "product_code_asc" | "product_code_desc";
export type CatalogListQuery = Readonly<{ limit?: number; cursor?: string; sort?: CatalogSort;
  productType?: string; categoryId?: string; primaryCategoryId?: string;
  search?: string; status?: CatalogStatus; direction?: "after" | "before" }>;
export type SourceQuery = Readonly<{ limit: number; cursor: string | null; sort: CatalogSort;
  productType?: string; categoryId?: string; primaryCategoryId?: string;
  search?: string; status?: CatalogStatus; direction: "after" | "before";
  /** Verified by the Repository before an Admin source is called. Admin adapters must
   * use this boundary, never parse the raw cursor or accept a client boundary. */
  adminCursorReference?: import("./admin-cursor.ts").AdminCursorReference }>;
export type SourcePage<T> = Readonly<{ rows: readonly T[]; hasMore: boolean; hasPrevious?: boolean }>;
export type AdminCategoryOption = Readonly<{ id: string; nameEn: string; nameZh: string }>;
export type AdminCategoryOptions = Readonly<{ items: readonly AdminCategoryOption[]; hasMore: boolean }>;
export type AdminCategoryDTO = Readonly<{ id: string; parentId: string | null; slug: string;
  status: CatalogStatus; nameEn: string; nameZh: string; descriptionEn: string;
  descriptionZh: string; sortOrder: number }>;
export type AdminCategoryIssue = Readonly<{ code: "DUPLICATE_ID" | "MISSING_PARENT" | "CYCLE" |
  "UNREACHABLE" | "DEPTH_OVER_3" | "INVALID_ROW" | "COUNT_MISMATCH";
  categoryId: string | null }>;
export type AdminCategoryReadResult = Readonly<{
  state: "COMPLETE" | "INCOMPLETE" | "NOT_CONNECTED" | "ERROR";
  items: readonly AdminCategoryDTO[]; issues: readonly AdminCategoryIssue[];
  treeIds: readonly string[]; totalCount: number | null;
  origin: "OFFLINE_FIXTURE" | "READ_ONLY_DATABASE" | "NONE";
}>;
export type AdminCategorySourceRow = Pick<CategoryRow, "id" | "parent_id" | "slug" | "status" |
  "name_en" | "name_zh" | "description_en" | "description_zh" | "sort_order">;
export type AdminCategorySourceResult = Readonly<{ rows: readonly AdminCategorySourceRow[];
  totalCount: number | null; allCategories: boolean }>;
export interface CatalogReadSource {
  /** A future read_only adapter must query catalog_public views for public methods.
   * Admin reads must bind search values, escape LIKE wildcards, whitelist ordering,
   * and apply filters plus keyset direction before LIMIT (pageSize + 1). */
  readonly mode: "offline" | "read_only" | "not_configured";
  listPublished(query: SourceQuery): Promise<SourcePage<PublicCatalogBundle>>;
  getPublishedBySlug(slug: string): Promise<PublicCatalogBundle | null>;
  listAdmin(query: SourceQuery): Promise<SourcePage<PrivateCatalogBundle>>;
  getAdminByCode(code: string): Promise<PrivateCatalogBundle | null>;
  /** Optional for older B1 sources; UUID lookup must be bounded and read-only. */
  getAdminById?(id: string): Promise<PrivateCatalogBundle | null>;
  /** Optional for older B1 sources; a connected Admin filter needs a bounded implementation. */
  listAdminPrimaryCategoryOptions?(): Promise<AdminCategoryOptions>;
  /** Bounded, unfiltered catalog_private.categories read. Count and rows share one snapshot. */
  listAdminCategories?(): Promise<AdminCategorySourceResult>;
}
export type CatalogPage<T> = Readonly<{ items: readonly T[]; nextCursor: string | null;
  previousCursor?: string | null }>;
