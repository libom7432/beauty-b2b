import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { restrictedCatalogReceiptLookup, RESTRICTED_RECEIPT_FIELDS } from "../src/lib/catalog-import/receipt-access.ts";
import { catalogReceiptLookupError, catalogReceiptLookupQuery, resolveCatalogReceiptAccessMode,
  PostgresCatalogImportTransaction } from "../src/lib/catalog-import/postgres.ts";
import { replayCatalogReceipt } from "../src/lib/catalog-import/receipt.ts";
import { verifyCatalogActorContext } from "../src/lib/catalog-import/transaction.ts";
import { requireCatalogPermission } from "../src/lib/catalog-import/admin-auth.ts";

const originalSql = readFileSync(new URL("../docs/sql/catalog-import-receipts.draft.sql", import.meta.url), "utf8");
const hardeningSql = readFileSync(new URL("../docs/sql/catalog-receipt-access-hardening.draft.sql", import.meta.url), "utf8");
const postgresSource = readFileSync(new URL("../src/lib/catalog-import/postgres.ts", import.meta.url), "utf8");
const transactionSource = readFileSync(new URL("../src/lib/catalog-import/transaction.ts", import.meta.url), "utf8");
const importTestSource = readFileSync(new URL("./test-catalog-postgres-import.mjs", import.meta.url), "utf8");
const concurrencyTestSource = readFileSync(new URL("./test-catalog-postgres-concurrency.mjs", import.meta.url), "utf8");
const actor = await verifyCatalogActorContext("local-test", async () => ({ actor_id: "11111111-1111-4111-8111-111111111111", role: "catalog_import" }));
const hash = "a".repeat(64);
const result = { status: "committed", import_batch_id: "batch-1", snapshot_version: {
  contract: "catalog-snapshot-v1", template_version: "v1", digest: hash }, product_count: 1, identity_map: {} };
const row = (within_retry_window) => ({ request_fingerprint: hash, status: "committed", result, within_retry_window });
const hasCode = (code) => (error) => error?.code === code;

test("restricted lookup accepts only a verified actor and one key", () => {
  const query = restrictedCatalogReceiptLookup(actor, "key-1");
  assert.deepEqual(query.values, [actor.actor_id, "key-1"]);
  assert.match(query.text, /FROM catalog_private\.lookup_catalog_import_receipt\(\$1::text,\$2::text\)/);
  assert.equal(query.text.includes("catalog_private.catalog_import_receipts"), false);
  assert.equal(query.text.includes("SELECT *"), false);
  assert.deepEqual(RESTRICTED_RECEIPT_FIELDS, ["request_fingerprint", "status", "result", "within_retry_window"]);
  assert.throws(() => restrictedCatalogReceiptLookup({ actor_id: actor.actor_id, role: "catalog_import" }, "key-1"), hasCode("PERMISSION_DENIED"));
  assert.throws(() => restrictedCatalogReceiptLookup(actor, "' OR TRUE --"), hasCode("INVALID_REQUEST"));
  assert.throws(() => restrictedCatalogReceiptLookup(actor, ""), hasCode("INVALID_REQUEST"));
});

test("server authorization cannot substitute a client actor or use a preview grant for commit", async () => {
  const provider = { verifySession: async (session) => session === "admin-a" ? { identity_provider: "fixture", provider_subject: "subject-a" } : null };
  const directory = { findByProviderIdentity: async () => ({ admin_id: actor.actor_id, identity_provider: "fixture", provider_subject: "subject-a",
    status: "active", created_at: "2026-01-01T00:00:00Z", disabled_at: null, permissions: ["catalog.import.preview", "catalog.import.commit"] }) };
  const verified = await requireCatalogPermission("admin-a", "catalog.import.commit", { provider, directory });
  assert.deepEqual(restrictedCatalogReceiptLookup(verified.actor_context, "key-1").values, [actor.actor_id, "key-1"]);
  const preview = await requireCatalogPermission("admin-a", "catalog.import.preview", { provider, directory });
  assert.equal(Object.hasOwn(preview, "actor_context"), false);
  await assert.rejects(requireCatalogPermission({ actor_id: "other", session: "admin-a" }, "catalog.import.commit", { provider, directory }), hasCode("PERMISSION_DENIED"));
});

