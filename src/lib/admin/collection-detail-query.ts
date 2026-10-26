import { CatalogReadError } from "../catalog-read/errors.ts";
import { COLLECTION_CURSOR_MAX_LENGTH } from "../catalog-read/collections-cursor.ts";
import type { AdminCollectionMemberQuery } from "../catalog-read/types.ts";

export type RawParams = Record<string, string | string[] | undefined>;
export type UrlEntry = readonly [string, string];
const candidateKeys = new Set(["candidate_q", "candidate_status", "candidate_cursor", "candidate_direction"]);
const memberKeys = new Set(["cursor", "direction"]);
const knownKeys = new Set([...memberKeys, ...candidateKeys]);

/** Separate URL ownership before passing any values to the read-only queries. */
export function classifyCollectionDetailParams(raw: RawParams): {
  known: RawParams; unsupported: string[];
} {
  const known: RawParams = {};
  const unsupported: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (knownKeys.has(key)) known[key] = value;
    else unsupported.push(key);
  }
  return { known, unsupported };
}

/** Explicit recovery removes only unsupported keys, preserving repeated known values. */
export function clearUnsupportedCollectionParamsHref(id: string, raw: RawParams): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (!knownKeys.has(key) || value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  const suffix = params.toString();
  return `/admin/collections/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ""}`;
}

/** Keep the other query's raw URL values, including malformed and repeated values. */
export function rawUrlEntries(raw: RawParams, group: "member" | "candidate"): UrlEntry[] {
  const excluded = group === "member" ? candidateKeys : memberKeys;
  return Object.entries(raw).flatMap(([key, value]) => {
    if (excluded.has(key) || value === undefined) return [];
    return (Array.isArray(value) ? value : [value]).map((item) => [key, item] as const);
  });
}

export function parseCollectionMemberQuery(raw: RawParams): AdminCollectionMemberQuery {
  if (Object.keys(raw).some((key) => !["cursor", "direction"].includes(key) && !candidateKeys.has(key)) ||
    Array.isArray(raw.cursor) || Array.isArray(raw.direction)) throw new CatalogReadError("INVALID_INPUT");
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

export function collectionMemberHref(id: string, cursor: string | null,
  direction: "after" | "before" = "after",
  candidateParams?: Readonly<Record<string, string>> | readonly UrlEntry[]): string {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("cursor", cursor);
    if (direction === "before") params.set("direction", direction);
  }
  const entries: readonly UrlEntry[] = Array.isArray(candidateParams)
    ? candidateParams : Object.entries(candidateParams ?? {});
  for (const [key, value] of entries) {
    if (!memberKeys.has(key)) params.append(key, value);
  }
  const suffix = params.toString();
  return `/admin/collections/${encodeURIComponent(id)}${suffix ? `?${suffix}` : ""}`;
}
