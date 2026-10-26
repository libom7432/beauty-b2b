import { createAdminAuthClient } from "@/lib/admin/supabase-server";
import { adminDirectory } from "@/lib/admin/directory";
import { checkAdminAccess } from "@/lib/admin/access";
import { createCollectionMembershipCheckGET,
  membershipCheckMethodNotAllowed } from "@/lib/admin/collection-membership-check-handler";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const check = createCollectionMembershipCheckGET({
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
  try {
    const { collectionId } = await context.params;
    return await check(request, collectionId);
  } catch {
    return Response.json({ error: "UNAVAILABLE" }, { status: 500,
      headers: { "Cache-Control": "private, no-store" } });
  }
}

export const HEAD = membershipCheckMethodNotAllowed;
export const OPTIONS = membershipCheckMethodNotAllowed;
export const POST = membershipCheckMethodNotAllowed;
export const PUT = membershipCheckMethodNotAllowed;
export const PATCH = membershipCheckMethodNotAllowed;
export const DELETE = membershipCheckMethodNotAllowed;
