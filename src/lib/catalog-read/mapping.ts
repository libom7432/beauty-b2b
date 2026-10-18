import { CatalogReadError } from "./errors.ts";
import { PUBLIC_CATALOG_PROJECTION } from "./types.ts";
import type { AdminImageDTO, AdminProductDetailDTO, AdminProductListDTO, AdminVariantDTO,
  Availability, PrivateCatalogBundle, PublicCatalogBundle, CategoryAssignmentDTO, CategoryDTO,
  CategoryRow, PublicCategoryViewRow, ProductImageRow, ProductVariantRow, PublicProductDTO,
  PublicVariantDTO, ReferencePriceDTO } from "./types.ts";

const unavailable = <T>(reason: string): Availability<T> => ({ state: "unavailable", reason });
const available = <T>(value: T): Availability<T> => ({ state: "available", value });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const invalid = (): never => { throw new CatalogReadError("INTERNAL_ERROR"); };
export function safeBigint(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) return invalid();
  const number = Number(value);
  if (!Number.isSafeInteger(number)) return invalid();
  return number;
}
export function referencePrice(price: string | null, currency: string | null): ReferencePriceDTO {
  if (price === null && currency === null) return { kind: "not_provided" };
  if (price === null || !currency || !/^[A-Z]{3}$/.test(currency) ||
    !/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(price) || !/[1-9]/.test(price)) return invalid();
  return { kind: currency === "USD" ? "usd_reference" : "non_usd_reference", amount: price, currency };
}
function attributes(raw: unknown): Readonly<Record<string, string | number | boolean>> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) ||
      !(typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value))) return invalid();
    result[key] = value;
  }
  return result;
}
export function mapCategories(bundle: PrivateCatalogBundle | PublicCatalogBundle): CategoryAssignmentDTO {
  const byId = new Map(bundle.categories.map((category) => [category.id, category]));
  if (byId.size !== bundle.categories.length || bundle.categories.some((category) => !UUID.test(category.id) ||
    category.parent_id !== null && !UUID.test(category.parent_id))) return invalid();
  const pathFor = (category: CategoryRow | PublicCategoryViewRow): CategoryDTO => {
    const path: string[] = [];
    const visited = new Set<string>();
    let node: CategoryRow | PublicCategoryViewRow | undefined = category;
    while (node) {
      if (visited.has(node.id)) return invalid();
      visited.add(node.id);
      path.unshift(node.slug);
      if (node.parent_id && !byId.has(node.parent_id)) return invalid();
      node = node.parent_id ? byId.get(node.parent_id) : undefined;
      if (path.length > bundle.categories.length) return invalid();
    }
    return { id: category.id, slug: category.slug, parentId: category.parent_id,
      name: { en: category.name_en, zh: category.name_zh }, path };
  };
  const links = bundle.categoryLinks.filter((link) => link.product_id === bundle.product.id)
    .sort((a, b) => a.sort_order - b.sort_order || a.category_id.localeCompare(b.category_id));
  if (links.length !== bundle.categoryLinks.length || links.some((link) => !UUID.test(link.category_id)) ||
    links.filter((link) => link.is_primary).length > 1) return invalid();
  const resolved = links.map((link) => {
    const category = byId.get(link.category_id);
    if (!category) return invalid();
    return { link, category: pathFor(category) };
  });
  const primary = resolved.find((entry) => entry.link.is_primary)?.category ?? null;
  const ancestors: CategoryDTO[] = [];
  if (primary) {
    let node = byId.get(primary.parentId ?? "");
    while (node) { ancestors.unshift(pathFor(node)); node = node.parent_id ? byId.get(node.parent_id) : undefined; }
  }
  return { primary, additional: resolved.filter((entry) => !entry.link.is_primary).map((entry) => entry.category),
    ancestors, path: primary?.path ?? [] };
}
function checkBundle(bundle: PrivateCatalogBundle | PublicCatalogBundle): void {
  const { product, translations, variants, images } = bundle;
  if (!UUID.test(product.id) || !product.product_code || !product.slug) return invalid();
  if (new Set(variants.map((variant) => variant.sku)).size !== variants.length) return invalid();
  if (new Set(variants.map((variant) => variant.id)).size !== variants.length) return invalid();
  if (new Set(translations.map((translation) => translation.locale)).size !== translations.length) return invalid();
  if (variants.some((variant) => variant.product_id !== product.id || !UUID.test(variant.id)) ||
    translations.some((translation) => translation.product_id !== product.id) ||
    images.some((image) => image.product_id !== product.id || !UUID.test(image.id) ||
      image.variant_id !== null && !variants.some((variant) => variant.id === image.variant_id))) return invalid();
}
function adminImage(image: ProductImageRow): AdminImageDTO {
  return { id: image.id, variantId: image.variant_id, storageKey: image.storage_key,
    publicUrl: image.public_url, role: image.role, status: image.status, sortOrder: image.sort_order,
    alt: { en: image.alt_en, zh: image.alt_zh }, width: image.width, height: image.height, format: image.format };
}
function adminVariant(variant: ProductVariantRow, images: readonly ProductImageRow[]): AdminVariantDTO {
  return { id: variant.id, productId: variant.product_id, sku: variant.sku, status: variant.status,
    attributes: attributes(variant.attributes), moq: { quantity: safeBigint(variant.moq_quantity), unit: variant.moq_unit },
    orderMultiple: variant.order_multiple === null ? null : safeBigint(variant.order_multiple),
    package: variant.package_quantity === null ? null : { quantity: safeBigint(variant.package_quantity), unit: variant.package_unit ?? invalid() },
    referencePrice: referencePrice(variant.reference_price, variant.reference_currency),
    imageIds: images.filter((image) => image.variant_id === variant.id).map((image) => image.id) };
}
export function toAdminList(bundle: PrivateCatalogBundle): AdminProductListDTO {
  checkBundle(bundle);
  const translation = bundle.translations.find((row) => row.locale === "en") ?? bundle.translations.find((row) => row.locale === "zh");
  return { id: bundle.product.id, productCode: bundle.product.product_code, slug: bundle.product.slug,
    name: translation ? available(translation.name) : unavailable("translation_missing"),
    productType: bundle.product.product_type, status: bundle.product.status,
    primaryCategory: mapCategories(bundle).primary, variantCount: bundle.variants.length,
    updatedAt: bundle.product.updated_at };
}
export function toAdminDetail(bundle: PrivateCatalogBundle): AdminProductDetailDTO {
  checkBundle(bundle);
  const translation = (locale: "en" | "zh") => {
    const row = bundle.translations.find((item) => item.locale === locale);
    return row ? available(row) : unavailable<typeof bundle.translations[number]>("translation_missing");
  };
  const seo = (locale: "en" | "zh") => {
    const row = bundle.translations.find((item) => item.locale === locale);
    return row ? available({ title: row.seo_title, description: row.seo_description }) :
      unavailable<{ title: string; description: string }>("translation_missing");
  };
  return { basic: bundle.product, translations: { en: translation("en"), zh: translation("zh") },
    categories: mapCategories(bundle), variants: bundle.variants.map((row) => adminVariant(row, bundle.images)),
    images: bundle.images.map(adminImage), seo: { indexable: bundle.product.seo_indexable, en: seo("en"), zh: seo("zh") },
    publishing: { status: bundle.product.status, publishedAt: bundle.product.published_at },
    priceTiers: unavailable("schema_has_no_price_tiers"), collections: unavailable("schema_has_no_collections") };
}
export function toPublic(bundle: PublicCatalogBundle): PublicProductDTO {
  if (bundle[PUBLIC_CATALOG_PROJECTION] !== true) return invalid();
  checkBundle(bundle);
  const translation = (locale: "en" | "zh") => {
    const row = bundle.translations.find((item) => item.locale === locale);
    return row ? available({ name: row.name, shortDescription: row.short_description, description: row.description,
      seoTitle: row.seo_title, seoDescription: row.seo_description }) :
      unavailable<{ name: string; shortDescription: string; description: string; seoTitle: string; seoDescription: string }>("translation_missing");
  };
  const variants: PublicVariantDTO[] = bundle.variants.map((row) => ({ id: row.id, sku: row.sku,
    attributes: attributes(row.attributes), moq: { quantity: safeBigint(row.moq_quantity), unit: row.moq_unit },
    referencePrice: referencePrice(row.reference_price, row.reference_currency),
    imageIds: bundle.images.filter((image) => image.variant_id === row.id).map((image) => image.id),
    tieredPricing: unavailable("schema_has_no_price_tiers") }));
  return { id: bundle.product.id, productCode: bundle.product.product_code, slug: bundle.product.slug,
    productType: bundle.product.product_type, featured: bundle.product.featured, newArrival: bundle.product.new_arrival,
    translations: { en: translation("en"), zh: translation("zh") }, categories: mapCategories(bundle),
    variants, images: bundle.images.map((image) => ({ id: image.id, variantId: image.variant_id,
      publicUrl: image.public_url, role: image.role, sortOrder: image.sort_order,
      alt: { en: image.alt_en, zh: image.alt_zh } })), collections: unavailable("schema_has_no_collections") };
}
