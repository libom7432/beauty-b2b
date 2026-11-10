import { CatalogReadError } from "../catalog-read/errors.ts";
import type { RFQPublicCatalogLookup, RFQPublicProduct } from "./types.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const unavailable = (): never => { throw new CatalogReadError("SOURCE_UNAVAILABLE"); };

// These are the complete SQL allowlist and column contract for this reader.
export const RFQ_PUBLIC_PRODUCTS_SQL = `SELECT id, slug FROM catalog_public.products
WHERE id = ANY($1::uuid[]) ORDER BY id LIMIT $2::integer`;
export const RFQ_PUBLIC_VARIANTS_SQL = `SELECT id, product_id, sku, attributes,
moq_quantity::text AS moq_quantity, moq_unit FROM catalog_public.product_variants
WHERE product_id = ANY($1::uuid[]) ORDER BY product_id, id LIMIT $2::integer`;
export const RFQ_PUBLIC_TRANSLATIONS_SQL = `SELECT product_id, locale, name
FROM catalog_public.product_translations WHERE product_id = ANY($1::uuid[])
AND locale IN ('en', 'zh') ORDER BY product_id, locale LIMIT $2::integer`;

export interface RFQPublicSelect {
  select(sql: string, values: readonly unknown[]): Promise<readonly unknown[]>;
}
export type RFQPublicReadSnapshot = <T>(work: (client: RFQPublicSelect) => Promise<T>) => Promise<T>;
export interface RFQPublicConnection {
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: unknown[] }>;
  release(destroy?: boolean): void;
}

/** Every select in one lookup uses one PostgreSQL repeatable-read snapshot. */
export function createRFQPublicReadSnapshot(connect: () => Promise<RFQPublicConnection>): RFQPublicReadSnapshot {
  return async (work) => {
    let client: RFQPublicConnection;
    try { client = await connect(); } catch { return unavailable(); }
    let begun = false;
    let destroy = false;
    try {
      await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
      begun = true;
      await client.query("SET LOCAL statement_timeout = 5000");
      const result = await work({ select: async (sql, values) => {
        if (![RFQ_PUBLIC_PRODUCTS_SQL, RFQ_PUBLIC_VARIANTS_SQL, RFQ_PUBLIC_TRANSLATIONS_SQL].includes(sql))
          return unavailable();
        return (await client.query(sql, [...values])).rows;
      } });
      await client.query("COMMIT");
      return result;
    } catch (error) {
      destroy = true;
      if (begun) try { await client.query("ROLLBACK"); } catch { /* Discard connection. */ }
      if (error instanceof CatalogReadError &&
        (error.code === "NOT_FOUND" || error.code === "INVALID_INPUT")) throw error;
      return unavailable();
    } finally { try { client.release(destroy); } catch { /* Never expose driver details. */ } }
  };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}
function rows(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) return unavailable();
  return value;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) return unavailable();
  return value.toLowerCase();
}
function attributes(value: unknown): Record<string, string | number | boolean> {
  const raw = object(value);
  const result: Record<string, string | number | boolean> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (!/^[a-z][a-z0-9_]*$/.test(key) ||
      !(typeof entry === "string" && entry.trim() || typeof entry === "boolean" ||
        typeof entry === "number" && Number.isFinite(entry))) return unavailable();
    result[key] = entry as string | number | boolean;
  }
  return result;
}
function moq(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) return unavailable();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return unavailable();
  return number;
}
function unit(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
    value.length > 64 || /[\x00-\x1f\x7f]/.test(value)) return unavailable();
  return value;
}

