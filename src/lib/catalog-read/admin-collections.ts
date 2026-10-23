import { CatalogReadError } from "./errors.ts";
import { COLLECTION_UUID, type CollectionBoundary, type CollectionCursorCodec,
  type CollectionCursorContext } from "./collections-cursor.ts";
import type { AdminCollectionDetail, AdminCollectionIssue, AdminCollectionListQuery,
  AdminCollectionMember, AdminCollectionMemberListResult, AdminCollectionMemberQuery,
  AdminCollectionOrigin, AdminCollectionSourceRow, AdminCollectionListResult,
  AdminCollectionSummary, AdminCollectionDetailResult, AdminCollectionMemberSourceRow,
  CatalogReadSource, CollectionSourcePage, CollectionSourceQuery } from "./types.ts";

export const DEFAULT_COLLECTION_PAGE_SIZE = 25;
export const MAX_COLLECTION_PAGE_SIZE = 50;
const INT32 = (value: unknown): value is number => typeof value === "number" &&
  Number.isInteger(value) && value >= -2147483648 && value <= 2147483647;
const STATUS = new Set(["draft", "published", "retired"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const timestamp = (value: unknown): value is string =>
  typeof value === "string" && UTC.test(value) && Number.isFinite(Date.parse(value));
const createdTimestamp = (value: unknown): value is string =>
  timestamp(value) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const compareBoundary = (a: CollectionBoundary, b: CollectionBoundary) =>
  a.sortOrder - b.sortOrder || compare(a.id.toLowerCase(), b.id.toLowerCase());
const invalid = (): never => { throw new CatalogReadError("INVALID_INPUT"); };
const issue = (code: AdminCollectionIssue["code"], id: string | null = null): AdminCollectionIssue =>
  ({ code, id });
const originFor = (source: CatalogReadSource): AdminCollectionOrigin =>
  source.mode === "offline" ? "OFFLINE_FIXTURE" : "READ_ONLY_DATABASE";

function normalize(raw: AdminCollectionListQuery | AdminCollectionMemberQuery, members: boolean,
  codec: CollectionCursorCodec | null, collectionId: string | null):
  { query: CollectionSourceQuery; context: CollectionCursorContext; cursorUsed: boolean } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  if (Object.keys(raw).some((key) => !["limit", "cursor", "direction", ...(members ? [] : ["status"])].includes(key)))
    return invalid();
  if (raw.limit !== undefined && (!Number.isSafeInteger(raw.limit) || raw.limit < 1 ||
    raw.limit > MAX_COLLECTION_PAGE_SIZE)) return invalid();
  if (raw.direction !== undefined && raw.direction !== "after" && raw.direction !== "before")
    return invalid();
  if (raw.cursor !== undefined && (typeof raw.cursor !== "string" || raw.cursor.length === 0))
    return invalid();
  const status = members ? null : (raw as AdminCollectionListQuery).status ?? null;
  if (status !== null && !STATUS.has(status)) return invalid();
  if (members && (!collectionId || !COLLECTION_UUID.test(collectionId))) return invalid();
  const direction = raw.direction ?? "after";
  if (direction === "before" && !raw.cursor) return invalid();
  const context: CollectionCursorContext = { kind: members ? "members" : "collections",
    status, collectionId, direction };
  if (raw.cursor && !codec) throw new CatalogReadError("NOT_CONFIGURED");
  const reference = raw.cursor ? codec!.verify(raw.cursor, context) : null;
  const boundary = reference ? { sortOrder: reference.sortOrder, id: reference.id } : null;
  return { query: { limit: raw.limit ?? DEFAULT_COLLECTION_PAGE_SIZE, direction, boundary,
    includeBoundary: reference?.includeBoundary ?? false,
    ...(status ? { status } : {}), ...(collectionId ? { collectionId } : {}) },
  context, cursorUsed: !!raw.cursor };
}

function safeCollection(row: AdminCollectionSourceRow): AdminCollectionDetail | null {
  if (!row || typeof row.id !== "string" || !COLLECTION_UUID.test(row.id) ||
    typeof row.slug !== "string" || row.slug.length > 200 || !SLUG.test(row.slug) ||
    ![row.name_en, row.name_zh, row.description_en, row.description_zh]
      .every((value) => typeof value === "string") || !STATUS.has(row.status) ||
    !INT32(row.sort_order) || !createdTimestamp(row.created_at) || !timestamp(row.updated_at) ||
    row.published_at !== null && !timestamp(row.published_at) ||
    row.status === "published" && (row.published_at === null ||
      !row.name_en.trim() || !row.name_zh.trim())) return null;
  return { id: row.id, slug: row.slug, nameEn: row.name_en, nameZh: row.name_zh,
    descriptionEn: row.description_en, descriptionZh: row.description_zh,
    status: row.status, sortOrder: row.sort_order,
    publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at };
}

function safeMember(row: AdminCollectionMemberSourceRow): AdminCollectionMember | null {
  if (!row || typeof row.collection_id !== "string" || !COLLECTION_UUID.test(row.collection_id) ||
    typeof row.product_id !== "string" || !COLLECTION_UUID.test(row.product_id) ||
    !INT32(row.sort_order) || row.product_code !== null &&
      (typeof row.product_code !== "string" || !row.product_code || row.product_code.length > 32768) ||
    row.name_en !== null && typeof row.name_en !== "string" ||
    row.name_zh !== null && typeof row.name_zh !== "string" ||
    row.product_status !== null && !STATUS.has(row.product_status)) return null;
  return { productId: row.product_id, productCode: row.product_code,
    nameEn: row.name_en, nameZh: row.name_zh, productStatus: row.product_status,
    sortOrder: row.sort_order };
}

type PageItem = Readonly<{ sortOrder: number; id: string }>;
function windowIssues<R>(result: CollectionSourcePage<R>, query: CollectionSourceQuery): AdminCollectionIssue[] {
  const window = result.window;
  if (!window || typeof window !== "object" ||
    !Number.isSafeInteger(window.requestedRowCount) ||
    !Number.isSafeInteger(window.returnedRowCount) || typeof window.exhausted !== "boolean")
    return [issue("MISSING_WINDOW_EVIDENCE")];
  if (window.requestedRowCount !== query.limit + 1 ||
    window.returnedRowCount !== result.rows.length ||
    window.exhausted !== (result.rows.length < query.limit + 1))
    return [issue("WINDOW_MISMATCH")];
  return [];
}
function inspectPage<R, T extends PageItem>(result: CollectionSourcePage<R>,
  query: CollectionSourceQuery, context: CollectionCursorContext, cursorUsed: boolean,
  codec: CollectionCursorCodec | null, map: (row: R) => T | null,
  rowId: (row: R) => string | null, extra: (row: R) => AdminCollectionIssue | null) {
  const issues: AdminCollectionIssue[] = [];
  if (!result || !Array.isArray(result.rows))
    throw new CatalogReadError("SOURCE_UNAVAILABLE");
  issues.push(...windowIssues(result, query));
  if (query.boundary) {
    const current = result.boundary;
    if (!current || !INT32(current.sortOrder) || typeof current.id !== "string" ||
      !COLLECTION_UUID.test(current.id) ||
      current.id.toLowerCase() !== query.boundary.id.toLowerCase() ||
      current.sortOrder !== query.boundary.sortOrder)
      issues.push(issue("STALE_CURSOR", query.boundary.id));
  } else if (result.boundary !== null) {
    issues.push(issue("BOUNDARY_MISMATCH"));
  }
  if (result.rows.length > query.limit + 1) issues.push(issue("OVER_LIMIT"));
  const mapped: T[] = [];
  const seen = new Set<string>();
  for (const row of result.rows.slice(0, query.limit + 1)) {
    const id = rowId(row);
    const item = map(row);
    if (!item) { issues.push(issue("INVALID_ROW", id)); continue; }
    const key = item.id.toLowerCase();
    if (seen.has(key)) issues.push(issue("DUPLICATE_ID", item.id));
    seen.add(key);
    if (mapped.length > 0 && compareBoundary(mapped[mapped.length - 1], item) >= 0)
      issues.push(issue("UNSORTED", item.id));
    if (query.boundary && (query.direction === "after"
      ? compareBoundary(item, query.boundary) < (query.includeBoundary ? 0 : 1)
      : compareBoundary(item, query.boundary) > (query.includeBoundary ? 0 : -1)))
      issues.push(issue("BOUNDARY_MISMATCH", item.id));
    const problem = extra(row);
    if (problem) issues.push(problem);
    mapped.push(item);
  }
  if (query.includeBoundary && query.boundary &&
    !mapped.some((item) => item.id.toLowerCase() === query.boundary!.id.toLowerCase()))
    issues.push(issue("NAVIGATION_UNAVAILABLE", query.boundary.id));
  const items = query.direction === "before" ? mapped.slice(-query.limit) : mapped.slice(0, query.limit);
  if (issues.length) return { items, issues, nextCursor: null, previousCursor: null,
    state: "INCOMPLETE" as const };
  if (!items.length) {
    if (!cursorUsed) return { items, issues, nextCursor: null, previousCursor: null,
      state: "COMPLETE" as const };
    if (!query.boundary || !codec || query.includeBoundary)
      return { items, issues: [issue("NAVIGATION_UNAVAILABLE")], nextCursor: null,
        previousCursor: null, state: "INCOMPLETE" as const };
    const recovery = codec.issue({ ...context,
      direction: query.direction === "after" ? "before" : "after" }, query.boundary, true);
    return { items, issues, nextCursor: query.direction === "before" ? recovery : null,
      previousCursor: query.direction === "after" ? recovery : null,
      state: "EMPTY_PAGE" as const };
  }
  const probe = mapped.length > query.limit;
  const next = query.direction === "after" ? probe : cursorUsed && !query.includeBoundary;
  const previous = query.direction === "before" ? probe : cursorUsed && !query.includeBoundary;
  if ((next || previous) && !codec) throw new CatalogReadError("NOT_CONFIGURED");
  return { items, issues,
    nextCursor: next ? codec!.issue({ ...context, direction: "after" }, items[items.length - 1]) : null,
    previousCursor: previous ? codec!.issue({ ...context, direction: "before" }, items[0]) : null,
    state: "COMPLETE" as const };
}

export function createAdminCollectionsReader(source: CatalogReadSource, authorize: () => Promise<void>,
  codec: CollectionCursorCodec | null) {
  const noList = (state: "NOT_CONNECTED" | "ERROR"): AdminCollectionListResult =>
    ({ state, items: [], issues: [], nextCursor: null, previousCursor: null, origin: "NONE" });
  const noMembers = (state: "NOT_CONNECTED" | "ERROR" | "NOT_FOUND"): AdminCollectionMemberListResult =>
    ({ state, items: [], issues: [], nextCursor: null, previousCursor: null, origin: "NONE" });
  const noDetail = (state: "NOT_CONNECTED" | "ERROR" | "NOT_FOUND"): AdminCollectionDetailResult =>
    ({ state, item: null, issues: [], origin: "NONE" });
  return {
    async listAdminCollections(raw: AdminCollectionListQuery = {}): Promise<AdminCollectionListResult> {
      await authorize();
      const { query, context, cursorUsed } = normalize(raw, false, codec, null);
      if (source.mode === "not_configured" || !source.listAdminCollections) return noList("NOT_CONNECTED");
      let result;
      try { result = await source.listAdminCollections(query); }
      catch { return noList("ERROR"); }
      let page;
      try {
        page = inspectPage(result, query, context, cursorUsed, codec,
          (row) => { const detail = safeCollection(row);
            if (!detail) return null;
            const summary: AdminCollectionSummary = { id: detail.id, slug: detail.slug,
              nameEn: detail.nameEn, nameZh: detail.nameZh, status: detail.status,
              sortOrder: detail.sortOrder, publishedAt: detail.publishedAt,
              updatedAt: detail.updatedAt };
            return summary; },
          (row) => typeof row?.id === "string" && COLLECTION_UUID.test(row.id) ? row.id : null,
          (row) => query.status && row?.status !== query.status ? issue("INVALID_ROW", row?.id ?? null) : null);
      } catch { return noList("ERROR"); }
      return { ...page, origin: originFor(source) };
    },
    async getAdminCollectionById(id: string): Promise<AdminCollectionDetailResult> {
      await authorize();
      if (typeof id !== "string" || !COLLECTION_UUID.test(id)) return invalid();
      if (source.mode === "not_configured" || !source.getAdminCollectionById)
        return noDetail("NOT_CONNECTED");
      let result;
      try { result = await source.getAdminCollectionById(id); }
      catch { return noDetail("ERROR"); }
      if (!result || typeof result.complete !== "boolean" ||
        result.row !== null && typeof result.row !== "object") return noDetail("ERROR");
      if (!result.complete) return { state: "INCOMPLETE", item: null,
        issues: [issue("SOURCE_INCOMPLETE", id)], origin: originFor(source) };
      if (!result.row) return noDetail("NOT_FOUND");
      const item = safeCollection(result.row);
      if (!item || item.id.toLowerCase() !== id.toLowerCase())
        return { state: "INCOMPLETE", item: null,
          issues: [issue(item ? "ID_MISMATCH" : "INVALID_ROW", id)], origin: originFor(source) };
      return { state: "COMPLETE", item, issues: [], origin: originFor(source) };
    },
    async listAdminCollectionMembers(id: string, raw: AdminCollectionMemberQuery = {}):
      Promise<AdminCollectionMemberListResult> {
      await authorize();
      if (typeof id !== "string" || !COLLECTION_UUID.test(id)) return invalid();
      const { query, context, cursorUsed } = normalize(raw, true, codec, id.toLowerCase());
      if (source.mode === "not_configured" || !source.listAdminCollectionMembers)
        return noMembers("NOT_CONNECTED");
      let result;
      try { result = await source.listAdminCollectionMembers(query); }
      catch { return noMembers("ERROR"); }
      if (!result || typeof result.collectionExists !== "boolean") return noMembers("ERROR");
      if (!result.collectionExists) {
        if (!Array.isArray(result.rows) || result.rows.length !== 0)
          return noMembers("ERROR");
        const issues = windowIssues(result, query);
        if (issues.length) return { ...noMembers("ERROR"), state: "INCOMPLETE",
          issues, origin: originFor(source) };
        return noMembers("NOT_FOUND");
      }
      let page;
      try {
        page = inspectPage(result, query, context, cursorUsed, codec,
          (row) => { const member = safeMember(row);
            return member ? { ...member, id: member.productId } : null; },
          (row) => typeof row?.product_id === "string" && COLLECTION_UUID.test(row.product_id)
            ? row.product_id : null,
          (row) => row?.collection_id?.toLowerCase() !== id.toLowerCase()
            ? issue("ID_MISMATCH", row?.product_id ?? null)
            : row.product_code === null || row.product_status === null
              ? issue("MISSING_PRODUCT", row.product_id) : null);
      } catch { return noMembers("ERROR"); }
      const items: AdminCollectionMember[] = page.items.map((entry) => ({
        productId: entry.productId, productCode: entry.productCode, nameEn: entry.nameEn,
        nameZh: entry.nameZh, productStatus: entry.productStatus, sortOrder: entry.sortOrder,
      }));
      return { ...page, items, origin: originFor(source) };
    },
  };
}
