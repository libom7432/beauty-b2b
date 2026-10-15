/** Fixed, single-key receipt lookup for the reviewed incremental permission migration. */
import { assertVerifiedCatalogActor, CatalogImportError, type ActorContext } from "./transaction.ts";

const TOKEN = /^[A-Za-z0-9_-]{1,200}$/;
export const RESTRICTED_RECEIPT_FIELDS = ["request_fingerprint", "status", "result", "within_retry_window"] as const;
export const RESTRICTED_RECEIPT_LOOKUP_SQL = `SELECT request_fingerprint,status,result,within_retry_window
  FROM catalog_private.lookup_catalog_import_receipt($1::text,$2::text)`;

/** Actor ID comes from the verified transaction context, never from a separate request argument. */
export function restrictedCatalogReceiptLookup(actor: ActorContext, idempotencyKey: string): Readonly<{ text: string; values: readonly [string, string] }> {
  assertVerifiedCatalogActor(actor);
  if (!TOKEN.test(actor.actor_id) || typeof idempotencyKey !== "string" || !TOKEN.test(idempotencyKey))
    throw new CatalogImportError("INVALID_REQUEST");
  return Object.freeze({ text: RESTRICTED_RECEIPT_LOOKUP_SQL, values: Object.freeze([actor.actor_id, idempotencyKey] as const) });
}
