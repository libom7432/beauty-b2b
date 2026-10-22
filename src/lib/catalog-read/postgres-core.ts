import { CatalogReadError } from "./errors.ts";
import { decodeCursor } from "./repository-core.ts";
import { adminBoundaryWitness, type AdminCursorBoundary } from "./admin-cursor.ts";
import { PUBLIC_CATALOG_PROJECTION } from "./types.ts";
import { MAX_ADMIN_CATEGORIES } from "./admin-categories.ts";
import type { AdminCategorySourceRow, CatalogReadSource, CatalogSort, PrivateCatalogBundle, ProductRow,
  PublicCatalogBundle, PublicProductViewRow, SourcePage, SourceQuery } from "./types.ts";

/** Pure query boundary for offline tests. Credentials and pg live in postgres-local.ts only. */
export interface CatalogSelectClient {
  select<T>(sql: string, values: readonly unknown[]): Promise<readonly T[]>;
}
export type ReadSnapshot = <T>(work: (client: CatalogSelectClient) => Promise<T>) => Promise<T>;

const utc = (column: string) => `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const privateProduct = `p.id, p.product_code, p.slug, p.product_type, p.status, p.attributes,
  p.customization_options, p.oem, p.odm, p.lead_time_min_days, p.lead_time_max_days,
  p.seo_indexable, p.featured, p.new_arrival, ${utc("p.published_at")} AS published_at,
  ${utc("p.created_at")} AS created_at, ${utc("p.updated_at")} AS updated_at`;
const publicProduct = `p.id, p.product_code, p.slug, p.product_type, p.attributes,
  p.customization_options, p.oem, p.odm, p.lead_time_min_days, p.lead_time_max_days,
  p.seo_indexable, p.featured, p.new_arrival, ${utc("p.published_at")} AS published_at`;
const privateVariant = `v.id, v.product_id, v.sku, v.status, v.attributes,
  v.moq_quantity::text AS moq_quantity, v.moq_unit,
  v.order_multiple::text AS order_multiple, v.package_quantity::text AS package_quantity,
  v.package_unit, v.reference_price::text AS reference_price, v.reference_currency, v.sort_order,
  ${utc("v.created_at")} AS created_at, ${utc("v.updated_at")} AS updated_at`;
const publicVariant = `v.id, v.product_id, v.sku, v.attributes,
  v.moq_quantity::text AS moq_quantity, v.moq_unit,
  v.order_multiple::text AS order_multiple, v.package_quantity::text AS package_quantity,
  v.package_unit, v.reference_price::text AS reference_price, v.reference_currency, v.sort_order`;
const privateTranslation = `t.product_id, t.locale, t.name, t.short_description, t.description,
  t.seo_title, t.seo_description, ${utc("t.created_at")} AS created_at,
  ${utc("t.updated_at")} AS updated_at`;
const publicTranslation = `t.product_id, t.locale, t.name, t.short_description, t.description,
  t.seo_title, t.seo_description`;
const privateImage = `i.id, i.product_id, i.variant_id, i.storage_key, i.public_url, i.role,
  i.status, i.sort_order, i.width, i.height, i.format, i.alt_en, i.alt_zh,
  ${utc("i.created_at")} AS created_at, ${utc("i.updated_at")} AS updated_at`;
const publicImage = `i.id, i.product_id, i.variant_id, i.public_url, i.role,
  i.sort_order, i.width, i.height, i.format, i.alt_en, i.alt_zh`;
const privateLink = `l.product_id, l.category_id, l.is_primary, l.sort_order,
  ${utc("l.created_at")} AS created_at, ${utc("l.updated_at")} AS updated_at`;
const publicLink = `l.product_id, l.category_id, l.is_primary, l.sort_order`;
const privateCategory = `c.id, c.parent_id, c.slug, c.status, c.name_en, c.name_zh,
  c.description_en, c.description_zh, c.sort_order,
  ${utc("c.created_at")} AS created_at, ${utc("c.updated_at")} AS updated_at`;
const publicCategory = `c.id, c.parent_id, c.slug, c.name_en, c.name_zh,
  c.description_en, c.description_zh, c.sort_order`;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (character) => `\\${character}`);
const invalid = (): never => { throw new CatalogReadError("INVALID_INPUT"); };

function sortFor(scope: "admin" | "public", sort: CatalogSort) {
  if (scope === "admin") {
    if (sort === "updated" || sort === "updated_desc") return { column: "p.updated_at", type: "timestamptz", desc: true };
    if (sort === "updated_asc") return { column: "p.updated_at", type: "timestamptz", desc: false };
    if (sort === "product_code_asc") return { column: 'p.product_code COLLATE "C"', type: "text", desc: false };
    if (sort === "product_code_desc") return { column: 'p.product_code COLLATE "C"', type: "text", desc: true };
  } else {
    if (sort === "featured") return { column: "p.featured", type: "boolean", desc: true };
    if (sort === "newest") return { column: "p.published_at", type: "timestamptz", desc: true };
  }
  return invalid();
}

function candidateSql(scope: "admin" | "public", query: SourceQuery,
  resolvedAdminBoundary: AdminCursorBoundary | null = null, targetId: string | null = null) {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 50) return invalid();
  if (scope === "admin" && query.cursor && (!query.adminCursorReference || !resolvedAdminBoundary)) return invalid();
  const table = scope === "admin" ? "catalog_private" : "catalog_public";
  const sort = sortFor(scope, query.sort);
  const values: unknown[] = [];
  const bind = (value: unknown) => { values.push(value); return `$${values.length}`; };
  const where: string[] = [];
  if (targetId) where.push(`p.id = ${bind(targetId)}::uuid`);
  if (scope === "admin" && query.status) where.push(`p.status = ${bind(query.status)}`);
  if (query.productType) where.push(`p.product_type = ${bind(query.productType)}`);
  if (query.categoryId) where.push(`EXISTS (SELECT 1 FROM ${table}.product_categories l
    WHERE l.product_id = p.id AND l.category_id = ${bind(query.categoryId)}::uuid)`);
  if (query.primaryCategoryId) where.push(`EXISTS (SELECT 1 FROM catalog_private.product_categories l
    WHERE l.product_id = p.id AND l.is_primary AND l.category_id = ${bind(query.primaryCategoryId)}::uuid)`);
  if (scope === "admin" && query.search) {
    const pattern = bind(`%${escapeLike(query.search)}%`);
    where.push(`(p.product_code ILIKE ${pattern} ESCAPE '\\' OR EXISTS
      (SELECT 1 FROM catalog_private.product_translations t WHERE t.product_id = p.id
        AND t.locale IN ('en','zh') AND t.name ILIKE ${pattern} ESCAPE '\\'))`);
  }
  const adminBoundary = scope === "admin" ? resolvedAdminBoundary : null;
  const publicBoundary = scope === "public" && query.cursor
    ? decodeCursor(query.cursor, "public", query) : null;
  const boundary = adminBoundary ?? publicBoundary;
  if (boundary) {
    const value = adminBoundary ? sort.type === "text" ? adminBoundary.productCode : adminBoundary.timestamp
      : publicBoundary && sort.type === "boolean" ? publicBoundary.featured : publicBoundary?.timestamp;
    if (value === null || value === undefined) return invalid();
    const key = bind(value);
    const id = bind(boundary.id);
    const backwards = scope === "admin" && query.direction === "before";
    const primaryOp = sort.desc !== backwards ? "<" : ">";
    const idOp = backwards ? "<" : ">";
    where.push(`(${sort.column} ${primaryOp} ${key}::${sort.type} OR
      (${sort.column} = ${key}::${sort.type} AND p.id ${idOp} ${id}::uuid))`);
  }
  const backwards = scope === "admin" && query.direction === "before" && !!boundary;
  const order = sort.desc !== backwards ? "DESC" : "ASC";
  const idOrder = backwards ? "DESC" : "ASC";
  const limit = bind(query.limit + 1);
  const sql = `SELECT ${scope === "admin" ? privateProduct : publicProduct}
    FROM ${table}.products p ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY ${sort.column} ${order}, p.id ${idOrder} LIMIT ${limit}::integer`;
  return { sql, values, backwards, hasCursor: !!boundary };
}

async function hydrate(client: CatalogSelectClient, products: readonly ProductRow[] | readonly PublicProductViewRow[],
  scope: "admin" | "public") {
  if (products.length === 0) return [];
  const ids = products.map((product) => product.id);
  const table = scope === "admin" ? "catalog_private" : "catalog_public";
  const privateRows = scope === "admin";
  const bounded = async <T>(sql: string) => {
    const rows = await client.select<T>(sql, [ids]);
    if (rows.length > 5000) throw new CatalogReadError("SOURCE_UNAVAILABLE");
    return rows;
  };
  const translations = await bounded<PrivateCatalogBundle["translations"][number]>(
    `SELECT ${privateRows ? privateTranslation : publicTranslation} FROM ${table}.product_translations t
      WHERE t.product_id = ANY($1::uuid[]) ORDER BY t.product_id, t.locale LIMIT 5001`);
  const variants = await bounded<PrivateCatalogBundle["variants"][number]>(
    `SELECT ${privateRows ? privateVariant : publicVariant} FROM ${table}.product_variants v
      WHERE v.product_id = ANY($1::uuid[]) ORDER BY v.product_id, v.sort_order, v.id LIMIT 5001`);
  const links = await bounded<PrivateCatalogBundle["categoryLinks"][number]>(
    `SELECT ${privateRows ? privateLink : publicLink} FROM ${table}.product_categories l
      WHERE l.product_id = ANY($1::uuid[]) ORDER BY l.product_id, l.sort_order, l.category_id LIMIT 5001`);
  const categories = await bounded<PrivateCatalogBundle["categories"][number]>(
    `WITH RECURSIVE tree AS (
      SELECT c.id, c.parent_id, ARRAY[c.id] AS path FROM ${table}.categories c
      JOIN ${table}.product_categories l ON l.category_id = c.id
      WHERE l.product_id = ANY($1::uuid[])
      UNION ALL
      SELECT parent.id, parent.parent_id, tree.path || parent.id
      FROM ${table}.categories parent JOIN tree ON parent.id = tree.parent_id
      WHERE NOT parent.id = ANY(tree.path) AND cardinality(tree.path) < 32
    ) SELECT ${privateRows ? privateCategory : publicCategory}
      FROM ${table}.categories c WHERE c.id IN (SELECT id FROM tree) ORDER BY c.id LIMIT 5001`);
  const images = await bounded<PrivateCatalogBundle["images"][number]>(
    `SELECT ${privateRows ? privateImage : publicImage} FROM ${table}.product_images i
      WHERE i.product_id = ANY($1::uuid[]) ORDER BY i.product_id, i.sort_order, i.id LIMIT 5001`);
  return products.map((product) => ({ product,
    translations: translations.filter((row) => row.product_id === product.id),
    variants: variants.filter((row) => row.product_id === product.id),
    categoryLinks: links.filter((row) => row.product_id === product.id), categories,
    images: images.filter((row) => row.product_id === product.id),
  }));
}

export function createPostgresCatalogReadSource(snapshot: ReadSnapshot): CatalogReadSource {
  return {
    mode: "read_only",
    async listAdminCategories() {
      return snapshot(async (client) => {
        const counts = await client.select<{ total_count: string }>(
          `SELECT count(*)::text AS total_count FROM catalog_private.categories`, []);
        if (counts.length !== 1) throw new CatalogReadError("SOURCE_UNAVAILABLE");
        const totalCount = Number(counts[0].total_count);
        if (!Number.isSafeInteger(totalCount) || totalCount < 0)
          throw new CatalogReadError("SOURCE_UNAVAILABLE");
        const rows = await client.select<AdminCategorySourceRow>(
          `SELECT c.id, c.parent_id, c.slug, c.status, c.name_en, c.name_zh,
            c.description_en, c.description_zh, c.sort_order
           FROM catalog_private.categories c
           ORDER BY c.parent_id NULLS FIRST, c.sort_order, c.id LIMIT $1::integer`,
          [MAX_ADMIN_CATEGORIES + 1]);
        return { rows, totalCount, allCategories: true };
      });
    },
    async listAdmin(query): Promise<SourcePage<PrivateCatalogBundle>> {
      return snapshot(async (client) => {
        let resolved: AdminCursorBoundary | null = null;
        if (query.adminCursorReference) {
          // Boundary lookup and page query share the read-only REPEATABLE READ snapshot.
          const lookup = candidateSql("admin", { ...query, cursor: null, limit: 1 },
            null, query.adminCursorReference.id);
          const products = await client.select<ProductRow>(lookup.sql, lookup.values);
          if (products.length !== 1 ||
            adminBoundaryWitness(products[0]) !== query.adminCursorReference.witness)
            throw new CatalogReadError("INVALID_INPUT");
          resolved = { id: products[0].id, timestamp: products[0].updated_at,
            productCode: products[0].product_code };
        }
        const statement = candidateSql("admin", query, resolved);
        const fetched = await client.select<ProductRow>(statement.sql, statement.values);
        const page = fetched.slice(0, query.limit);
        const ordered = statement.backwards ? [...page].reverse() : page;
        const rows = await hydrate(client, ordered, "admin") as PrivateCatalogBundle[];
        return { rows, hasMore: statement.backwards ? rows.length > 0 && statement.hasCursor : fetched.length > query.limit,
          hasPrevious: statement.backwards ? fetched.length > query.limit : rows.length > 0 && statement.hasCursor };
      });
    },
    async getAdminByCode(code) {
      return snapshot(async (client) => {
        const products = await client.select<ProductRow>(`SELECT ${privateProduct}
          FROM catalog_private.products p WHERE p.product_code = $1 LIMIT 1`, [code]);
        return (await hydrate(client, products, "admin") as PrivateCatalogBundle[])[0] ?? null;
      });
    },
    async getAdminById(id) {
      return snapshot(async (client) => {
        const products = await client.select<ProductRow>(`SELECT ${privateProduct}
          FROM catalog_private.products p WHERE p.id = $1::uuid LIMIT 1`, [id]);
        return (await hydrate(client, products, "admin") as PrivateCatalogBundle[])[0] ?? null;
      });
    },
    async listAdminPrimaryCategoryOptions() {
      return snapshot(async (client) => {
        const rows = await client.select<{ id: string; name_en: string; name_zh: string }>(
          `SELECT c.id, c.name_en, c.name_zh FROM catalog_private.categories c
           WHERE EXISTS (SELECT 1 FROM catalog_private.product_categories l
             WHERE l.category_id = c.id AND l.is_primary)
           ORDER BY c.name_en COLLATE "C", c.id LIMIT 51`, []);
        return { items: rows.slice(0, 50).map((row) => ({ id: row.id,
          nameEn: row.name_en, nameZh: row.name_zh })), hasMore: rows.length > 50 };
      });
    },
    async listPublished(query): Promise<SourcePage<PublicCatalogBundle>> {
      return snapshot(async (client) => {
        const statement = candidateSql("public", query);
        const fetched = await client.select<PublicProductViewRow>(statement.sql, statement.values);
        const rows = (await hydrate(client, fetched.slice(0, query.limit), "public")).map((bundle) =>
          ({ ...bundle, [PUBLIC_CATALOG_PROJECTION]: true })) as PublicCatalogBundle[];
        return { rows, hasMore: fetched.length > query.limit };
      });
    },
    async getPublishedBySlug(slug) {
      return snapshot(async (client) => {
        const products = await client.select<PublicProductViewRow>(`SELECT ${publicProduct}
          FROM catalog_public.products p WHERE p.slug = $1 LIMIT 1`, [slug]);
        const bundle = (await hydrate(client, products, "public"))[0];
        return bundle ? { ...bundle, [PUBLIC_CATALOG_PROJECTION]: true } as PublicCatalogBundle : null;
      });
    },
  };
}
