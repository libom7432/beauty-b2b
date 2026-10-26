import { COLLECTION_UUID } from "../catalog-read/collections-cursor.ts";
import { CatalogReadError } from "../catalog-read/errors.ts";
import type { CatalogReadRepository } from "../catalog-read/repository-core.ts";
import type { AdminCollectionMembershipCheckResult } from "../catalog-read/types.ts";
import type { AdminAccess } from "./access.ts";

const cacheControl = "private, no-store";
const statuses = new Set(["MEMBER", "NOT_MEMBER", "NOT_CONNECTED", "ERROR", "INCOMPLETE"]);
const origins = new Set(["NONE", "OFFLINE_FIXTURE", "READ_ONLY_DATABASE"]);

const json = (body: object, status: number): Response => Response.json(body, {
  status, headers: { "Cache-Control": cacheControl },
});

export function membershipCheckMethodNotAllowed(): Response {
  return new Response(null, { status: 405,
    headers: { "Cache-Control": cacheControl, Allow: "GET" } });
}

type Dependencies = Readonly<{
  access: () => Promise<AdminAccess>;
  repository: () => Promise<Pick<CatalogReadRepository, "checkAdminCollectionMembership">>;
}>;

/** One authorized, uncached observation. The Repository performs its own catalog.read check. */
export function createCollectionMembershipCheckGET(dependencies: Dependencies) {
  return async (request: Request, collectionId: string): Promise<Response> => {
    let access: AdminAccess;
    try { access = await dependencies.access(); }
    catch { return json({ error: "UNAVAILABLE" }, 500); }
    if (access !== "allowed")
      return json({ error: access === "anonymous" ? "UNAUTHORIZED" : "FORBIDDEN" },
        access === "anonymous" ? 401 : 403);

    let productId: string;
    try {
      if (request.method !== "GET" || request.body !== null || request.url.length > 2048)
        return json({ error: "INVALID_INPUT" }, 400);
      const url = new URL(request.url);
      decodeURIComponent(url.pathname);
      decodeURIComponent(url.search);
      const values = url.searchParams.getAll("productId");
      if (!COLLECTION_UUID.test(collectionId) ||
        [...url.searchParams.keys()].some((key) => key !== "productId") ||
        values.length !== 1 || !COLLECTION_UUID.test(values[0]))
        return json({ error: "INVALID_INPUT" }, 400);
      productId = values[0];
    } catch { return json({ error: "INVALID_INPUT" }, 400); }

    try {
      const repository = await dependencies.repository();
      const result = await repository.checkAdminCollectionMembership(collectionId, productId);
      const { collectionId: echoedCollectionId, productId: echoedProductId, status, origin } = result;
      if (typeof echoedCollectionId !== "string" ||
        echoedCollectionId.toLowerCase() !== collectionId.toLowerCase() ||
        typeof echoedProductId !== "string" ||
        echoedProductId.toLowerCase() !== productId.toLowerCase() ||
        !statuses.has(status) || !origins.has(origin))
        return json({ error: "UNAVAILABLE" }, 500);
      const safe: AdminCollectionMembershipCheckResult = {
        collectionId: echoedCollectionId, productId: echoedProductId, status, origin,
      };
      return json(safe, 200);
    } catch (error) {
      if (error instanceof CatalogReadError && error.code === "FORBIDDEN")
        return json({ error: "FORBIDDEN" }, 403);
      if (error instanceof CatalogReadError && error.code === "INVALID_INPUT")
        return json({ error: "INVALID_INPUT" }, 400);
      return json({ error: "UNAVAILABLE" }, 500);
    }
  };
}
