/** Server-only idempotency receipt contract. Time eligibility is computed by PostgreSQL. */
import { CatalogImportError, type DatabaseWriteResult, type PreviewIdentity, type DatabaseIdentity } from "./transaction.ts";

const TOKEN = /^[A-Za-z0-9_-]{1,200}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PREVIEW = /^preview:(product|variant|image):[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = ["status", "import_batch_id", "snapshot_version", "product_count", "identity_map"];

export type CatalogReceiptResult = Readonly<Omit<DatabaseWriteResult, "replayed">>;
export type DatabaseReceiptRow = Readonly<{
  request_fingerprint: unknown;
  status: unknown;
  result: unknown;
  /** Result of clock_timestamp() <= retry_until on the locked database connection. */
  within_retry_window: unknown;
}>;

function safeReceiptResult(value: unknown, fromDatabase: boolean): CatalogReceiptResult {
  const fail = () => { throw new CatalogImportError(fromDatabase ? "WRITE_FAILED" : "INVALID_REQUEST"); };
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  if (fromDatabase && (Object.keys(row).length !== KEYS.length || KEYS.some((key) => !Object.hasOwn(row, key)))) return fail();
  const version = row.snapshot_version;
  if (!version || typeof version !== "object" || Array.isArray(version)) return fail();
  const v = version as Record<string, unknown>;
  if (v.contract !== "catalog-snapshot-v1" || typeof v.template_version !== "string"
    || !v.template_version || v.template_version.length > 200 || typeof v.digest !== "string" || !SHA256.test(v.digest)) return fail();
  if (row.status !== "committed" && row.status !== "no_changes") return fail();
  if (typeof row.import_batch_id !== "string" || !TOKEN.test(row.import_batch_id)) return fail();
  if (typeof row.product_count !== "number" || !Number.isSafeInteger(row.product_count) || row.product_count < 0) return fail();
  if (!row.identity_map || typeof row.identity_map !== "object" || Array.isArray(row.identity_map)) return fail();
  const identityMap = {} as Record<PreviewIdentity, DatabaseIdentity>;
  for (const [preview, databaseId] of Object.entries(row.identity_map)) {
    if (!PREVIEW.test(preview) || typeof databaseId !== "string" || !UUID.test(databaseId)) return fail();
    identityMap[preview as PreviewIdentity] = databaseId as DatabaseIdentity;
  }
  if (row.status === "no_changes" && ((row.product_count as number) !== 0 || Object.keys(identityMap).length !== 0)) return fail();
  return {
    status: row.status,
    import_batch_id: row.import_batch_id,
    snapshot_version: { contract: "catalog-snapshot-v1", template_version: v.template_version, digest: v.digest },
    product_count: row.product_count as number,
    identity_map: identityMap,
  };
}

/** Explicit allowlist; never serialize a spread of a request, error, or parsed workbook. */
export function catalogReceiptPayload(result: DatabaseWriteResult): CatalogReceiptResult {
  return safeReceiptResult(result, false);
}

/** A missing row is handled by the caller. Existing keys never fall through to new execution. */
export function replayCatalogReceipt(row: DatabaseReceiptRow, fingerprint: string): DatabaseWriteResult {
  if (typeof row.request_fingerprint !== "string" || !SHA256.test(row.request_fingerprint)
    || typeof row.within_retry_window !== "boolean") throw new CatalogImportError("WRITE_FAILED");
  if (row.request_fingerprint !== fingerprint) throw new CatalogImportError("IDEMPOTENCY_CONFLICT");
  if (row.status === "expired" || !row.within_retry_window) throw new CatalogImportError("IDEMPOTENCY_KEY_EXPIRED");
  if (row.status !== "committed") throw new CatalogImportError("WRITE_FAILED");
  return { ...safeReceiptResult(row.result, true), replayed: true };
}
