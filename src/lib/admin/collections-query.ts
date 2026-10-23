import { CatalogReadError } from "../catalog-read/errors.ts";
import { COLLECTION_CURSOR_MAX_LENGTH } from "../catalog-read/collections-cursor.ts";
import type { AdminCollectionListQuery, CatalogStatus } from "../catalog-read/types.ts";

type RawParams = Record<string, string | string[] | undefined>;
export type AdminCollectionsUrlQuery = Readonly<{
  status: CatalogStatus | "all";
  cursor: string | null;
  direction: "after" | "before";
  repositoryQuery: AdminCollectionListQuery;
}>;

export function parseAdminCollectionsUrl(raw: RawParams): AdminCollectionsUrlQuery {
  if (Object.keys(raw).some((key) => !["status", "cursor", "direction"].includes(key)) ||
    Object.values(raw).some(Array.isArray)) throw new CatalogReadError("INVALID_INPUT");
  const status = raw.status ?? "all";
  const cursor = raw.cursor ?? null;
  const direction = raw.direction ?? "after";
  if (typeof status !== "string" || !["all", "draft", "published", "retired"].includes(status) ||
    typeof direction !== "string" || !["after", "before"].includes(direction) ||
    (cursor !== null && (typeof cursor !== "string" || cursor.length === 0 ||
      cursor.length > COLLECTION_CURSOR_MAX_LENGTH ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor))) ||
    (direction === "before" && cursor === null) ||
    (raw.direction !== undefined && cursor === null))
    throw new CatalogReadError("INVALID_INPUT");
  const repositoryQuery: AdminCollectionListQuery = {
    ...(status === "all" ? {} : { status: status as CatalogStatus }),
    ...(cursor === null ? {} : { cursor, direction: direction as "after" | "before" }),
  };
  return { status: status as AdminCollectionsUrlQuery["status"], cursor,
    direction: direction as AdminCollectionsUrlQuery["direction"], repositoryQuery };
}

export function adminCollectionsHref(status: AdminCollectionsUrlQuery["status"],
  cursor: string | null = null, direction: "after" | "before" = "after"): string {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (cursor) {
    params.set("cursor", cursor);
    if (direction === "before") params.set("direction", direction);
  }
  const suffix = params.toString();
  return suffix ? `/admin/collections?${suffix}` : "/admin/collections";
}
