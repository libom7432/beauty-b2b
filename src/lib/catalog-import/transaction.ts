/** Server-side contract and offline transaction simulator. No SQL or network access. */
import { createHash } from "node:crypto";
import type { ImportParseResult } from "./csv.ts";
import type { ExcelConversionResult } from "./excel.ts";
import { assertNoPreviewCatalogIds, mergeCatalogImport, type FinalCatalogProduct } from "./merge.ts";
import { captureTrustedCatalogSnapshot, type CatalogSnapshot, type CatalogSnapshotRows } from "./snapshot.ts";
import { compareCatalogSnapshotVersion, type ImportSource, type SnapshotVersion } from "./dry-run.ts";

export type CatalogTable = keyof CatalogSnapshotRows;
export type DatabaseIdentity = string & { readonly __databaseIdentity: unique symbol };
export type PreviewIdentity = `preview:${"product" | "variant" | "image"}:${string}`;
declare const verifiedActor: unique symbol;
export type ActorContext = Readonly<{ actor_id: string; role: "catalog_admin" | "catalog_import"; [verifiedActor]: true }>;
export type CatalogActorVerifier = (session: unknown) => Promise<{ actor_id: string; role: ActorContext["role"] } | null>;
const verifiedActors = new WeakSet<object>();
/** Checks the in-process server-verifier brand; role strings supplied by a client are insufficient. */
export function assertVerifiedCatalogActor(actor: unknown): asserts actor is ActorContext {
  if (!actor || typeof actor !== "object" || !verifiedActors.has(actor)) throw new CatalogImportError("PERMISSION_DENIED");
}
/** Server-only boundary: the verifier must authenticate the session and resolve its role. */
export async function verifyCatalogActorContext(session: unknown, verifier: CatalogActorVerifier): Promise<ActorContext> {
  if (typeof verifier !== "function") throw new CatalogImportError("PERMISSION_DENIED");
  const claims = await verifier(session);
  if (!claims || typeof claims.actor_id !== "string" || !claims.actor_id.trim()
    || !["catalog_admin", "catalog_import"].includes(claims.role)) throw new CatalogImportError("PERMISSION_DENIED");
  const actor = Object.freeze({ actor_id: claims.actor_id, role: claims.role }) as ActorContext;
  verifiedActors.add(actor);
  return actor;
}
export type TransactionalImportRequest = Readonly<{
  import_batch_id: string; idempotency_key: string; expected_snapshot_version: SnapshotVersion;
  import_source: ImportSource; normalized_batch: ImportParseResult | ExcelConversionResult; actor_context: ActorContext;
}>;
export type DatabaseWriteResult = Readonly<{
  status: "committed" | "no_changes"; import_batch_id: string; snapshot_version: SnapshotVersion;
  product_count: number; identity_map: Readonly<Record<PreviewIdentity, DatabaseIdentity>>; replayed: boolean;
}>;
export interface CatalogSnapshotReader {
  /** A controlled server-side adapter must return all six private tables, including drafts. */
  readRows(): Promise<CatalogSnapshotRows>;
}
export interface CatalogImportTransaction {
  execute(request: TransactionalImportRequest): Promise<DatabaseWriteResult>;
}
export type MockFailureStage = "products" | "variants" | "translations" | "product_categories" | "images" | "before_commit" | "idempotency_receipt";
export type MockTransactionOptions = { fail_at?: MockFailureStage; hold_lock?: () => Promise<void>; timeout_ms?: number };
export class CatalogImportError extends Error {
  readonly code: "PERMISSION_DENIED" | "INVALID_REQUEST" | "IDEMPOTENCY_CONFLICT" | "IDEMPOTENCY_KEY_EXPIRED" | "RECEIPT_ACCESS_UNAVAILABLE" | "SNAPSHOT_STALE" | "BATCH_INVALID" | "TRANSACTION_TIMEOUT" | "COMMIT_UNKNOWN" | "WRITE_FAILED";
  constructor(code: CatalogImportError["code"], message: string = code) {
    super(message); this.name = "CatalogImportError"; this.code = code;
  }
}

