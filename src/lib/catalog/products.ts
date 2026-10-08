import type { Category, Product, ProductVariant } from "./types";
import { mockProducts } from "./mock-products";

// A later verified import can replace this source without changing catalog consumers.
export const products: Product[] = mockProducts;

export function getProductBySlug(slug: string) { return products.find((product) => product.slug === slug); }
export function getFeaturedProducts() { return products.filter((product) => product.featured); }
export function getNewArrivals() { return products.filter((product) => product.newArrival); }
export function getProductsForCategory(category: Category) {
  const field = category.depth === 1 ? "categoryId" : category.depth === 2 ? "subcategoryId" : "childCategoryId";
  return products.filter((product) => product[field] === category.id);
}

export const PRODUCT_LIST_PAGE_SIZE = 12;

export function paginateProducts(items: readonly Product[], rawPage: string | string[] | undefined) {
  const totalPages = Math.max(1, Math.ceil(items.length / PRODUCT_LIST_PAGE_SIZE));
  const requestedPage = typeof rawPage === "string" && /^[1-9]\d*$/.test(rawPage) ? Number(rawPage) : NaN;
  const canonicalRedirect = rawPage !== undefined && (!Number.isSafeInteger(requestedPage) || requestedPage < 2 || requestedPage > totalPages);
  const page = canonicalRedirect || rawPage === undefined ? 1 : requestedPage;
  return {
    page,
    totalPages,
    totalProducts: items.length,
    canonicalRedirect,
    items: items.slice((page - 1) * PRODUCT_LIST_PAGE_SIZE, page * PRODUCT_LIST_PAGE_SIZE),
  };
}

// Choose one purchasable Variant so the displayed MOQ and first-tier price belong together.
export function getProductListingSummary(product: Product) {
  const variant = product.variants.reduce<ProductVariant | undefined>((selected, candidate) => {
    const firstTier = candidate.pricing.tiers[0];
    if (!firstTier) return selected;
    return !selected || firstTier.unitPriceUsd < selected.pricing.tiers[0].unitPriceUsd ? candidate : selected;
  }, undefined);
  const firstTier = variant?.pricing.tiers[0];
  return variant && firstTier ? {
    variantId: variant.id,
    moq: variant.moq,
    startingPrice: { amount: firstTier.unitPriceUsd, unit: variant.moq.unit },
  } : undefined;
}
