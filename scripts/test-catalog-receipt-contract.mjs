import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { catalogReceiptPayload, replayCatalogReceipt } from "../src/lib/catalog-import/receipt.ts";
import { PostgresCatalogImportTransaction, verifyLocalCatalogTestConnection } from "../src/lib/catalog-import/postgres.ts";

const digest = "a".repeat(64);
const fingerprint = "b".repeat(64);
const preview = `preview:product:${"c".repeat(64)}`;
const databaseId = "11111111-1111-4111-8111-111111111111";
const result = () => ({ status: "committed", import_batch_id: "synthetic-batch",
  snapshot_version: { contract: "catalog-snapshot-v1", template_version: "catalog-attributes-v1", digest },
  product_count: 1, identity_map: { [preview]: databaseId }, replayed: false });
const receipt = (overrides = {}) => ({ request_fingerprint: fingerprint, status: "committed",
  result: catalogReceiptPayload(result()), within_retry_window: true, ...overrides });
const code = (expected) => (error) => { assert.equal(error?.code, expected); return true; };

test("persisted result is an explicit five-field allowlist", () => {
  const input = { ...result(), workbook: "secret workbook", credentials: "secret password",
    error_stack: "secret stack", translation_body: "secret translation" };
  const projected = catalogReceiptPayload(input);
  assert.deepEqual(Object.keys(projected), ["status", "import_batch_id", "snapshot_version", "product_count", "identity_map"]);
  assert.deepEqual(Object.keys(projected.snapshot_version), ["contract", "template_version", "digest"]);
  assert.equal(JSON.stringify(projected).includes("secret"), false);
  assert.equal(Object.hasOwn(projected, "replayed"), false);
  assert.deepEqual(input, { ...result(), workbook: "secret workbook", credentials: "secret password",
    error_stack: "secret stack", translation_body: "secret translation" });
});

test("first success and replay have identical business fields", () => {
  const replay = replayCatalogReceipt(receipt(), fingerprint);
  assert.equal(replay.replayed, true);
  assert.deepEqual({ ...replay, replayed: false }, result());
});

test("the database decides the inclusive 30-day boundary", () => {
  assert.equal(replayCatalogReceipt(receipt({ within_retry_window: true }), fingerprint).replayed, true);
  assert.throws(() => replayCatalogReceipt(receipt({ within_retry_window: false }), fingerprint), code("IDEMPOTENCY_KEY_EXPIRED"));
  assert.throws(() => replayCatalogReceipt(receipt({ status: "expired", result: null }), fingerprint), code("IDEMPOTENCY_KEY_EXPIRED"));
});

test("different request conflicts even after expiry; old key never falls through", () => {
  assert.throws(() => replayCatalogReceipt(receipt({ within_retry_window: false }), "d".repeat(64)), code("IDEMPOTENCY_CONFLICT"));
  assert.throws(() => replayCatalogReceipt(receipt({ status: "expired", result: null }), fingerprint), code("IDEMPOTENCY_KEY_EXPIRED"));
});

test("unexpected database receipt fields and invalid identities fail closed", () => {
  assert.throws(() => replayCatalogReceipt(receipt({ result: { ...result(), leaked: "secret" } }), fingerprint), code("WRITE_FAILED"));
  assert.throws(() => catalogReceiptPayload({ ...result(), identity_map: { [preview]: "preview:product:fake" } }), code("INVALID_REQUEST"));
  assert.throws(() => catalogReceiptPayload({ ...result(), product_count: Number.MAX_SAFE_INTEGER + 1 }), code("INVALID_REQUEST"));
  assert.throws(() => replayCatalogReceipt(receipt({ within_retry_window: "true" }), fingerprint), code("WRITE_FAILED"));
});

