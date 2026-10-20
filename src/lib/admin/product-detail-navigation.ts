import { CatalogReadError } from "../catalog-read/errors.ts";
import { adminProductsHref, parseAdminProductsUrl } from "./products-query.ts";
import { encodeProductCodeSegment } from "./product-code-route.ts";
import { ADMIN_UUID } from "../catalog-read/admin-cursor.ts";

const defaultHref = "/admin/products";

/** Only a canonical, validated Admin list URL is accepted as a return target. */
export function safeProductsReturnHref(value: string | string[] | undefined): string {
  if (typeof value !== "string" || !value.startsWith(`${defaultHref}?`) ||
    value.includes("#") || value.includes("\\") || value.length > 2048 ||
    /[\u0000-\u001f\u007f]/.test(value)) return defaultHref;
  try {
    const url = new URL(value, "https://admin-return.invalid");
    if (url.origin !== "https://admin-return.invalid" || url.pathname !== defaultHref) return defaultHref;
    const raw: Record<string, string | undefined> = {};
    for (const [key, item] of url.searchParams) {
      if (!["q", "status", "category", "sort", "cursor", "direction", "page"].includes(key) || key in raw)
        return defaultHref;
      if (/[\u0000-\u001f\u007f\\]/.test(key) || /[\u0000-\u001f\u007f\\]/.test(item)) return defaultHref;
      raw[key] = item;
    }
    const query = parseAdminProductsUrl(raw);
    return adminProductsHref(query, query.cursor, query.direction, query.page);
  } catch (error) {
    if (error instanceof CatalogReadError || error instanceof TypeError) return defaultHref;
    throw error;
  }
}

export function adminProductDetailHref(productCode: string, listHref: string): string {
  const pathname = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(productCode)
    ? `/admin/products/${encodeURIComponent(productCode)}`
    : `/admin/products/by-code/${encodeProductCodeSegment(productCode)}`;
  return listHref === defaultHref ? pathname : `${pathname}?returnTo=${encodeURIComponent(listHref)}`;
}

/** Short, stable Admin locator. Product Code remains the displayed business identity. */
export function adminProductIdDetailHref(productId: string, listHref: string): string {
  if (!ADMIN_UUID.test(productId)) throw new CatalogReadError("INVALID_INPUT");
  const pathname = `/admin/products/id/${productId.toLowerCase()}`;
  const safeReturn = safeProductsReturnHref(listHref);
  return safeReturn === defaultHref ? pathname : `${pathname}?returnTo=${encodeURIComponent(safeReturn)}`;
}
