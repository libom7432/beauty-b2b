/** Local-isolated PostgreSQL catalog adapter. No public route or production connection path. */
import { randomUUID } from "node:crypto";
import pg, { type PoolClient } from "pg";
import { assertNoPreviewCatalogIds, mergeCatalogImport, type FinalCatalogProduct } from "./merge.ts";
import { captureTrustedCatalogSnapshot, type CatalogSnapshot, type CatalogSnapshotRows } from "./snapshot.ts";
import { compareCatalogSnapshotVersion } from "./dry-run.ts";
import { assertVerifiedCatalogActor, catalogImportRequestFingerprint, CatalogImportError, mapCatalogDatabaseRows,
  type CatalogImportTransaction, type CatalogSnapshotReader, type DatabaseIdentity, type DatabaseWriteResult,
  type PreviewIdentity, type TransactionalImportRequest } from "./transaction.ts";
import type { ImportParseResult } from "./csv.ts";

type Table = keyof CatalogSnapshotRows;
export type LocalCatalogPostgresConfig = Readonly<{ connection_string: string; data_directory: string; template_version: string;
  lock_timeout_ms?: number; statement_timeout_ms?: number; transaction_timeout_ms?: number }>;
const tableNames: Record<Table, string> = { products: "products", variants: "product_variants", categories: "categories",
  product_categories: "product_categories", images: "product_images", translations: "product_translations" };