const FIELDS: { [K in CatalogTable]: readonly (keyof CatalogSnapshotRows[K][number])[] } = {
  products: ["id", "product_code", "slug", "product_type", "status", "attributes", "customization_options", "oem", "odm", "lead_time_min_days", "lead_time_max_days", "seo_indexable", "featured", "new_arrival", "published_at", "created_at", "updated_at"],
  variants: ["id", "product_id", "sku", "status", "attributes", "moq_quantity", "moq_unit", "order_multiple", "package_quantity", "package_unit", "reference_price", "reference_currency", "sort_order", "created_at", "updated_at"],
  categories: ["id", "parent_id", "slug", "status", "name_en", "name_zh", "description_en", "description_zh", "sort_order", "created_at", "updated_at"],
  product_categories: ["product_id", "category_id", "is_primary", "sort_order", "created_at", "updated_at"],
  images: ["id", "product_id", "variant_id", "storage_key", "public_url", "role", "status", "sort_order", "width", "height", "format", "alt_en", "alt_zh", "created_at", "updated_at"],
  translations: ["product_id", "locale", "name", "short_description", "description", "seo_title", "seo_description", "created_at", "updated_at"],
};
const copy = <T>(value: T): T => structuredClone(value);
const timestamp = "2026-01-01T00:00:00.000Z"; // deterministic mock clock only
function canonical(value: unknown): string {
  const walk = (part: unknown): unknown => Array.isArray(part) ? part.map(walk) : part && typeof part === "object"
    ? Object.fromEntries(Object.entries(part).filter(([, value]) => value !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, walk(value)])) : part;
  return JSON.stringify(walk(value));
}
export function catalogImportRequestFingerprint(request: TransactionalImportRequest): string {
  // The grouped `products` projection is redundant and must not be trusted.
  const conversion = "csvFiles" in request.normalized_batch ? request.normalized_batch : null;
  const parsed = conversion?.parsed ?? (conversion ? null : request.normalized_batch as ImportParseResult);
  const normalized = { import_batch_id: request.import_batch_id, source: request.import_source, expected: request.expected_snapshot_version,
    rows: parsed?.rows ?? null, issues: parsed?.issues ?? [], conversion_issues: conversion?.issues ?? [], conversion_valid: conversion?.valid ?? null };
  return createHash("sha256").update(canonical(normalized)).digest("hex");
}
function uuid(seed: string): DatabaseIdentity {
  const h = createHash("sha256").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}` as DatabaseIdentity;
}
function fieldRows<K extends CatalogTable>(table: K, values: readonly Record<string, unknown>[]): CatalogSnapshotRows[K] {
  const fields = FIELDS[table];
  return values.map((value) => {
    const mapped: Record<string, unknown> = {};
    for (const field of fields) {
      if (!Object.hasOwn(value, field)) throw new CatalogImportError("INVALID_REQUEST", `Missing trusted ${table}.${String(field)}`);
      const raw = value[field as string];
      if (typeof raw === "bigint" && (raw > BigInt(Number.MAX_SAFE_INTEGER) || raw < BigInt(Number.MIN_SAFE_INTEGER)))
        throw new CatalogImportError("INVALID_REQUEST", `Unsafe trusted ${table}.${String(field)}`);
      mapped[field as string] = raw instanceof Date ? raw.toISOString() : typeof raw === "bigint" ? Number(raw) : raw;
    }
    if (table === "variants" && mapped.reference_price !== null) mapped.reference_price = String(mapped.reference_price);
    return mapped;
  }) as CatalogSnapshotRows[K];
}
/** Pure boundary mapper: PostgreSQL NULL stays null, numeric becomes decimal text, dates ISO text. */
export function mapCatalogDatabaseRows(rows: { [K in CatalogTable]: readonly Record<string, unknown>[] }): CatalogSnapshotRows {
  return {
    products: fieldRows("products", rows.products), variants: fieldRows("variants", rows.variants),
    categories: fieldRows("categories", rows.categories), product_categories: fieldRows("product_categories", rows.product_categories),
    images: fieldRows("images", rows.images), translations: fieldRows("translations", rows.translations),
  };
}
export async function readCatalogSnapshot(reader: CatalogSnapshotReader, templateVersion: string): Promise<CatalogSnapshot> {
  return captureTrustedCatalogSnapshot(mapCatalogDatabaseRows(await reader.readRows()), templateVersion);
}

const DEFAULTS: Record<Exclude<CatalogTable, "categories">, Record<string, unknown>> = {
  products: { status: "draft", attributes: {}, customization_options: [], oem: false, odm: false, lead_time_min_days: null, lead_time_max_days: null, seo_indexable: false, featured: false, new_arrival: false, published_at: null },
  variants: { status: "draft", attributes: {}, order_multiple: null, package_quantity: null, package_unit: null, reference_price: null, reference_currency: null, sort_order: 0 },
  product_categories: { is_primary: false, sort_order: 0 },
  images: { variant_id: null, status: "draft", sort_order: 0, width: null, height: null, format: null, alt_en: "", alt_zh: "" },
  translations: { name: "", short_description: "", description: "", seo_title: "", seo_description: "" },
};
function complete<K extends Exclude<CatalogTable, "categories">>(table: K, data: Record<string, unknown>, previous?: Record<string, unknown>): CatalogSnapshotRows[K][number] {
  const row: Record<string, unknown> = { ...DEFAULTS[table], ...data, created_at: previous?.created_at ?? timestamp, updated_at: timestamp };
  if (table === "products" && row.status === "published" && !row.published_at) row.published_at = timestamp;
  return row as CatalogSnapshotRows[K][number];
}
function materialize(base: CatalogSnapshotRows, finalStates: readonly FinalCatalogProduct[], key: string, fail?: MockFailureStage): { rows: CatalogSnapshotRows; identities: Record<PreviewIdentity, DatabaseIdentity> } {
  const rows = copy(base);
  const identities = {} as Record<PreviewIdentity, DatabaseIdentity>;
  let counter = 0;
  const existingIds = new Set([...rows.products, ...rows.variants, ...rows.images, ...rows.categories].map((row) => row.id));
  const real = (input: unknown): string => {
    if (typeof input !== "string") throw new CatalogImportError("INVALID_REQUEST");
    if (!input.startsWith("preview:")) return input;
    if (!/^preview:(product|variant|image):[a-f0-9]{64}$/.test(input)) throw new CatalogImportError("INVALID_REQUEST");
    const preview = input as PreviewIdentity;
    if (!identities[preview]) {
      let candidate: DatabaseIdentity;
      do { candidate = uuid(`${key}\0${++counter}`); } while (existingIds.has(candidate));
      identities[preview] = candidate; existingIds.add(candidate);
    }
    return identities[preview];
  };
  const maybeFail = (stage: MockFailureStage) => { if (fail === stage) throw new CatalogImportError("WRITE_FAILED"); };
  for (const state of finalStates) {
    const productId = real(state.product.id);
    const priorProduct = rows.products.find((row) => row.id === productId);
    rows.products = rows.products.filter((row) => row.id !== productId);
    rows.products.push(complete("products", { ...state.product, id: productId }, priorProduct));
    maybeFail("products");
    rows.variants = rows.variants.filter((row) => row.product_id !== productId);
    for (const item of state.variants) rows.variants.push(complete("variants", { ...item, id: real(item.id), product_id: productId }, base.variants.find((row) => row.id === item.id)));
    maybeFail("variants");
    rows.translations = rows.translations.filter((row) => row.product_id !== productId);
    for (const item of state.translations) rows.translations.push(complete("translations", { ...item, product_id: productId }, base.translations.find((row) => row.product_id === productId && row.locale === item.locale)));
    maybeFail("translations");
    rows.product_categories = rows.product_categories.filter((row) => row.product_id !== productId);
    for (const item of state.categories) rows.product_categories.push(complete("product_categories", { ...item, product_id: productId }, base.product_categories.find((row) => row.product_id === productId && row.category_id === item.category_id)));
    maybeFail("product_categories");
    rows.images = rows.images.filter((row) => row.product_id !== productId);
    for (const item of state.images) rows.images.push(complete("images", { ...item, id: real(item.id), product_id: productId, variant_id: item.variant_id ? real(item.variant_id) : null }, base.images.find((row) => row.id === item.id)));
    maybeFail("images");
  }
  assertNoPreviewCatalogIds(rows);
  return { rows: mapCatalogDatabaseRows(rows), identities };
}

/** Single-process Mock. Its global lock simulates serialization; it is not a production lock implementation. */
export class MockCatalogDatabaseAdapter implements CatalogSnapshotReader, CatalogImportTransaction {
  private rows: CatalogSnapshotRows;
  private gate: Promise<void> = Promise.resolve();
  private readonly receipts = new Map<string, { fingerprint: string; result: DatabaseWriteResult }>();
  private readonly templateVersion: string;
  private readonly options: MockTransactionOptions;
  constructor(initial: CatalogSnapshotRows, templateVersion: string, options: MockTransactionOptions = {}) {
    this.templateVersion = templateVersion; this.options = { ...options };
    this.rows = copy(mapCatalogDatabaseRows(initial));
    captureTrustedCatalogSnapshot(this.rows, templateVersion);
  }
  async readRows(): Promise<CatalogSnapshotRows> { return copy(this.rows); }
  async readSnapshot(): Promise<CatalogSnapshot> { return readCatalogSnapshot(this, this.templateVersion); }
  async execute(request: TransactionalImportRequest): Promise<DatabaseWriteResult> {
    assertVerifiedCatalogActor(request.actor_context);
    if (!request.import_batch_id?.trim() || !request.idempotency_key?.trim() || !request.normalized_batch || !["csv", "excel"].includes(request.import_source)) throw new CatalogImportError("INVALID_REQUEST");
    assertNoPreviewCatalogIds(request.normalized_batch);
    const requestCopy = copy(request);
    const conversion = "csvFiles" in requestCopy.normalized_batch ? requestCopy.normalized_batch : null;
    if ((requestCopy.import_source === "excel") !== Boolean(conversion)) throw new CatalogImportError("INVALID_REQUEST");
    const parsed = conversion?.parsed ?? (conversion ? null : requestCopy.normalized_batch as ImportParseResult);
    if (!parsed || !parsed.valid || conversion && (!conversion.valid || conversion.issues.some((issue) => issue.severity === "error")))
      throw new CatalogImportError("BATCH_INVALID");
    const fingerprintValue = catalogImportRequestFingerprint(requestCopy);
    const receiptKey = `${requestCopy.actor_context.actor_id}\0${requestCopy.idempotency_key}`;
    let release!: () => void;
    const prior = this.gate;
    this.gate = new Promise<void>((resolve) => { release = resolve; });
    const limit = this.options.timeout_ms ?? 5000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const waited = await Promise.race([prior.then(() => true), new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), limit); })]);
    if (timer) clearTimeout(timer);
    if (!waited) { void prior.then(release); throw new CatalogImportError("TRANSACTION_TIMEOUT"); }
    try {
      const receipt = this.receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprintValue) throw new CatalogImportError("IDEMPOTENCY_CONFLICT");
        return { ...copy(receipt.result), replayed: true };
      }
      if (this.options.hold_lock) {
        let workTimer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([this.options.hold_lock(), new Promise<never>((_, reject) => {
            workTimer = setTimeout(() => reject(new CatalogImportError("TRANSACTION_TIMEOUT")), limit);
          })]);
        } finally { if (workTimer) clearTimeout(workTimer); }
      }
      const snapshot = await this.readSnapshot();
      if (compareCatalogSnapshotVersion(requestCopy.expected_snapshot_version, snapshot) !== "current") throw new CatalogImportError("SNAPSHOT_STALE");
      const merged = mergeCatalogImport(parsed, snapshot);
      if (!merged.valid || !merged.can_apply) throw new CatalogImportError("BATCH_INVALID");
      let result: DatabaseWriteResult;
      let nextRows: CatalogSnapshotRows | undefined;
      if (merged.outcome === "unchanged") result = { status: "no_changes", import_batch_id: requestCopy.import_batch_id, snapshot_version: snapshot.version, product_count: 0, identity_map: {}, replayed: false };
      else {
        const { rows, identities } = materialize(this.rows, merged.products, receiptKey, this.options.fail_at);
        if (this.options.fail_at === "before_commit") throw new CatalogImportError("WRITE_FAILED");
        const committed = captureTrustedCatalogSnapshot(rows, this.templateVersion);
        result = { status: "committed", import_batch_id: requestCopy.import_batch_id, snapshot_version: committed.version,
          product_count: merged.products.length, identity_map: identities, replayed: false };
        nextRows = rows;
      }
      if (this.options.fail_at === "idempotency_receipt") throw new CatalogImportError("WRITE_FAILED");
      this.receipts.set(receiptKey, { fingerprint: fingerprintValue, result: copy(result) });
      if (nextRows) this.rows = nextRows; // one visible state change after the receipt succeeds
      return result;
    } finally { release(); }
  }
}
