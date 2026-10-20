import { CatalogReadError } from "../catalog-read/errors.ts";
import type { CatalogReadRepository } from "../catalog-read/repository-core.ts";
import type { AdminProductDetailDTO } from "../catalog-read/types.ts";

export type AdminProductDetailState = Readonly<
  { kind: "success"; product: AdminProductDetailDTO } |
  { kind: "not_connected" | "not_found" | "source_unavailable" }
>;

/** The Repository performs a fresh catalog.read check before its source lookup. */
export async function loadAdminProductDetail(
  repository: Pick<CatalogReadRepository, "getAdminProductByCode">,
  productCode: string,
): Promise<AdminProductDetailState> {
  try {
    return { kind: "success", product: await repository.getAdminProductByCode(productCode) };
  } catch (error) {
    if (error instanceof CatalogReadError) {
      if (error.code === "FORBIDDEN" || error.code === "INVALID_INPUT") throw error;
      if (error.code === "NOT_CONFIGURED") return { kind: "not_connected" };
      if (error.code === "NOT_FOUND") return { kind: "not_found" };
    }
    return { kind: "source_unavailable" };
  }
}

/** UUID route shares the B3 view model and error states. */
export async function loadAdminProductDetailById(
  repository: Pick<CatalogReadRepository, "getAdminProductById">,
  productId: string,
): Promise<AdminProductDetailState> {
  try {
    return { kind: "success", product: await repository.getAdminProductById(productId) };
  } catch (error) {
    if (error instanceof CatalogReadError) {
      if (error.code === "FORBIDDEN" || error.code === "INVALID_INPUT") throw error;
      if (error.code === "NOT_CONFIGURED") return { kind: "not_connected" };
      if (error.code === "NOT_FOUND") return { kind: "not_found" };
    }
    return { kind: "source_unavailable" };
  }
}
