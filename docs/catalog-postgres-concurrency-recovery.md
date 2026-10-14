# Sprint 2.5-B4.5-B3: PostgreSQL concurrency and recovery

## Scope and test target

Starting branch `main`, HEAD `4b9b7b479162ffb02bff082b3ff7663e7f1bb2a1`, clean worktree. This stage adds a dedicated integration suite without changing the B2 schema or the B4.5-B2 SQL adapter. Tests use synthetic catalog data only. The test script requires explicit opt-in and verifies the **actual** connection to `catalog_import_test`, `catalog_test_owner`, `127.0.0.1:55439`, the pinned Postgres.app data directory and system identifier, and the absence of `rfq_private`. The adapter repeats this preflight on each acquired connection. Cleanup repeats it immediately before `TRUNCATE`.

Run only after starting the previously verified, disposable Postgres.app 17 cluster:

```sh
CATALOG_IMPORT_TEST_ENABLE=1 \
CATALOG_IMPORT_TEST_DATABASE_URL=postgresql://catalog_test_owner@127.0.0.1:55439/catalog_import_test \
CATALOG_IMPORT_TEST_DATA_DIR=/Users/mima0000/Documents/Codex/2026-10-13/sprint-2-5-a-beauty-b2b/work/catalog-postgres-b1-55439/data \
npm run test:catalog-postgres-concurrency
```

The script is intentionally destructive **only** within this validated disposable database. It removes its own synthetic rows at the end. It neither initializes nor migrates a database. No production connection string, real customer data, RFQ table, or public import API is involved.

## Multi-connection and lock behavior

Two adapter instances exercise separate PostgreSQL connections. Concurrent attempts to create the same global SKU leave one product, one SKU and one receipt; the other request fails with `SNAPSHOT_STALE` after the first commit. Competing updates to one product, one translation, and one category association likewise admit one commit and reject the stale request. The original product UUID remains unchanged; the published category set retains exactly one primary association. These tests establish the outcome under the existing global advisory lock and fixed table-lock order, while database unique constraints remain the last defense against duplicate SKU or product code.

A separate connection holds advisory lock `725604510131` while an import waits. Releasing or disconnecting the holder permits one import to finish. Exceeding the bounded wait returns `TRANSACTION_TIMEOUT` without a product or receipt; retrying the same request and key after release succeeds. PostgreSQL releases transaction-level advisory locks on commit, rollback, and connection loss. One test terminates a writer backend during a synthetic slow product insert and verifies no partial write or receipt remains; the same key can then succeed. A transaction deadline likewise rolls back and permits a same-key retry.

The global lock is a protocol for **every future catalog writer**. Table locks protect the import transaction against ordinary concurrent writes while it runs, but management endpoints that ignore this protocol can still create application-level conflicts outside the import window. No such endpoint is added here.

## Idempotency and uncertain outcomes

Two concurrent requests with the same actor, key and fingerprint produce one commit and one replay of the persisted result. The same key with different content returns `IDEMPOTENCY_CONFLICT` and cannot produce a second product. A request replayed after a later product update returns its **original** receipt and snapshot version, without rerunning writes or rejecting the replay because the current snapshot has changed. A simulated client response deadline is handled by retrying the same key.

B4.5-B2 also injects a lost `COMMIT` acknowledgement: the adapter returns `COMMIT_UNKNOWN`, then the original actor, request and key replay the committed receipt. `COMMIT_UNKNOWN` does **not** mean the transaction failed. A caller must never switch to a new key in response; it must retry the original request and inspect the receipt outcome. A future service boundary should expose this as a distinct recoverable state and preserve the original key across client retries.

The local receipt is written in the same PostgreSQL transaction as the six catalog tables. Injection at product, variant, translation, category link, image, and receipt writes leaves both catalog state and receipt state unchanged. After a confirmed timeout or killed backend, a same-key retry is safe because the failed transaction left no committed receipt. The local test script removes receipts on cleanup. Production retention, anti-replay after expiry, and a formal migration remain unimplemented.

## Data integrity checks

The suite checks unchanged product/SKU UUIDs across updates, global SKU and product-code uniqueness at the database level, absence of orphan product relations or cross-product image/SKU links, correct SKU-specific image relation, bilingual published content, a single valid primary category, published SKU and main image, and the prohibition on import-driven reactivation of a retired product. B3 final-state validation, B2 deferred publication triggers, foreign keys, unique indexes and RLS remain the authoritative guards. Existing B4.5-B2 tests cover the full published import and direct RFQ/anonymous catalog permission denials.

## Results and remaining risk

The B4.5-B3 suite passed **17 tests** against the verified isolated database. The B4.5-B2 suite passed **18 tests**, including ambiguous commit recovery and each write-stage rollback. Complete regression results are recorded in the handoff report. The test cluster is stopped after verification.

This is preparation for B4.5-D security acceptance, not production readiness. B4.5-D should review a formal idempotency migration, authenticated service-only connections, receipt retention and anti-replay, audit logging, uniform lock use across all future writers, authorization and rate limits for any future import API, and recovery from an uncertain commit across a real process restart. The current adapter is pinned to the isolated local cluster and cannot connect to production Supabase.
