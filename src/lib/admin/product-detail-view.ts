import type { AdminImageDTO, AdminProductDetailDTO } from "../catalog-read/types.ts";

export type SafeAdminImage = Omit<AdminImageDTO, "storageKey" | "publicUrl">;
export type AdminProductDetailView = Omit<AdminProductDetailDTO, "images"> &
  Readonly<{ images: readonly SafeAdminImage[] }>;

/** Keep private Storage paths and unverified image URLs out of the render boundary. */
export function toAdminProductDetailView(product: AdminProductDetailDTO): AdminProductDetailView {
  return { basic: product.basic, translations: product.translations,
    categories: product.categories, variants: product.variants,
    publishing: product.publishing, priceTiers: product.priceTiers, seo: product.seo,
    collections: product.collections,
    images: product.images.map((image) => ({
    id: image.id, variantId: image.variantId, role: image.role, status: image.status,
    sortOrder: image.sortOrder, alt: image.alt, width: image.width,
    height: image.height, format: image.format,
  })) };
}
