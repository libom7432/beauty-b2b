import { CatalogReadError } from "../catalog-read/errors.ts";
import type { CatalogReadRepository } from "../catalog-read/repository-core.ts";
import type { AdminProductListDTO } from "../catalog-read/types.ts";
import type { CatalogListQuery } from "../catalog-read/types.ts";

export type AdminProductsListState = Readonly<
  { kind: "not_connected" | "empty" | "no_matches" | "source_unavailable"; products: readonly [] } |
  { kind: "success"; products: readonly AdminProductListDTO[];
    nextCursor: string | null; previousCursor: string | null }
>;

/** The Repository performs a fresh catalog.read check before any source access. */
export async function loadAdminProductsList(repository: Pick<CatalogReadRepository, "listAdminProducts">,
  query: CatalogListQuery = {}):
  Promise<AdminProductsListState> {
  try {
    const page = await repository.listAdminProducts(query);
    if (page.items.length === 0) {
      // A one-row authorized existence query distinguishes an empty catalog from no match.
      const catalog = await repository.listAdminProducts({ limit: 1 });
      return { kind: catalog.items.length === 0 ? "empty" : "no_matches", products: [] };
    }
    return { kind: "success", products: page.items, nextCursor: page.nextCursor,
      previousCursor: page.previousCursor ?? null };
  } catch (error) {
    if (error instanceof CatalogReadError) {
      if (error.code === "FORBIDDEN" || error.code === "INVALID_INPUT") throw error;
      if (error.code === "NOT_CONFIGURED") return { kind: "not_connected", products: [] };
    }
    return { kind: "source_unavailable", products: [] };
  }
}
