import { CatalogReadError } from "../catalog-read/errors.ts";
import type { CatalogReadRepository } from "../catalog-read/repository-core.ts";
import type { AdminProductListDTO } from "../catalog-read/types.ts";

export type AdminProductsListState = Readonly<
  { kind: "not_connected" | "empty" | "source_unavailable"; products: readonly [] } |
  { kind: "success"; products: readonly AdminProductListDTO[]; hasNextPage: boolean }
>;

/** The Repository performs a fresh catalog.read check before any source access. */
export async function loadAdminProductsList(repository: Pick<CatalogReadRepository, "listAdminProducts">):
  Promise<AdminProductsListState> {
  try {
    const page = await repository.listAdminProducts();
    return page.items.length === 0 ? { kind: "empty", products: [] } :
      { kind: "success", products: page.items, hasNextPage: page.nextCursor !== null };
  } catch (error) {
    if (error instanceof CatalogReadError) {
      if (error.code === "FORBIDDEN") throw error;
      if (error.code === "NOT_CONFIGURED") return { kind: "not_connected", products: [] };
    }
    return { kind: "source_unavailable", products: [] };
  }
}
