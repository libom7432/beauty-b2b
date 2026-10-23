import { CatalogReadError } from "../catalog-read/errors.ts";
import { COLLECTION_CURSOR_MAX_LENGTH } from "../catalog-read/collections-cursor.ts";
import type { AdminCollectionMemberQuery } from "../catalog-read/types.ts";

type RawParams = Record<string, string | string[] | undefined>;

export function parseCollectionMemberQuery(raw: RawParams): AdminCollectionMemberQuery {
  if (Object.keys(raw).some((key) => !["cursor", "direction"].includes(key)) ||
    Object.values(raw).some(Array.isArray)) throw new CatalogReadError("INVALID_INPUT");
  const cursor = raw.cursor;
  const direction = raw.direction ?? "after";
  if (cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0 ||
    cursor.length > COLLECTION_CURSOR_MAX_LENGTH ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) ||
    direction !== "after" && direction !== "before" ||
    direction === "before" && cursor === undefined ||
    raw.direction !== undefined && cursor === undefined)
    throw new CatalogReadError("INVALID_INPUT");
  return cursor === undefined ? {} : { cursor, direction };
}

export function collectionMemberHref(id: string, cursor: string,
  direction: "after" | "before" = "after"): string {
  const params = new URLSearchParams({ cursor });
  if (direction === "before") params.set("direction", direction);
  return `/admin/collections/${encodeURIComponent(id)}?${params}`;
}
