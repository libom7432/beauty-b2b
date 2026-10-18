import { type CatalogPermission, requireAdminIdentity, requireCatalogPermission,
  type CatalogAuthDependencies } from "../catalog-import/admin-auth.ts";
import { CatalogImportError } from "../catalog-import/transaction.ts";

export type AdminAccess = "allowed" | "anonymous" | "forbidden";

/** Shared by server pages and offline tests; no client role or metadata is consulted. */
export async function checkAdminAccess(session: unknown, dependencies: CatalogAuthDependencies,
  permission?: CatalogPermission): Promise<AdminAccess> {
  try {
    if (permission) await requireCatalogPermission(session, permission, dependencies);
    else await requireAdminIdentity(session, dependencies);
    return "allowed";
  } catch (error) {
    if (!(error instanceof CatalogImportError) || error.code !== "PERMISSION_DENIED") throw error;
    try {
      const identity = await dependencies.provider.verifySession(session);
      return identity ? "forbidden" : "anonymous";
    } catch { return "anonymous"; }
  }
}
