# Sprint 2.5-B4.5-D2-FIX1-A: restricted receipt mode alignment

Baseline: `main` at `840027f8ce6ffb029f695a79d1e2213b32af772d`. All pre-existing D2 worktree changes are preserved. This stage changes local adapter behavior and tests only; it performs no PostgreSQL connection, migration, import, or maintenance cleanup.

## Root cause and callers

The final receipt access migration revoked `catalog_import`'s direct `SELECT` on `catalog_private.catalog_import_receipts` and exposed the fixed `catalog_private.lookup_catalog_import_receipt(text,text)` function. `PostgresCatalogImportTransaction.execute()` previously used the restricted function only when `receipt_access_mode === "restricted_v1"`; an omitted value selected the direct-query branch. Both PostgreSQL import suites targeted the new 55440 cluster but omitted that setting. Thus their prior success did not prove a full import under the final hardened permissions. A direct query after hardening should fail closed, not silently succeed.

Repository call-site review found one direct receipt lookup in `postgres.ts`, the restricted query builder in `receipt-access.ts`, and two `new PostgresCatalogImportTransaction(config)` integration suites: `scripts/test-catalog-postgres-import.mjs` and `scripts/test-catalog-postgres-concurrency.mjs`. `scripts/test-catalog-receipt-contract.mjs` constructs the adapter without connecting. No catalog import API or production adapter exists. `verifyLocalCatalogTestConnection()` has an old 55439 default for a *read-only identity check*; it is not a receipt access default. Historical stage documents mentioning a legacy default describe the earlier rollout, not the corrected current code.

## Alignment

- Omitted `receipt_access_mode` now resolves to `restricted_v1`. The selected mode is fixed at construction; lookup failure never triggers another query in the old mode.
- `legacy_direct` remains an **explicit** mode only for the pinned older local 55439 test target. It is rejected for the hardened 55440 target. This preserves the old test path without offering a production or new-cluster downgrade. The old cluster may still have an incompatible prior receipt table name, so this is a guarded compatibility path, **not** a claim that historical integration tests can run unchanged.
- Missing/inaccessible restricted lookup objects (PostgreSQL `42883`, `42501`, `3F000`, `42P01`) map to the stable `RECEIPT_ACCESS_UNAVAILABLE` error. The failure is raised before the commit attempt; the transaction rolls back and it is not reported as `COMMIT_UNKNOWN`. Other SQL errors keep their prior mapping. Database messages and connection details are not exposed in this error.
- Both 55440 integration suites now explicitly request `restricted_v1`. After physical target verification and before any synthetic writes, they check that the lookup function exists and neither `catalog_import` nor `catalog_admin` has direct receipt `SELECT`, including column-level grants. The SQL migration, RLS, lifecycle, RFQ, and production configuration are unchanged.
- The existing suites already cover first import, six-table atomicity, same-key replay, changed-request conflict, simulated lost commit acknowledgement and recovery, write-stage rollback, and two-connection concurrency. Their **new restricted-mode execution has not happened in FIX1-A**. The inclusive 30-day boundary and expired-key behavior are covered by offline receipt tests; FIX1-B must verify them against PostgreSQL database time.

## Offline checks

New tests check the default, explicit legacy selection, 55440 rejection of legacy mode, restricted SQL selection, absence of a direct-query fallback, missing-function/permission SQLSTATE mapping, pre-commit error classification, and both integration suites' hardened preflight configuration. The tests do not substitute for real SQL execution.

| Check | Result |
| --- | --- |
| B3 through B4.5-A and D2 receipt/access/admin/lifecycle offline suites | 165 passed, 0 failed |
| Mock catalog | 24 products, 48 variants, 8 collections; valid |
| Search, filter, sort | Passed |
| Inquiry / RFQ / RFQ API | 24 / 31 / 29 passed |
| TypeScript, lint, production build | Passed; build generated 245 static pages |
| `git diff --check` | Passed |

No real PostgreSQL import, receipt update, or migration was run in this stage.

## D2-FIX1-B isolated PostgreSQL plan

1. Require separate authorization for database write tests. Before any SQL beyond identity inspection, authenticate with the protected local pgpass and compare actual `inet_server_addr()`, `inet_server_port()`, `current_database()`, `session_user`, `current_user`, `data_directory`, `listen_addresses`, `pg_control_system().system_identifier`, and PostgreSQL 17.11 against the approved **127.0.0.1:55440 / `catalog_receipts_d2b_test` / `catalog_d2b_owner` / system identifier `7696419892593432091`** target and its pinned physical directory. Reject a mismatch. Recheck before cleanup. Do not connect to Supabase.
2. Inventory the six catalog tables, receipt table, restricted function, RLS/FORCE RLS, role grants, and absence of RFQ schema. Confirm baseline synthetic row counts and distinguish any pre-existing data before cleanup. Test direct receipt SELECT and lookup EXECUTE with independent non-superuser logins, not only owner `SET ROLE`. The two integration suites must fail preflight if the hardening migration is absent.
3. Run the updated 55440 import suite with `restricted_v1`. Verify first draft/published creation, all six-table relations, real UUIDs, no direct receipt SELECT, original-request replay, fingerprint conflict, no-op, failure rollback, SQL uniqueness, and simulated `COMMIT_UNKNOWN` recovery under the same actor/key. Inject a missing-function case in a disposable transaction or controlled test setup and confirm `RECEIPT_ACCESS_UNAVAILABLE`, rollback, and no legacy query; do not alter the accepted migration or restore direct SELECT.
4. Run the updated two-connection concurrency suite. Confirm one write per key, stale-version rejection, lock timeout, connection-loss recovery, receipt/business atomicity, and no lost updates. Verify the receipt function remains the lookup path on both connections.
5. Use clearly labeled synthetic receipts and PostgreSQL time to test within the 30-day window, the `<= retry_until` boundary contract, strictly past 30 days, 90-day result retention, expired-key rejection, and permanent `(actor_id,key)` tombstone. Exact clock equality is difficult with `clock_timestamp()`; document the SQL predicate plus controlled database-time evidence rather than claiming an unachievable wall-clock instant test.
6. Reverify physical identity before deleting **only** this run's synthetic data and temporary test roles; retain schemas and tombstones outside the test fixture. Confirm zero fixture rows and no RFQ object or permission change. Report any incomplete test as unverified; do not widen grants to force a pass.

The shared `catalog_import` role can still supply another known actor/key to the restricted function. This residual database-level isolation risk and the absence of a real administrator provider, production adapter, and production import API remain outside FIX1-A.
