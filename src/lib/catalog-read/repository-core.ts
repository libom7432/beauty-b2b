import { requireCatalogPermission, type CatalogAuthDependencies } from "../catalog-import/admin-auth.ts";
import { CatalogReadError } from "./errors.ts";
import { toAdminDetail, toAdminList, toPublic } from "./mapping.ts";
import type { AdminProductDetailDTO, AdminProductListDTO, PrivateCatalogBundle, PublicCatalogBundle,
  CatalogListQuery, CatalogPage, CatalogReadSource, CatalogScope, CatalogSort, PublicProductDTO,
  SourcePage, SourceQuery } from "./types.ts";

export const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
type Cursor = { v: 1; scope: CatalogScope; sort: CatalogSort; filter: string;
  id: string; featured: boolean; timestamp: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const failInput = (): never => { throw new CatalogReadError("INVALID_INPUT"); };
const fingerprint = (query: SourceQuery) => JSON.stringify([query.productType ?? null, query.categoryId ?? null, query.status ?? null]);
export function decodeCursor(value: string, scope: CatalogScope, query: SourceQuery): Cursor {
  if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value)) return failInput();
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); }
  catch { return failInput(); }
  if (!decoded || typeof decoded !== "object") return failInput();
  const cursor = decoded as Partial<Cursor>;
  if (cursor.v !== 1 || cursor.scope !== scope || cursor.sort !== query.sort ||
    cursor.filter !== fingerprint(query) || typeof cursor.id !== "string" || !UUID.test(cursor.id) ||
    typeof cursor.featured !== "boolean" || typeof cursor.timestamp !== "string" ||
    !Number.isFinite(Date.parse(cursor.timestamp))) return failInput();
  return cursor as Cursor;
}
export function encodeCursor(bundle: PrivateCatalogBundle | PublicCatalogBundle, scope: CatalogScope, query: SourceQuery): string {
  const timestamp = scope === "admin" && "updated_at" in bundle.product ? bundle.product.updated_at : bundle.product.published_at;
  if (!timestamp || !Number.isFinite(Date.parse(timestamp))) throw new CatalogReadError("INTERNAL_ERROR");
  const cursor: Cursor = { v: 1, scope, sort: query.sort, filter: fingerprint(query), id: bundle.product.id,
    featured: bundle.product.featured, timestamp };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}
function normalizedQuery(scope: CatalogScope, raw: CatalogListQuery): SourceQuery {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return failInput();
  if (Object.keys(raw).some((key) => !["limit", "cursor", "sort", "productType", "categoryId", "status"].includes(key))) return failInput();
  if (raw.limit !== undefined && (!Number.isSafeInteger(raw.limit) || raw.limit < 1 || raw.limit > MAX_PAGE_SIZE)) return failInput();
  const sort = raw.sort ?? (scope === "admin" ? "updated" : "featured");
  if (scope === "admin" ? sort !== "updated" : sort !== "featured" && sort !== "newest") return failInput();
  if (raw.productType !== undefined && (!codePattern.test(raw.productType))) return failInput();
  if (raw.categoryId !== undefined && !UUID.test(raw.categoryId)) return failInput();
  if (scope === "public" && raw.status !== undefined && raw.status !== "published") return failInput();
  if (raw.status !== undefined && !["draft", "published", "retired"].includes(raw.status)) return failInput();
  if (raw.cursor !== undefined && typeof raw.cursor !== "string") return failInput();
  const query: SourceQuery = { limit: raw.limit ?? DEFAULT_PAGE_SIZE, cursor: raw.cursor ?? null, sort,
    productType: raw.productType, categoryId: raw.categoryId, status: raw.status };
  if (query.cursor) decodeCursor(query.cursor, scope, query);
  return query;
}
async function safeSource<T>(task: () => Promise<T>): Promise<T> {
  try { return await task(); }
  catch (error) {
    if (error instanceof CatalogReadError) throw error;
    throw new CatalogReadError("SOURCE_UNAVAILABLE");
  }
}
export interface CatalogReadRepository {
  listPublishedProducts(query?: CatalogListQuery): Promise<CatalogPage<PublicProductDTO>>;
  getPublishedProductBySlug(slug: string): Promise<PublicProductDTO>;
  listAdminProducts(query?: CatalogListQuery): Promise<CatalogPage<AdminProductListDTO>>;
  getAdminProductByCode(code: string): Promise<AdminProductDetailDTO>;
}
/** Pure core for offline tests. Production wiring must stay in a server-only module. */
export function createCatalogReadRepository(source: CatalogReadSource, admin: Readonly<{
  session: unknown; dependencies: CatalogAuthDependencies }> | null = null): CatalogReadRepository {
  const authorize = async () => {
    if (!admin) throw new CatalogReadError("FORBIDDEN");
    try { await requireCatalogPermission(admin.session, "catalog.read", admin.dependencies); }
    catch { throw new CatalogReadError("FORBIDDEN"); }
  };
  const configured = () => { if (source.mode === "not_configured") throw new CatalogReadError("NOT_CONFIGURED"); };
  const list = async <T, B extends PrivateCatalogBundle | PublicCatalogBundle>(scope: CatalogScope,
    raw: CatalogListQuery, read: (query: SourceQuery) => Promise<SourcePage<B>>,
    map: (bundle: B) => T): Promise<CatalogPage<T>> => {
    if (scope === "admin") await authorize();
    const query = normalizedQuery(scope, raw);
    configured();
    const result = await safeSource(() => read(query));
    if (result.rows.length > query.limit || result.hasMore && result.rows.length === 0) throw new CatalogReadError("INTERNAL_ERROR");
    const items = result.rows.map(map);
    return { items, nextCursor: result.hasMore ? encodeCursor(result.rows[result.rows.length - 1], scope, query) : null };
  };
  return {
    listPublishedProducts: (query = {}) => list("public", query, (normalized) => source.listPublished(normalized), toPublic),
    async getPublishedProductBySlug(slug) {
      if (!slugPattern.test(slug) || slug.length > 200) return failInput();
      configured();
      const bundle = await safeSource(() => source.getPublishedBySlug(slug));
      if (!bundle) throw new CatalogReadError("NOT_FOUND");
      return toPublic(bundle);
    },
    listAdminProducts: (query = {}) => list("admin", query, (normalized) => source.listAdmin(normalized), toAdminList),
    async getAdminProductByCode(code) {
      await authorize();
      if (!codePattern.test(code)) return failInput();
      configured();
      const bundle = await safeSource(() => source.getAdminByCode(code));
      if (!bundle) throw new CatalogReadError("NOT_FOUND");
      return toAdminDetail(bundle);
    },
  };
}
