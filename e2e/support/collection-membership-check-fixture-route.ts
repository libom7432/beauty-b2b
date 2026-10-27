// Copied over the route only inside the temporary Playwright application.
import { cookies } from "next/headers";
import { createCollectionMembershipCheckGET,
  membershipCheckMethodNotAllowed } from "@/lib/admin/collection-membership-check-handler";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const check = createCollectionMembershipCheckGET({
  async access() {
    const role = (await cookies()).get("admin-ui-fixture")?.value;
    return !role ? "anonymous" : role === "editor" || role === "catalog-only"
      ? "allowed" : "forbidden";
  },
  async repository() {
    const state = (await cookies()).get("catalog-read-fixture")?.value;
    if (state === "collections-check-not-connected") {
      return { async checkAdminCollectionMembership(collectionId: string, productId: string) {
        return { collectionId, productId, status: "NOT_CONNECTED" as const, origin: "NONE" as const };
      } };
    }
    return createServerCatalogReadRepository();
  },
});

export async function GET(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  try {
    const { collectionId } = await context.params;
    const result = await check(request, collectionId);
    const state = (await cookies()).get("catalog-read-fixture")?.value;
    if (state === "collections-check-bad-dto" && result.status === 200)
      return Response.json({ collectionId, productId: "00000000-0000-4000-8000-000000009999",
        status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE" },
      { headers: { "Cache-Control": "private, no-store" } });
    if (state === "collections-check-extra-dto" && result.status === 200)
      return Response.json({ collectionId, productId: new URL(request.url).searchParams.get("productId"),
        status: "NOT_MEMBER", origin: "OFFLINE_FIXTURE", privateField: "must-not-be-used" },
      { headers: { "Cache-Control": "private, no-store" } });
    if (state === "collections-check-non-json" && result.status === 200)
      return new Response("not JSON", { status: 200,
        headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain" } });
    return result;
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