const columns: Record<Table, string> = {
  products: "id,product_code,slug,product_type,status,attributes,customization_options,oem,odm,lead_time_min_days,lead_time_max_days,seo_indexable,featured,new_arrival,published_at,created_at,updated_at",
  variants: "id,product_id,sku,status,attributes,moq_quantity,moq_unit,order_multiple,package_quantity,package_unit,reference_price,reference_currency,sort_order,created_at,updated_at",
  categories: "id,parent_id,slug,status,name_en,name_zh,description_en,description_zh,sort_order,created_at,updated_at",
  product_categories: "product_id,category_id,is_primary,sort_order,created_at,updated_at",
  images: "id,product_id,variant_id,storage_key,public_url,role,status,sort_order,width,height,format,alt_en,alt_zh,created_at,updated_at",
  translations: "product_id,locale,name,short_description,description,seo_title,seo_description,created_at,updated_at",
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREVIEW = /^preview:(product|variant|image):[a-f0-9]{64}$/;
const OPAQUE_TOKEN = /^[A-Za-z0-9_-]{1,200}$/;
const CATALOG_LOCK = "725604510131";
// Pinned to the B4.5-B1 synthetic-only Postgres.app cluster. This module is not a production connector.
const VERIFIED_DATA_DIRECTORY = "/Users/mima0000/Documents/Codex/2026-10-13/sprint-2-5-a-beauty-b2b/work/catalog-postgres-b1-55439/data";
const VERIFIED_SYSTEM_IDENTIFIER = "7696341689079925702";
const verifiedClients = new WeakSet<PoolClient>();
const clientErrorListeners = new WeakMap<PoolClient, (error: Error) => void>();
function releaseClient(client: PoolClient, discard = false): void {
  verifiedClients.delete(client);
  const listener = clientErrorListeners.get(client);
  if (listener) { client.removeListener("error", listener); clientErrorListeners.delete(client); }
  try { client.release(discard ? new Error("Discard failed catalog transaction connection") : undefined); }
  catch { /* PostgreSQL transaction timeout may already have closed the socket */ }
}

/** PostgreSQL int8 is text in node-postgres by default. Convert only known int8 columns. */
export function safeCatalogBigint(value: unknown, field: string): number | null {
  if (value === null) return null;
  if ((typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) && typeof value !== "bigint" && typeof value !== "number")
    throw new CatalogImportError("INVALID_REQUEST", `Invalid database integer: ${field}`);
  const parsed = typeof value === "bigint" ? value : typeof value === "number" ? value : BigInt(value);
  if (typeof parsed === "bigint" ? parsed > BigInt(Number.MAX_SAFE_INTEGER) || parsed < BigInt(Number.MIN_SAFE_INTEGER) : !Number.isSafeInteger(parsed))
    throw new CatalogImportError("INVALID_REQUEST", `Unsafe database integer: ${field}`);
  return Number(parsed);
}
function localConfig(config: LocalCatalogPostgresConfig): void {
  if (!config || typeof config.connection_string !== "string" || typeof config.data_directory !== "string" || !config.data_directory.startsWith("/"))
    throw new CatalogImportError("INVALID_REQUEST");
  let url: URL;
  try { url = new URL(config.connection_string); } catch { throw new CatalogImportError("INVALID_REQUEST"); }
  if (url.protocol !== "postgresql:" || url.hostname !== "127.0.0.1" || url.port !== "55439"
    || url.pathname !== "/catalog_import_test" || url.username !== "catalog_test_owner" || url.password || url.search || url.hash
    || config.data_directory !== VERIFIED_DATA_DIRECTORY || !config.template_version?.trim())
    throw new CatalogImportError("INVALID_REQUEST", "Only the verified local catalog test cluster is allowed");
}
/** Verifies the server itself; caller-supplied connection strings and data-directory strings are insufficient. */
export async function verifyLocalCatalogTestConnection(client: Pick<PoolClient, "query">): Promise<void> {
  const row = (await client.query(`SELECT current_database() db, session_user username, host(inet_server_addr()) host,
    inet_server_port() port, current_setting('data_directory') data_dir, current_setting('listen_addresses') listens,
    (SELECT system_identifier::text FROM pg_control_system()) system_id,
    to_regnamespace('rfq_private') rfq_schema`)).rows[0];
  if (!row || row.db !== "catalog_import_test" || row.username !== "catalog_test_owner" || row.host !== "127.0.0.1"
    || row.port !== 55439 || row.listens !== "127.0.0.1" || row.data_dir !== VERIFIED_DATA_DIRECTORY
    || row.system_id !== VERIFIED_SYSTEM_IDENTIFIER || row.rfq_schema !== null)
    throw new CatalogImportError("PERMISSION_DENIED", "Local catalog database identity mismatch");
}
function ms(value: number | undefined, fallback: number): number {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < 1 || result > 30000) throw new CatalogImportError("INVALID_REQUEST");
  return result;
}
function dbError(error: unknown): CatalogImportError {
  if (error instanceof CatalogImportError) return error;
  const code = (error as { code?: string })?.code;
  if (["55P03", "40P01", "40001", "57014", "25P03", "25P04", "57P01"].includes(code ?? "")) return new CatalogImportError("TRANSACTION_TIMEOUT");
  if (code === "23505" || code === "23503" || code === "23514" || code === "P0001") return new CatalogImportError("BATCH_INVALID");
  return new CatalogImportError("WRITE_FAILED");
}
function identity(input: unknown, kind: "product" | "variant" | "image", allocated: Record<PreviewIdentity, DatabaseIdentity>): string {
  if (typeof input !== "string") throw new CatalogImportError("INVALID_REQUEST");
  if (input.startsWith("preview:")) {
    const match = PREVIEW.exec(input);
    if (!match || match[1] !== kind) throw new CatalogImportError("INVALID_REQUEST");
    const key = input as PreviewIdentity;
    return allocated[key] ??= randomUUID() as DatabaseIdentity;
  }
  if (!UUID.test(input)) throw new CatalogImportError("INVALID_REQUEST");
  return input;
}
function sqlJson(value: unknown): string { return JSON.stringify(value); }

export class PostgresCatalogSnapshotReader implements CatalogSnapshotReader {
  private readonly client: PoolClient;
  constructor(client: PoolClient) {
    if (!verifiedClients.has(client)) throw new CatalogImportError("PERMISSION_DENIED", "Unverified catalog database connection");
    this.client = client;
  }
  async readRows(): Promise<CatalogSnapshotRows> {
    const output = {} as Record<Table, readonly Record<string, unknown>[]>;
    for (const key of Object.keys(tableNames) as Table[]) {
      const rows = (await this.client.query(`SELECT ${columns[key]} FROM catalog_private.${tableNames[key]} ORDER BY ${key === "product_categories" || key === "translations" ? "product_id" : "id"}`)).rows as Record<string, unknown>[];
      if (key === "variants") for (const row of rows) for (const field of ["moq_quantity", "order_multiple", "package_quantity"])
        row[field] = safeCatalogBigint(row[field], `product_variants.${field}`);
      output[key] = rows;
    }
    return mapCatalogDatabaseRows(output);
  }
  async readSnapshot(templateVersion: string): Promise<CatalogSnapshot> {
    return captureTrustedCatalogSnapshot(await this.readRows(), templateVersion);
  }
}

