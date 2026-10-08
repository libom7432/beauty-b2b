import type { Product } from "./types";
import { mockProducts } from "./mock-products";

// A later verified import can replace this source without changing catalog consumers.
export const products: Product[] = mockProducts;

export function getProductBySlug(slug: string) { return products.find((product) => product.slug === slug); }
export function getFeaturedProducts() { return products.filter((product) => product.featured); }
export function getNewArrivals() { return products.filter((product) => product.newArrival); }
export function getProductsForCategory(categoryId: string) {
  return products.filter((product) => [product.categoryId, product.subcategoryId, product.childCategoryId].includes(categoryId));
}