/** Only published view rows may enter this projection; no private or Mock fallback exists. */
export function createRFQPublicCatalogReader(snapshot: RFQPublicReadSnapshot): RFQPublicCatalogLookup {
  return { async getPublishedProductsByIds(ids) {
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 ||
      ids.some((id) => typeof id !== "string" || !uuid.test(id)) ||
      new Set(ids.map((id) => id.toLowerCase())).size !== ids.length)
      throw new CatalogReadError("INVALID_INPUT");
    try {
      return await snapshot(async (client) => {
        const requested = new Set(ids.map((id) => id.toLowerCase()));
        const products = rows(await client.select(RFQ_PUBLIC_PRODUCTS_SQL, [ids, ids.length + 1]), ids.length);
        const found = new Map<string, { id: string; slug: string }>();
        for (const raw of products) {
          const row = object(raw);
          const id = identifier(row.id);
          if (!requested.has(id) || found.has(id) || typeof row.slug !== "string" ||
            row.slug.length > 200 || !slug.test(row.slug)) return unavailable();
          found.set(id, { id: row.id as string, slug: row.slug });
        }
        if (found.size !== requested.size) throw new CatalogReadError("NOT_FOUND");
        const variants = rows(await client.select(RFQ_PUBLIC_VARIANTS_SQL, [ids, 2001]), 2000);
        const byProduct = new Map<string, RFQPublicProduct["variants"][number][]>();
        const seenVariants = new Set<string>();
        const seenSkus = new Set<string>();
        for (const raw of variants) {
          const row = object(raw);
          const productId = identifier(row.product_id);
          const id = identifier(row.id);
          if (!requested.has(productId) || !found.has(productId) || seenVariants.has(id) ||
            typeof row.sku !== "string" || !row.sku.trim() || row.sku !== row.sku.trim() ||
            seenSkus.has(row.sku)) return unavailable();
          seenVariants.add(id); seenSkus.add(row.sku);
          const entry = { id: row.id as string, sku: row.sku,
            attributes: attributes(row.attributes), moq: { quantity: moq(row.moq_quantity), unit: unit(row.moq_unit) } };
          byProduct.set(productId, [...(byProduct.get(productId) ?? []), entry]);
        }
        const translations = rows(await client.select(RFQ_PUBLIC_TRANSLATIONS_SQL, [ids, ids.length * 2 + 1]), ids.length * 2);
        const names = new Map<string, { en?: string; zh?: string }>();
        for (const raw of translations) {
          const row = object(raw);
          const productId = identifier(row.product_id);
          if (!requested.has(productId) || !found.has(productId) ||
            (row.locale !== "en" && row.locale !== "zh") || typeof row.name !== "string" ||
            !row.name.trim()) return unavailable();
          const existing = names.get(productId) ?? {};
          if (existing[row.locale] !== undefined) return unavailable();
          existing[row.locale] = row.name;
          names.set(productId, existing);
        }
        return ids.map((requestedId): RFQPublicProduct => {
          const id = requestedId.toLowerCase();
          const product = found.get(id)!;
          const translation = names.get(id);
          const productVariants = byProduct.get(id);
          if (!translation?.en || !translation.zh || !productVariants?.length) return unavailable();
          return { id: product.id, slug: product.slug,
            translations: { en: { state: "available", value: { name: translation.en } },
              zh: { state: "available", value: { name: translation.zh } } },
            variants: productVariants };
        });
      });
    } catch (error) {
      if (error instanceof CatalogReadError && (error.code === "INVALID_INPUT" || error.code === "NOT_FOUND"))
        throw error;
      throw new CatalogReadError("SOURCE_UNAVAILABLE");
    }
  } };
}

export type RFQPublicCatalogConfig = Readonly<{ projectRef: string; mode: "direct" | "session" | "transaction";
  host: string; port: number; database: "postgres"; user: string; password: string; ca: string; poolMax: number }>;
const role = "rfq_catalog_public_reader_runtime";
const poolerHost = /^aws-[0-9]+-[a-z0-9-]+\.pooler\.supabase\.com$/;

/** Pure configuration validation; it does not connect or establish effective database privileges. */
export function requireRFQPublicCatalogConfig(env: Readonly<Record<string, string | undefined>>): RFQPublicCatalogConfig {
  const projectRef = env.RFQ_CATALOG_PUBLIC_PROJECT_REF ?? "";
  const mode = env.RFQ_CATALOG_PUBLIC_MODE ?? "";
  const host = env.RFQ_CATALOG_PUBLIC_HOST ?? "";
  const port = Number(env.RFQ_CATALOG_PUBLIC_PORT);
  const database = env.RFQ_CATALOG_PUBLIC_DATABASE ?? "";
  const user = env.RFQ_CATALOG_PUBLIC_USER ?? "";
  const password = env.RFQ_CATALOG_PUBLIC_PASSWORD ?? "";
  const ca = env.RFQ_CATALOG_PUBLIC_CA_PEM ?? "";
  if (!/^[a-z0-9]{20}$/.test(projectRef) || !["direct", "session", "transaction"].includes(mode) ||
    !Number.isSafeInteger(port) || database !== "postgres" || password.length < 32 ||
    password.length > 512 || /[\r\n\0]/.test(password) || ca.length > 32768 ||
    !ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----"))
    throw new CatalogReadError("NOT_CONFIGURED");
  if (mode === "direct" ? host !== `db.${projectRef}.supabase.co` || port !== 5432 || user !== role :
    !poolerHost.test(host) || port !== (mode === "session" ? 5432 : 6543) || user !== `${role}.${projectRef}`)
    throw new CatalogReadError("NOT_CONFIGURED");
  return { projectRef, mode: mode as RFQPublicCatalogConfig["mode"], host, port,
    database: "postgres", user, password, ca, poolMax: mode === "transaction" ? 1 : 2 };
}