test("function draft removes direct reads and exposes one row with four fields", () => {
  assert.match(hardeningSql, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(hardeningSql, /REVOKE SELECT ON catalog_private\.catalog_import_receipts FROM catalog_import, catalog_admin/);
  assert.match(hardeningSql, /DROP POLICY catalog_import_receipts_read/);
  assert.match(hardeningSql, /DROP POLICY catalog_admin_receipts_read/);
  assert.match(hardeningSql, /RETURNS TABLE \(request_fingerprint text, status text, result jsonb, within_retry_window boolean\)/);
  assert.match(hardeningSql, /WHERE r\.actor_id = p_actor_id AND r\.idempotency_key = p_idempotency_key[\s\S]*LIMIT 1/);
  assert.match(hardeningSql, /REVOKE ALL ON FUNCTION catalog_private\.lookup_catalog_import_receipt\(text,text\) FROM PUBLIC/);
  assert.match(hardeningSql, /GRANT EXECUTE ON FUNCTION catalog_private\.lookup_catalog_import_receipt\(text,text\) TO catalog_import/);
  assert.doesNotMatch(hardeningSql, /GRANT EXECUTE[^;]+TO (?:anon|catalog_admin|PUBLIC)/);
  assert.doesNotMatch(hardeningSql, /DROP TABLE|TRUNCATE|DELETE FROM|CREATE VIEW|EXECUTE FORMAT|EXECUTE \$/i);
});

test("definer remains non-superuser with pinned search path and FORCE RLS", () => {
  assert.match(hardeningSql, /CREATE ROLE catalog_receipt_lookup_owner NOLOGIN NOINHERIT NOSUPERUSER[\s\S]*NOBYPASSRLS/);
  assert.match(hardeningSql, /LANGUAGE sql VOLATILE SECURITY DEFINER\s+SET search_path = pg_catalog, pg_temp/);
  assert.match(hardeningSql, /ALTER FUNCTION catalog_private\.lookup_catalog_import_receipt\(text,text\) OWNER TO catalog_receipt_lookup_owner/);
  assert.match(hardeningSql, /REVOKE CREATE ON SCHEMA catalog_private FROM catalog_receipt_lookup_owner/);
  assert.match(hardeningSql, /ALTER TABLE catalog_private\.catalog_import_receipts FORCE ROW LEVEL SECURITY/);
  assert.match(hardeningSql, /GRANT INSERT \(actor_id, idempotency_key, request_fingerprint, status, result,[\s\S]*result_purge_after\)/);
});

test("idempotency, 30/90-day retention, tombstone and recovery contract remain", () => {
  assert.match(originalSql, /PRIMARY KEY \(actor_id, idempotency_key\)/);
  assert.match(originalSql, /retry_until = completed_at \+ interval '30 days'/);
  assert.match(originalSql, /result_purge_after = completed_at \+ interval '90 days'/);
  assert.match(originalSql, /status IN \('committed', 'expired'\)/);
  assert.match(hardeningSql, /Existing maintenance grants\/policies, 30\/90-day[\s\S]*tombstones are untouched/);
  assert.match(postgresSource, /resolveCatalogReceiptAccessMode\(config\.receipt_access_mode\)/);
  assert.match(postgresSource, /catalogReceiptLookupQuery\(this\.receiptAccessMode/);
  assert.match(postgresSource, /SELECT pg_advisory_xact_lock\(\$1::bigint\)/);
  assert.match(postgresSource, /writeCommitAttempted[\s\S]*"COMMIT_UNKNOWN"/);
  assert.match(transactionSource, /expected: request\.expected_snapshot_version/);
  assert.deepEqual(replayCatalogReceipt(row(true), hash), { ...result, replayed: true });
  assert.throws(() => replayCatalogReceipt(row(true), "b".repeat(64)), hasCode("IDEMPOTENCY_CONFLICT"));
  assert.throws(() => replayCatalogReceipt(row(false), hash), hasCode("IDEMPOTENCY_KEY_EXPIRED"));
});

test("restricted_v1 is the default; direct SELECT needs an explicit legacy mode", async () => {
  assert.equal(resolveCatalogReceiptAccessMode(), "restricted_v1");
  assert.equal(resolveCatalogReceiptAccessMode("restricted_v1"), "restricted_v1");
  assert.equal(resolveCatalogReceiptAccessMode("legacy_direct"), "legacy_direct");
  assert.throws(() => resolveCatalogReceiptAccessMode("unexpected"), hasCode("INVALID_REQUEST"));
  const restricted = catalogReceiptLookupQuery(resolveCatalogReceiptAccessMode(), actor, "key-1");
  assert.match(restricted.text, /catalog_private\.lookup_catalog_import_receipt/);
  assert.doesNotMatch(restricted.text, /FROM catalog_private\.catalog_import_receipts/);
  const legacy = catalogReceiptLookupQuery(resolveCatalogReceiptAccessMode("legacy_direct"), actor, "key-1");
  assert.match(legacy.text, /FROM catalog_private\.catalog_import_receipts/);
  assert.deepEqual(legacy.values, [actor.actor_id, "key-1"]);
  assert.match(postgresSource, /receiptAccessMode === "legacy_direct" && target\.port !== "55439"/);
  const legacyDir = process.env.CATALOG_IMPORT_LEGACY_TEST_DATA_DIR;
  const currentDir = process.env.CATALOG_IMPORT_TEST_DATA_DIR;
  if (legacyDir && currentDir) {
    const old = { connection_string: "postgresql://catalog_test_owner@127.0.0.1:55439/catalog_import_test",
      data_directory: legacyDir, template_version: "catalog-attributes-v1", receipt_access_mode: "legacy_direct" };
    const historic = new PostgresCatalogImportTransaction(old);
    await historic.close();
    assert.throws(() => new PostgresCatalogImportTransaction({ ...old,
      connection_string: "postgresql://catalog_d2b_owner@127.0.0.1:55440/catalog_receipts_d2b_test",
      data_directory: currentDir }), hasCode("INVALID_REQUEST"));
  }
});

test("missing restricted function fails explicitly before COMMIT with no query fallback", () => {
  for (const sqlState of ["42883", "42501", "3F000", "42P01"]) {
    const failure = catalogReceiptLookupError({ code: sqlState });
    assert.equal(failure.code, "RECEIPT_ACCESS_UNAVAILABLE");
    assert.notEqual(failure.code, "COMMIT_UNKNOWN");
  }
  assert.equal(catalogReceiptLookupError({ code: "57014" }).code, "TRANSACTION_TIMEOUT");
  assert.equal(catalogReceiptLookupError({ code: "XX000" }).code, "WRITE_FAILED");
  assert.match(postgresSource, /catch \(error\) \{ throw this\.receiptAccessMode === "restricted_v1" \? catalogReceiptLookupError\(error\) : dbError\(error\); \}/);
  assert.match(postgresSource, /let writeCommitAttempted = false;[\s\S]*catalogReceiptLookupQuery[\s\S]*writeCommitAttempted = true;/);
  assert.doesNotMatch(postgresSource, /catalogReceiptLookupError\(error\)[\s\S]{0,100}legacy_direct/);
});

test("both isolated PostgreSQL suites require hardened receipt permissions", () => {
  for (const source of [importTestSource, concurrencyTestSource]) {
    assert.match(source, /receipt_access_mode: "restricted_v1"/);
    assert.match(source, /lookup_catalog_import_receipt\(text,text\)/);
    assert.match(source, /has_any_column_privilege\('catalog_import','catalog_private\.catalog_import_receipts','SELECT'\)/);
    assert.match(source, /has_any_column_privilege\('catalog_admin','catalog_private\.catalog_import_receipts','SELECT'\)/);
  }
});

test("shared database role remains unable to prove actor isolation", () => {
  // The function accepts an actor ID because the shared DB role has no trusted per-actor identity.
  // A holder of that role could call it with another actor ID and a known key.
  assert.match(hardeningSql, /lookup_catalog_import_receipt\(p_actor_id text, p_idempotency_key text\)/);
  assert.match(hardeningSql, /FOR SELECT TO catalog_receipt_lookup_owner USING \(true\)/);
});
