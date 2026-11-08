import { COLLECTION_UUID } from "../catalog-read/collections-cursor.ts";
import { CatalogReadError } from "../catalog-read/errors.ts";
import type { CatalogReadRepository } from "../catalog-read/repository-core.ts";
import type { AdminAccess } from "./access.ts";
import { parseCollectionMemberQuery } from "./collection-detail-query.ts";

const headers = { "Cache-Control": "private, no-store" };
const json = (body: object, status: number) => Response.json(body, { status, headers });
export const memberSourceMethodNotAllowed = () =>
  new Response(null, { status: 405, headers: { ...headers, Allow: "GET" } });

type Dependencies = Readonly<{
  access: () => Promise<AdminAccess>;
  repository: () => Promise<Pick<CatalogReadRepository,
    "getAdminCollectionById" | "listAdminCollectionMembers">>;
}>;

/** The request is independently authorized. Its response carries no client authority:
 * the Owner binds it to the visit and generation captured before fetch begins. */
export function createCollectionMemberSourceGET(dependencies: Dependencies) {
  return async (request: Request, collectionId: string): Promise<Response> => {
    let access: AdminAccess;
    try { access = await dependencies.access(); }
    catch { return json({ error: "UNAVAILABLE" }, 500); }
    if (access !== "allowed") return json({ error: access === "anonymous" ? "UNAUTHORIZED" : "FORBIDDEN" },
      access === "anonymous" ? 401 : 403);
    let query;
    let pageKey: string;
    try {
      if (request.method !== "GET" || request.body !== null || request.url.length > 2048 ||
        !COLLECTION_UUID.test(collectionId)) return json({ error: "INVALID_INPUT" }, 400);
      const url = new URL(request.url);
      decodeURIComponent(url.pathname);
      decodeURIComponent(url.search);
      if ([...url.searchParams.keys()].some((key) => key !== "cursor" && key !== "direction") ||
        url.searchParams.getAll("cursor").length > 1 ||
        url.searchParams.getAll("direction").length > 1)
        return json({ error: "INVALID_INPUT" }, 400);
      query = parseCollectionMemberQuery({ cursor: url.searchParams.get("cursor") ?? undefined,
        direction: url.searchParams.get("direction") ?? undefined });
      pageKey = query.cursor ? `${query.direction}:` + query.cursor : "first";
    } catch { return json({ error: "INVALID_INPUT" }, 400); }
    try {
      const repository = await dependencies.repository();
      const detail = await repository.getAdminCollectionById(collectionId);
      const members = detail.state === "COMPLETE"
        ? await repository.listAdminCollectionMembers(collectionId, query) : null;
      return json({ collectionId: collectionId.toLowerCase(), pageKey, detail, members }, 200);
    } catch (error) {
      if (error instanceof CatalogReadError && error.code === "FORBIDDEN")
        return json({ error: "FORBIDDEN" }, 403);
      if (error instanceof CatalogReadError && error.code === "INVALID_INPUT")
        return json({ error: "INVALID_INPUT" }, 400);
      return json({ error: "UNAVAILABLE" }, 500);
    }
  };
}