/** Owns the pool; each operation verifies the physical database before business SQL. */
export class PostgresCatalogImportTransaction implements CatalogImportTransaction {
  private readonly config: LocalCatalogPostgresConfig;
  private readonly pool: pg.Pool;
  private readonly lockMs: number;
  private readonly statementMs: number;
  private readonly transactionMs: number;
  constructor(config: LocalCatalogPostgresConfig) {
    localConfig(config);
    this.config = config;
    this.lockMs = ms(config.lock_timeout_ms, 2000);
    this.statementMs = ms(config.statement_timeout_ms, 10000);
    this.transactionMs = ms(config.transaction_timeout_ms, 30000);
    this.pool = new pg.Pool({ connectionString: config.connection_string, max: 4, connectionTimeoutMillis: 3000 });
  }
  async close(): Promise<void> { await this.pool.end(); }
  private async checkedClient(): Promise<PoolClient> {
    const client = await this.pool.connect();
    try {
      await verifyLocalCatalogTestConnection(client);
      verifiedClients.add(client);
      const listener = () => { /* query rejection is handled by the transaction; suppress an unhandled fatal socket event */ };
      client.on("error", listener);
      clientErrorListeners.set(client, listener);
      return client;
    } catch (error) {
      try { client.release(error instanceof Error ? error : new Error("Catalog database identity check failed")); } catch { /* socket may be closed */ }
      throw error;
    }
  }
  async readSnapshot(): Promise<CatalogSnapshot> {
    const client = await this.checkedClient();
    let discard = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const snapshot = await new PostgresCatalogSnapshotReader(client).readSnapshot(this.config.template_version);
      await client.query("COMMIT");
      return snapshot;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      throw dbError(error);
    } finally { releaseClient(client, discard); }
  }
  async execute(request: TransactionalImportRequest): Promise<DatabaseWriteResult> {
    assertVerifiedCatalogActor(request?.actor_context);
    if (!OPAQUE_TOKEN.test(request.actor_context.actor_id) || !OPAQUE_TOKEN.test(request.import_batch_id)
      || !OPAQUE_TOKEN.test(request.idempotency_key) || !["csv", "excel"].includes(request.import_source) || !request.normalized_batch)
      throw new CatalogImportError("INVALID_REQUEST");
    assertNoPreviewCatalogIds(request.normalized_batch);
    const actorId = request.actor_context.actor_id;
    const source = request.import_source;
    const input = structuredClone(request.normalized_batch);
    const conversion = "csvFiles" in input ? input : null;
    if ((source === "excel") !== Boolean(conversion)) throw new CatalogImportError("INVALID_REQUEST");
    const parsed = conversion?.parsed ?? (conversion ? null : input as ImportParseResult);
    if (!parsed || !parsed.valid || conversion && (!conversion.valid || conversion.issues.some((issue) => issue.severity === "error")))
      throw new CatalogImportError("BATCH_INVALID");
    const fingerprint = catalogImportRequestFingerprint({ ...request, normalized_batch: input });
    const client = await this.checkedClient();
    const beganAt = Date.now();
    let discard = false;
    let writeCommitAttempted = false;
    try {
      await client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      await client.query("SET LOCAL ROLE catalog_import");
      await client.query(`SET LOCAL lock_timeout = '${this.lockMs}ms'`);
      await client.query(`SET LOCAL statement_timeout = '${this.statementMs}ms'`);
      await client.query(`SET LOCAL idle_in_transaction_session_timeout = '${this.statementMs}ms'`);
      await client.query(`SET LOCAL transaction_timeout = '${this.transactionMs}ms'`);
      await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [CATALOG_LOCK]);
      for (const table of ["categories", "products", "product_variants", "product_categories", "product_images", "product_translations"])
        await client.query(`LOCK TABLE catalog_private.${table} IN SHARE ROW EXCLUSIVE MODE`);
      const prior = (await client.query(`SELECT request_fingerprint,result FROM catalog_private.product_import_receipts
        WHERE actor_id=$1 AND idempotency_key=$2`, [actorId, request.idempotency_key])).rows[0];
      if (prior) {
        if (prior.request_fingerprint !== fingerprint) throw new CatalogImportError("IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { ...prior.result as DatabaseWriteResult, replayed: true };
      }
      const reader = new PostgresCatalogSnapshotReader(client);
      const snapshot = await reader.readSnapshot(this.config.template_version);
      if (compareCatalogSnapshotVersion(request.expected_snapshot_version, snapshot) !== "current") throw new CatalogImportError("SNAPSHOT_STALE");
      const merged = mergeCatalogImport(parsed, snapshot);
      if (!merged.valid || !merged.can_apply) throw new CatalogImportError("BATCH_INVALID");
      const identities = {} as Record<PreviewIdentity, DatabaseIdentity>;
      if (merged.outcome !== "unchanged") for (const state of merged.products) await writeProduct(client, state, identities);
      const final = merged.outcome === "unchanged" ? snapshot : await reader.readSnapshot(this.config.template_version);
      const result: DatabaseWriteResult = { status: merged.outcome === "unchanged" ? "no_changes" : "committed",
        import_batch_id: request.import_batch_id, snapshot_version: final.version,
        product_count: merged.outcome === "unchanged" ? 0 : merged.products.length, identity_map: identities, replayed: false };
      assertNoPreviewCatalogIds(result.identity_map);
      await client.query(`INSERT INTO catalog_private.product_import_receipts
        (actor_id,idempotency_key,request_fingerprint,status,result,completed_at)
        VALUES ($1,$2,$3,'committed',$4::jsonb,now())`, [actorId, request.idempotency_key, fingerprint, sqlJson(result)]);
      writeCommitAttempted = true;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      const sqlState = (error as { code?: string })?.code;
      if (writeCommitAttempted && !["23505", "23503", "23514", "P0001"].includes(sqlState ?? "")) {
        discard = true;
        throw new CatalogImportError("COMMIT_UNKNOWN", "Commit outcome unknown; retry only with the same actor, request and idempotency key");
      }
      if (error instanceof Error && /connection terminated unexpectedly/i.test(error.message)
        && Date.now() - beganAt >= this.transactionMs - 10) throw new CatalogImportError("TRANSACTION_TIMEOUT");
      throw dbError(error);
    } finally { releaseClient(client, discard); }
  }
}

