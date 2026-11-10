import { requireAdminIdentity, type CatalogAuthDependencies } from "../catalog-import/admin-auth.ts";
import { CatalogImportError } from "../catalog-import/transaction.ts";

/** The verified Admin directory is the only grant authority. Catalog grants do not imply RFQ access. */
export async function requireRFQRead(session: unknown, dependencies: CatalogAuthDependencies): Promise<string> {
  const admin = await requireAdminIdentity(session, dependencies);
  if (!admin.permissions.includes("rfq.read")) throw new CatalogImportError("PERMISSION_DENIED");
  return admin.admin_id;
}

/** Managing an inquiry is a separate grant. Neither RFQ read nor Catalog read implies it. */
export async function requireRFQManage(session: unknown, dependencies: CatalogAuthDependencies): Promise<string> {
  const admin = await requireAdminIdentity(session, dependencies);
  if (!admin.permissions.includes("rfq.manage")) throw new CatalogImportError("PERMISSION_DENIED");
  return admin.admin_id;
}

export async function checkRFQReadAccess(session: unknown, dependencies: CatalogAuthDependencies):
  Promise<"allowed" | "anonymous" | "forbidden"> {
  try { await requireRFQRead(session, dependencies); return "allowed"; }
  catch (error) {
    if (!(error instanceof CatalogImportError) || error.code !== "PERMISSION_DENIED") throw error;
    try { return await dependencies.provider.verifySession(session) ? "forbidden" : "anonymous"; }
    catch { return "anonymous"; }
  }
}
