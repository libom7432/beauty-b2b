import { CatalogImportError } from "@/lib/catalog-import/transaction";
import { readAdminUISession } from "@/lib/admin/ui-identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "private, no-store" };
const error = (status: number) => Response.json({ error: "IDENTITY_UNAVAILABLE" }, { status, headers });

/** No client-supplied identity is accepted; the session and grants come from server Auth. */
export async function GET() {
  try {
    const session = await readAdminUISession();
    if (!session) return error(401);
    return Response.json({ adminId: session.admin.admin_id, sessionKey: session.sessionKey,
      canReadCatalog: session.admin.permissions.includes("catalog.read") },
      { status: 200, headers });
  } catch (cause) {
    return error(cause instanceof CatalogImportError && cause.code === "PERMISSION_DENIED" ? 403 : 500);
  }
}

const methodNotAllowed = () => new Response(null, { status: 405,
  headers: { ...headers, Allow: "GET" } });
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