async function writeProduct(client: PoolClient, state: FinalCatalogProduct, ids: Record<PreviewIdentity, DatabaseIdentity>): Promise<void> {
  const p = state.product;
  const productId = identity(p.id, "product", ids);
  if (state.operation === "create") await client.query(`INSERT INTO catalog_private.products
    (id,product_code,slug,product_type,status,attributes,customization_options,oem,odm,lead_time_min_days,lead_time_max_days,seo_indexable,featured,new_arrival)
    VALUES ($1,$2,$3,$4,'draft',$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13)`,
    [productId,p.product_code,p.slug,p.product_type,sqlJson(p.attributes ?? {}),sqlJson(p.customization_options ?? []),p.oem ?? false,p.odm ?? false,
      p.lead_time_min_days ?? null,p.lead_time_max_days ?? null,p.seo_indexable ?? false,p.featured ?? false,p.new_arrival ?? false]);
  else await client.query(`UPDATE catalog_private.products SET slug=$2,product_type=$3,attributes=$4::jsonb,
    customization_options=$5::jsonb,oem=$6,odm=$7,lead_time_min_days=$8,lead_time_max_days=$9,
    seo_indexable=$10,featured=$11,new_arrival=$12 WHERE id=$1`,
    [productId,p.slug,p.product_type,sqlJson(p.attributes),sqlJson(p.customization_options),p.oem,p.odm,p.lead_time_min_days,
      p.lead_time_max_days,p.seo_indexable,p.featured,p.new_arrival]);
  for (const variant of state.variants) {
    const variantId = identity(variant.id, "variant", ids);
    const values = [variantId,productId,variant.sku,variant.status,sqlJson(variant.attributes ?? {}),variant.moq_quantity,variant.moq_unit,
      variant.order_multiple ?? null,variant.package_quantity ?? null,variant.package_unit ?? null,variant.reference_price ?? null,
      variant.reference_currency ?? null,variant.sort_order ?? 0];
    await client.query(`INSERT INTO catalog_private.product_variants
      (id,product_id,sku,status,attributes,moq_quantity,moq_unit,order_multiple,package_quantity,package_unit,reference_price,reference_currency,sort_order)
      VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,attributes=EXCLUDED.attributes,moq_quantity=EXCLUDED.moq_quantity,
      moq_unit=EXCLUDED.moq_unit,order_multiple=EXCLUDED.order_multiple,package_quantity=EXCLUDED.package_quantity,
      package_unit=EXCLUDED.package_unit,reference_price=EXCLUDED.reference_price,reference_currency=EXCLUDED.reference_currency,
      sort_order=EXCLUDED.sort_order`, values);
  }
  for (const translation of state.translations) await client.query(`INSERT INTO catalog_private.product_translations
    (product_id,locale,name,short_description,description,seo_title,seo_description)
    VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (product_id,locale) DO UPDATE SET
    name=EXCLUDED.name,short_description=EXCLUDED.short_description,description=EXCLUDED.description,
    seo_title=EXCLUDED.seo_title,seo_description=EXCLUDED.seo_description`,
    [productId,translation.locale,translation.name ?? "",translation.short_description ?? "",translation.description ?? "",
      translation.seo_title ?? "",translation.seo_description ?? ""]);
  await client.query("UPDATE catalog_private.product_categories SET is_primary=false WHERE product_id=$1 AND is_primary", [productId]);
  for (const link of state.categories) await client.query(`INSERT INTO catalog_private.product_categories
    (product_id,category_id,is_primary,sort_order) VALUES ($1,$2,$3,$4)
    ON CONFLICT (product_id,category_id) DO UPDATE SET is_primary=EXCLUDED.is_primary,sort_order=EXCLUDED.sort_order`,
    [productId,link.category_id,link.is_primary ?? false,link.sort_order ?? 0]);
  for (const image of state.images.filter((item) => item.role === "primary" && item.status !== "published"))
    if (UUID.test(String(image.id))) await client.query("UPDATE catalog_private.product_images SET status=$2 WHERE id=$1", [image.id,image.status]);
  for (const image of state.images) {
    const imageId = identity(image.id, "image", ids);
    const variantId = image.variant_id === null || image.variant_id === undefined ? null : identity(image.variant_id, "variant", ids);
    await client.query(`INSERT INTO catalog_private.product_images
      (id,product_id,variant_id,storage_key,public_url,role,status,sort_order,width,height,format,alt_en,alt_zh)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT (id) DO UPDATE SET variant_id=EXCLUDED.variant_id,storage_key=EXCLUDED.storage_key,public_url=EXCLUDED.public_url,
      role=EXCLUDED.role,status=EXCLUDED.status,sort_order=EXCLUDED.sort_order,width=EXCLUDED.width,height=EXCLUDED.height,
      format=EXCLUDED.format,alt_en=EXCLUDED.alt_en,alt_zh=EXCLUDED.alt_zh`,
      [imageId,productId,variantId,image.storage_key,image.public_url,image.role,image.status,image.sort_order ?? 0,
        image.width ?? null,image.height ?? null,image.format ?? null,image.alt_en ?? "",image.alt_zh ?? ""]);
  }
  await client.query("UPDATE catalog_private.products SET status=$2 WHERE id=$1", [productId,p.status ?? "draft"]);
}
