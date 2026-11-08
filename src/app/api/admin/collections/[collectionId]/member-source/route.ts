import { createAdminAuthClient } from "@/lib/admin/supabase-server";
import { adminDirectory } from "@/lib/admin/directory";
import { checkAdminAccess } from "@/lib/admin/access";
import { createCollectionMemberSourceGET,
  memberSourceMethodNotAllowed } from "@/lib/admin/collection-member-source-handler";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const read = createCollectionMemberSourceGET({
  async access() {
    const client = await createAdminAuthClient();
    if (!client) return "anonymous";
    return checkAdminAccess(client, {
      provider: { async verifySession() {
        const { data, error } = await client.auth.getUser();
        return !error && data.user
          ? { identity_provider: "supabase", provider_subject: data.user.id } : null;
      } },
      directory: adminDirectory,
    }, "catalog.read");
  },
  repository: createServerCatalogReadRepository,
});

export async function GET(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  try { return await read(request, (await context.params).collectionId); }
  catch { return Response.json({ error: "UNAVAILABLE" }, { status: 500,
    headers: { "Cache-Control": "private, no-store" } }); }
}

export const HEAD = memberSourceMethodNotAllowed;
export const OPTIONS = memberSourceMethodNotAllowed;
export const POST = memberSourceMethodNotAllowed;
export const PUT = memberSourceMethodNotAllowed;
export const PATCH = memberSourceMethodNotAllowed;
export const DELETE = memberSourceMethodNotAllowed;
