import { ADMIN_UUID, ADMIN_CURSOR_V2_MAX_LENGTH } from "../catalog-read/admin-cursor.ts";
import { CatalogReadError } from "../catalog-read/errors.ts";
import type { CatalogReadRepository } from "../catalog-read/repository-core.ts";
import type { AdminCollectionMemberQuery, CatalogStatus } from "../catalog-read/types.ts";
import type { UrlEntry } from "./collection-detail-query.ts";

type RawParams = Record<string, string | string[] | undefined>;
export type CandidateQuery = Readonly<{
  search: string; status: CatalogStatus | "all"; cursor: string | null;
  direction: "after" | "before";
}>;
export type CandidateRow = Readonly<{
  productId: string; productCode: string; displayName: string | null;
  status: CatalogStatus;
}>;
export type CandidateResult = Readonly<{
  state: "RESULTS" | "EMPTY" | "EMPTY_PAGE" | "NOT_CONNECTED" | "ERROR" |
    "INCOMPLETE" | "INVALID_QUERY" | "INVALID_CURSOR";
  items: readonly CandidateRow[]; nextCursor: string | null; previousCursor: string | null;
}>;
const empty = (state: CandidateResult["state"]): CandidateResult =>
  ({ state, items: [], nextCursor: null, previousCursor: null });
const candidateKeys = new Set(["candidate_q", "candidate_status", "candidate_cursor", "candidate_direction"]);
const memberKeys = new Set(["cursor", "direction"]);

/** Query errors win over cursor errors when both are present. */
export function candidateQueryError(raw: RawParams): "INVALID_QUERY" | "INVALID_CURSOR" | null {
  if (Object.keys(raw).some((key) => !candidateKeys.has(key) && !memberKeys.has(key)) ||
    Array.isArray(raw.candidate_q) || Array.isArray(raw.candidate_status)) return "INVALID_QUERY";
  const searchInput = raw.candidate_q ?? "";
  const search = typeof searchInput === "string" ? searchInput.trim() : "";
  const status = raw.candidate_status ?? "all";
  const cursor = raw.candidate_cursor ?? null;
  const direction = raw.candidate_direction ?? "after";
  if (typeof search !== "string" || search.length > 100 || /[\x00-\x1f\x7f]/.test(search) ||
    typeof status !== "string" || !["all", "draft", "published", "retired"].includes(status))
    return "INVALID_QUERY";
  if (Array.isArray(raw.candidate_cursor) || Array.isArray(raw.candidate_direction) ||
    typeof direction !== "string" || !["after", "before"].includes(direction) ||
    cursor !== null && (typeof cursor !== "string" || cursor.length > ADMIN_CURSOR_V2_MAX_LENGTH ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)) ||
    cursor === null && direction !== "after") return "INVALID_CURSOR";
  return null;
}

export function parseCandidateQuery(raw: RawParams): CandidateQuery {
  if (candidateQueryError(raw)) throw new CatalogReadError("INVALID_INPUT");
  const search = ((raw.candidate_q as string | undefined) ?? "").trim();
  const status = raw.candidate_status ?? "all";
  const cursor = (raw.candidate_cursor as string | undefined) ?? null;
  const direction = raw.candidate_direction ?? "after";
  return { search, status: status as CandidateQuery["status"], cursor,
    direction: direction as CandidateQuery["direction"] };
}

export function candidateQueryParams(query: CandidateQuery): Record<string, string> {
  const params: Record<string, string> = {};
  if (query.search) params.candidate_q = query.search;
  if (query.status !== "all") params.candidate_status = query.status;
  if (query.cursor) {
    params.candidate_cursor = query.cursor;
    if (query.direction === "before") params.candidate_direction = "before";
  }
  return params;
}

export function candidateHref(collectionId: string, members: AdminCollectionMemberQuery,
  query: CandidateQuery, memberUrlEntries?: readonly UrlEntry[]): string {
  const params = new URLSearchParams(candidateQueryParams(query));
  if (memberUrlEntries) {
    for (const [key, value] of memberUrlEntries) {
      if (!candidateKeys.has(key)) params.append(key, value);
    }
  } else if (members.cursor) {
    params.set("cursor", members.cursor);
    if (members.direction === "before") params.set("direction", "before");
  }
  const suffix = params.toString();
  return `/admin/collections/${encodeURIComponent(collectionId)}${suffix ? `?${suffix}` : ""}`;
}

/** Uses only the authorized list DTO. A page cannot prove global catalog or membership facts. */
export async function loadCandidateProducts(repository: Pick<CatalogReadRepository, "listAdminProducts">,
  query: CandidateQuery): Promise<CandidateResult> {
  try {
    const page = await repository.listAdminProducts({
      limit: 20, sort: "product_code_asc", search: query.search || undefined,
      status: query.status === "all" ? undefined : query.status,
      cursor: query.cursor ?? undefined, direction: query.direction,
    });
    if (page.items.length > 20 || page.items.length === 0 && page.nextCursor ||
      page.items.length === 0 && page.previousCursor) return empty("INCOMPLETE");
    const ids = new Set<string>();
    const items: CandidateRow[] = [];
    for (const item of page.items) {
      if (!ADMIN_UUID.test(item.id) || typeof item.productCode !== "string" ||
        !["draft", "published", "retired"].includes(item.status) ||
        !item.name || !["available", "unavailable"].includes(item.name.state))
        return empty("INCOMPLETE");
      const id = item.id.toLowerCase();
      if (ids.has(id)) return empty("INCOMPLETE");
      ids.add(id);
      if (item.name.state === "available" && typeof item.name.value !== "string")
        return empty("INCOMPLETE");
      items.push({ productId: id, productCode: item.productCode,
        displayName: item.name.state === "available" ? item.name.value : null,
        status: item.status });
    }
    return { state: items.length ? "RESULTS" : query.cursor ? "EMPTY_PAGE" : "EMPTY",
      items, nextCursor: page.nextCursor, previousCursor: page.previousCursor ?? null };
  } catch (error) {
    if (error instanceof CatalogReadError) {
      if (error.code === "FORBIDDEN") throw error;
      if (error.code === "NOT_CONFIGURED") return empty("NOT_CONNECTED");
      if (error.code === "INVALID_INPUT") return empty("INVALID_CURSOR");
      if (error.code === "INTERNAL_ERROR") return empty("INCOMPLETE");
    }
    return empty("ERROR");
  }
}

export function invalidCandidateResult(raw: RawParams): CandidateResult {
  return empty(candidateQueryError(raw) ?? "INVALID_QUERY");
}
