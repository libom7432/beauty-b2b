import { CatalogReadError } from "../catalog-read/errors.ts";
import { normalizeCatalogListQuery } from "../catalog-read/repository-core.ts";
import type { CatalogListQuery, CatalogStatus } from "../catalog-read/types.ts";

export type AdminProductsUrlQuery = Readonly<{
  search: string; status: CatalogStatus | "all"; category: string;
  sort: "updated_desc" | "updated_asc" | "product_code_asc" | "product_code_desc";
  cursor: string | null; direction: "after" | "before"; page: number;
  repositoryQuery: CatalogListQuery;
}>;
type RawParams = Record<string, string | string[] | undefined>;
const sortOptions = new Set<AdminProductsUrlQuery["sort"]>([
  "updated_desc", "updated_asc", "product_code_asc", "product_code_desc",
]);
const input = (raw: RawParams, key: string): string | undefined => {
  const value = raw[key];
  if (Array.isArray(value)) throw new CatalogReadError("INVALID_INPUT");
  return value;
};

/** Previous uses the current page's first-row cursor with a reverse keyset read. */
export function parseAdminProductsUrl(raw: RawParams): AdminProductsUrlQuery {
  const search = (input(raw, "q") ?? "").trim();
  const status = input(raw, "status") ?? "all";
  const category = input(raw, "category") ?? "";
  const sort = input(raw, "sort") ?? "updated_desc";
  const cursor = input(raw, "cursor") || null;
  const direction = input(raw, "direction") ?? "after";
  const pageText = input(raw, "page") ?? "1";
  const page = Number(pageText);
  if (!["all", "draft", "published", "retired"].includes(status) ||
    !sortOptions.has(sort as AdminProductsUrlQuery["sort"]) ||
    search.length > 100 || !["after", "before"].includes(direction) ||
    !/^[1-9][0-9]{0,15}$/.test(pageText) || !Number.isSafeInteger(page) ||
    (cursor === null && (page !== 1 || direction !== "after")) ||
    (cursor !== null && page === 1))
    throw new CatalogReadError("INVALID_INPUT");
  const repositoryQuery: CatalogListQuery = {
    search: search || undefined,
    status: status === "all" ? undefined : status as CatalogStatus,
    primaryCategoryId: category || undefined,
    sort: sort as AdminProductsUrlQuery["sort"],
    cursor: cursor || undefined,
    direction: direction as "after" | "before",
  };
  // Validate filter shape here; the Repository verifies the signed cursor before source access.
  if (cursor && (cursor.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)))
    throw new CatalogReadError("INVALID_INPUT");
  normalizeCatalogListQuery("admin", { ...repositoryQuery, cursor: undefined, direction: "after" });
  return { search, status: status as AdminProductsUrlQuery["status"], category,
    sort: sort as AdminProductsUrlQuery["sort"], cursor,
    direction: direction as "after" | "before", page, repositoryQuery };
}

export function adminProductsHref(query: AdminProductsUrlQuery, cursor: string | null = null,
  direction: "after" | "before" = "after", page = 1): string {
  const params = new URLSearchParams();
  if (query.search) params.set("q", query.search);
  if (query.status !== "all") params.set("status", query.status);
  if (query.category) params.set("category", query.category);
  if (query.sort !== "updated_desc") params.set("sort", query.sort);
  if (cursor) {
    params.set("cursor", cursor);
    if (direction === "before") params.set("direction", "before");
    params.set("page", String(page));
  }
  const suffix = params.toString();
  return suffix ? `/admin/products?${suffix}` : "/admin/products";
}

export function nextAdminProductsHref(query: AdminProductsUrlQuery, nextCursor: string | null): string | null {
  return nextCursor ? adminProductsHref(query, nextCursor, "after", query.page + 1) : null;
}

export function previousAdminProductsHref(query: AdminProductsUrlQuery, previousCursor: string | null): string | null {
  if (!previousCursor) return null;
  if (query.page === 2) return adminProductsHref(query);
  return adminProductsHref(query, previousCursor, "before", query.page - 1);
}