test("static SQL contract keeps permanent tombstones and database-owned time", () => {
  const draft = readFileSync(new URL("../docs/sql/catalog-import-receipts.draft.sql", import.meta.url), "utf8");
  const local = readFileSync(new URL("./catalog-import-local-receipts.sql", import.meta.url), "utf8");
  const adapter = readFileSync(new URL("../src/lib/catalog-import/postgres.ts", import.meta.url), "utf8");
  for (const sql of [draft, local]) {
    assert.match(sql, /CREATE TABLE catalog_private\.catalog_import_receipts/);
    assert.match(sql, /PRIMARY KEY \(actor_id, idempotency_key\)/);
    assert.match(sql, /interval '30 days'/);
    assert.match(sql, /interval '90 days'/);
    assert.match(sql, /status = 'expired' AND result IS NULL/);
    assert.doesNotMatch(sql, /DELETE\s+FROM\s+catalog_private\.catalog_import_receipts/i);
  }
  assert.match(adapter, /clock_timestamp\(\) <= retry_until AS within_retry_window/);
  assert.match(adapter, /WITH stamp AS \(SELECT clock_timestamp\(\) AS completed_at\)/);
  assert.match(adapter, /FROM catalog_private\.catalog_import_receipts/);
  assert.match(local, /catalog_receipts_d2b_test/);
  assert.match(local, /7696419892593432091/);
  assert.match(local, /current_setting\('server_version_num'\)::integer <> 170011/);
  assert.match(local, /to_regclass\('catalog_private\.products'\) IS NULL/);
  assert.match(local, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'rfq_api'\)/);
  assert.match(adapter, /7696341689079925702/); // Legacy target remains pinned.
  assert.match(adapter, /7696419892593432091/);
  assert.match(adapter, /current_setting\('server_version_num'\)::integer server_version_num/);
});

test("approved D2-B target still requires exact actual-server identity",
  { skip: !process.env.CATALOG_IMPORT_TEST_DATA_DIR }, async () => {
  const config = { connection_string: "postgresql://catalog_d2b_owner@127.0.0.1:55440/catalog_receipts_d2b_test",
    data_directory: process.env.CATALOG_IMPORT_TEST_DATA_DIR,
    template_version: "catalog-attributes-v1" };
  const adapter = new PostgresCatalogImportTransaction(config);
  await adapter.close(); // Construction alone must not open a connection or write.
  let queries = 0;
  const actual = { db: "catalog_receipts_d2b_test", username: "catalog_d2b_owner", execution_user: "catalog_d2b_owner",
    server_version_num: 170011, host: "127.0.0.1", port: 55440,
    listens: "127.0.0.1", data_dir: config.data_directory, system_id: "7696419892593432091", rfq_schema: null };
  await verifyLocalCatalogTestConnection({ query: async () => { queries++; return { rows: [actual] }; } }, config);
  assert.equal(queries, 1);
  for (const change of [{ system_id: "wrong" }, { data_dir: "/tmp/wrong" }, { username: "other" },
    { execution_user: "catalog_import" }, { server_version_num: 170010 }, { port: 55439 }]) {
    await assert.rejects(verifyLocalCatalogTestConnection({ query: async () => ({ rows: [{ ...actual, ...change }] }) }, config),
      code("PERMISSION_DENIED"));
  }
  assert.throws(() => new PostgresCatalogImportTransaction({ ...config,
    connection_string: "postgresql://catalog_d2b_owner@example.com:55440/catalog_receipts_d2b_test" }), code("INVALID_REQUEST"));
  assert.throws(() => new PostgresCatalogImportTransaction({ ...config, data_directory: "/tmp/catalog-d2b/data" }), code("INVALID_REQUEST"));
});

test("legacy target still verifies actual server identity and fails closed",
  { skip: !process.env.CATALOG_IMPORT_LEGACY_TEST_DATA_DIR }, async () => {
  const config = { connection_string: "postgresql://catalog_test_owner@127.0.0.1:55439/catalog_import_test",
    data_directory: process.env.CATALOG_IMPORT_LEGACY_TEST_DATA_DIR, template_version: "catalog-attributes-v1" };
  const valid = { db: "catalog_import_test", username: "catalog_test_owner", execution_user: "catalog_test_owner",
    server_version_num: 170011, host: "127.0.0.1", port: 55439,
    listens: "127.0.0.1", data_dir: config.data_directory,
    system_id: "7696341689079925702", rfq_schema: null };
  await verifyLocalCatalogTestConnection({ query: async () => ({ rows: [valid] }) }, config);
  for (const change of [{ system_id: "wrong" }, { data_dir: "/tmp/wrong" }, { port: 55440 },
    { execution_user: "catalog_import" }, { server_version_num: 170010 }, { rfq_schema: "rfq_private" }]) {
    await assert.rejects(verifyLocalCatalogTestConnection({ query: async () => ({ rows: [{ ...valid, ...change }] }) }, config),
      code("PERMISSION_DENIED"));
  }
});
