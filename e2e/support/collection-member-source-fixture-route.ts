// Installed only in the isolated Playwright copy; production authorization is unchanged.
import { cookies, headers } from "next/headers";
import { createCollectionMemberSourceGET,
  memberSourceMethodNotAllowed } from "@/lib/admin/collection-member-source-handler";
import { createServerCatalogReadRepository } from "@/lib/catalog-read/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const read = createCollectionMemberSourceGET({
  async access() {
    const role = (await cookies()).get("admin-ui-fixture")?.value;
    return !role ? "anonymous" : role === "editor" || role === "catalog-only" ||
      role === "rfq-reader" || role === "rfq-manager"
      ? "allowed" : "forbidden";
  },
  async repository() {
    const repository = await createServerCatalogReadRepository();
    return {
      async getAdminCollectionById(id: string) {
        if (id !== "550e8400-e29b-41d4-a716-446655440000")
          return repository.getAdminCollectionById(id);
        return { state: "COMPLETE" as const, origin: "OFFLINE_FIXTURE" as const, issues: [],
          item: { id, slug: "fixture-collection", nameEn: "Original collection", nameZh: "原始集合",
            descriptionEn: "", descriptionZh: "", status: "draft" as const, sortOrder: 1,
            publishedAt: null, createdAt: "2026-09-01T00:00:00.000Z",
            updatedAt: "2026-10-01T00:00:00.000Z" } };
      },
      async listAdminCollectionMembers(id: string, query?: Parameters<typeof repository.listAdminCollectionMembers>[1]) {
        if (id !== "550e8400-e29b-41d4-a716-446655440000")
          return repository.listAdminCollectionMembers(id, query);
        const fixtureView = (await headers()).get("referer")
          ?.includes("/admin/collection-membership-refresh-fixture");
        const mode = fixtureView
          ? (await cookies()).get("membership-source-mode")?.value ?? "same" : null;
        if (mode) {
          const unavailable = { state: mode === "incomplete" ? "INCOMPLETE" as const :
            mode === "error" ? "ERROR" as const : mode === "disconnected"
              ? "NOT_CONNECTED" as const : "EMPTY_PAGE" as const,
            origin: "NONE" as const, items: [], issues: [], nextCursor: null,
            previousCursor: null };
          if (["incomplete", "error", "disconnected", "empty"].includes(mode)) return unavailable;
          const product = { productId: "550e8400-e29b-41d4-a716-446655440001",
            productCode: "TEST-1", nameEn: mode === "updated" ? "Updated product" : "Original product",
            nameZh: "测试商品", productStatus: "published" as const,
            sortOrder: mode === "updated" ? 2 : 1 };
          const candidate = { productId: "550e8400-e29b-41d4-a716-446655440002",
            productCode: "TEST-2", nameEn: "Fixture candidate", nameZh: null,
            productStatus: "published" as const, sortOrder: 3 };
          return { state: "COMPLETE" as const, origin: "OFFLINE_FIXTURE" as const,
            items: mode === "duplicate" ? [product, { ...product, sortOrder: 2 }] :
              mode === "candidate-member" ? [product, candidate] : [product],
            issues: [], nextCursor: null, previousCursor: null };
        }
        return { state: "COMPLETE" as const, origin: "OFFLINE_FIXTURE" as const,
          items: [{ productId: "00000202-0000-4000-8000-000000000000", productCode: "FAMILY-202",
            nameEn: "Fixture member", nameZh: null, productStatus: "published" as const,
            sortOrder: 0 }], issues: [], nextCursor: null, previousCursor: null };
      },
    };
  },
});

export async function GET(request: Request, context: { params: Promise<{ collectionId: string }> }) {
  return read(request, (await context.params).collectionId);
}

export const HEAD = memberSourceMethodNotAllowed;
export const OPTIONS = memberSourceMethodNotAllowed;
export const POST = memberSourceMethodNotAllowed;
export const PUT = memberSourceMethodNotAllowed;
export const PATCH = memberSourceMethodNotAllowed;
export const DELETE = memberSourceMethodNotAllowed;
