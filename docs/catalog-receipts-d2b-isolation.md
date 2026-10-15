# Sprint 2.5-B4.5-D2-B1: isolated receipt test environment

## Scope

Prepared from `main` at `840027f8ce6ffb029f695a79d1e2213b32af772d` with the D2-A worktree preserved. No database was created, started, connected, or migrated in B1. No production Supabase configuration or RFQ permission was changed.

## Planned physical target and approval gate

| Property | Exact planned value |
| --- | --- |
| PostgreSQL | local Postgres.app 17, separate cluster |
| Host and listener | `127.0.0.1` only |
| Port | `55440` |
| Database | `catalog_receipts_d2b_test` |
| Cluster owner / test connection user | `catalog_d2b_owner` |
| Data directory | `<approved local test workspace>/work/catalog-receipts-d2b-55440/data` (actual path verified against the fixed directory digest and server-reported `data_directory`) |
| System identifier | **UNAPPROVED / absent until the new cluster exists** |

The code's target list is finite and exact; the D2-B entry has a null system identifier. Construction and actual-connection checks reject it before querying until a human compares `pg_controldata` and `pg_control_system()` and approves the observed value. D2-B2 must make a separate reviewed code change to pin that value. It must also update the local SQL's physical guard and the PostgreSQL test scripts before running them. A supplied environment variable or claimed data directory never substitutes for checking the server's actual database, `session_user`, host, port, listener, data directory, system identifier, and absence of `rfq_private`. The existing port-55439 target remains pinned to its existing identity; it is not a D2-B migration target.

The proposed directory is under the task's test work area and was absent during B1 review. The old cluster remains separate and untouched. D2-B2 should generate only synthetic fixtures and must not copy an old database or any production content. Local `trust` authentication, if used, is valid only for the disposable loopback test cluster and cannot establish production authentication safety.

## D2-B2 initialization and disposal sequence

1. Recheck that the port and proposed directory are unused. Create a new Postgres.app cluster under the exact directory, with a loopback-only listener and a dedicated test database. Record the real path, ownership, PostgreSQL version, and system identifier. Do not reuse the old cluster or its receipt table.
2. Obtain human confirmation of the observed system identifier and target tuple; pin the approved identifier in the adapter and local SQL guards. Test a wrong identifier, directory, database, port and role before any migration or cleanup.
3. Initialize the B2 prerequisites in this new cluster only: a synthetic `anon` NOLOGIN role, then the unchanged B2 catalog foundation. Check six tables, role attributes and absence of `rfq_private` and either receipt table before applying a separately approved receipt migration. B2 itself requires `anon`; it does not create an RFQ role.
4. Execute the approved receipt SQL with `psql -X -v ON_ERROR_STOP=1` only after actual-connection and physical-instance checks. The SQL draft alone does not contain a physical target guard. Verify that its transaction either creates all objects or none. Run role-specific and lifecycle tests before synthetic import tests.
5. For every destructive fixture reset, verify the same physical identity again immediately before the operation. On final disposal, prove the exact database, real data directory, listener, owner and system identifier, stop this cluster, then remove only the approved dedicated directory. Never delete the old cluster. Do not log credentials or imported bodies.

## Receipt schema and adapter compatibility

`catalog_private.catalog_import_receipts` matches the adapter's SELECT and INSERT columns. The adapter writes `actor_id`, `idempotency_key`, 64-hex fingerprint, `status='committed'`, allowlisted `result`, `completed_at`, `retry_until` and `result_purge_after`; the draft supplies `created_at` by default. It reads fingerprint, status, result and the database-computed `clock_timestamp() <= retry_until` flag. The `expired` row has a null result and the reader rejects reuse. A different fingerprint conflicts before expiry evaluation. The application error union contains `IDEMPOTENCY_KEY_EXPIRED`. No application cleanup UPDATE exists yet.

The D1 draft and local fixture use a composite primary key, due-row index, 30/90-day checks, `ENABLE` and `FORCE` RLS, import SELECT/INSERT, admin SELECT, and narrow maintenance SELECT/UPDATE. Neither grants DELETE. They define no `SECURITY DEFINER` function. The local fixture now conditionally revokes receipt access from `rfq_api`, emitting a notice when that role is absent; it neither creates the role nor grants RFQ access. This is not a test of RFQ table privileges because the isolated database has no RFQ tables. The local fixture is still pinned to the **old** physical cluster and must not be executed for D2-B until its guard is updated and separately reviewed.

## Actor boundary and production blocker

`catalog_public` is a schema, not a role; `anon` and `catalog_public_reader` must not read private receipts. The adapter receives a server-verified actor object, uses its `actor_id` in the receipt lookup, and rejects a forged role object. Tests must use actual non-superuser role contexts and check effective memberships, `SET ROLE`, RLS and grants. The local DDL owner is privileged and its successful queries are not permission evidence.

The current `catalog_import` role can SELECT all receipt rows, including other actors' records; application-level `WHERE actor_id=$1` does not provide database-level actor isolation. **This blocks production approval.** A later design could remove direct receipt SELECT and expose a narrowly reviewed server-only accessor with authenticated actor binding, but a client-set session variable or unreviewed `SECURITY DEFINER` function is not sufficient. Do not widen existing grants to work around this issue.

## 90-day maintenance design — not executable in B1

A dedicated authenticated maintenance service may assume only `catalog_receipt_maintenance` (NOLOGIN, NOINHERIT, no BYPASSRLS). Within one bounded transaction, it verifies the target, acquires the catalog transaction-level advisory lock **before** receipt row locks, and selects a bounded batch where `status='committed'` and `result_purge_after <= transaction_timestamp()`. It locks those rows in stable `(result_purge_after, actor_id, idempotency_key)` order. It updates only `status='expired'`, `result=NULL`, and `expired_at=clock_timestamp()`; it leaves actor, key, fingerprint, deadlines and the primary key intact. A failed transaction rolls back all rows. Repeated execution skips already-expired rows. The advisory lock serializes maintenance with import; the row lock and PK remain database protections. No ordinary import role receives UPDATE or DELETE on receipts.

The worker returns only row counts and stable job/error codes. Logs must omit actor IDs, idempotency keys, fingerprints, receipt JSON, connection details and SQL parameters. Rate, batch size, lock timeout and retention monitoring require D2-B2 testing. Until this worker is implemented and validated, 90-day result removal is a policy design, not an operational guarantee.

## Required D2-B2 checks

- Migration success and intentionally failed migration rollback in a disposable schema/cluster; exact object and role inventory before/after.
- Receipt PK, unique conflicts, index, RLS, column grants, role inheritance and `NOLOGIN`; authorized import/admin/maintenance behavior and anonymous/unauthorized denials under non-superuser role contexts.
- Database-clock 30-day boundary and expiry, 90-day due boundary, repeated maintenance, permanent tombstone, same-key conflict and cross-process replay; no host-clock modification.
- Two-connection same-key races, `COMMIT_UNKNOWN`, six-table atomic rollback, connection loss and identity-mismatch refusal before any write or cleanup.
- Static RFQ grant comparison only in this RFQ-free cluster; actual RFQ table permission validation belongs to a separately authorized environment.

No new receipt SQL or database-dependent D2-B2 test ran in B1. The D1 draft remains outside the automatic migration directory. Production migration and public import API remain disabled.

## D2-B2-B1 identity lock update

The user confirmed the new cluster's system identifier as `7696419892593432091`. A fresh read-only SQL query on `catalog_receipts_d2b_test` returned `127.0.0.1:55440`, `session_user=current_user=catalog_d2b_owner`, the exact planned data directory and loopback listener, PostgreSQL 17.11, and the same identifier. Only the four built-in schemas exist; no catalog, RFQ or receipt table exists yet. The old 55439 target remains in the adapter's fixed list with its original system identifier, but the B2 integration scripts now accept only the new 55440 target.

The adapter and local-only receipt SQL now pin the new identifier and directory. Neither accepts arbitrary hosts, ports, database names, users or data directories. Integration tests pass the target configuration to every identity check, including fixture cleanup. The local SQL is still not approved for execution in B1. Its optional `rfq_api` branch records a skip when the role is absent; no RFQ role or privilege is created. The SQL draft in `docs/sql/` remains the formal review artifact.

The required local execution order for a later approved stage is: verify physical target; create the synthetic `anon` prerequisite role; apply the unchanged B2 catalog foundation; inventory six catalog tables and roles; recheck actual target identity and absence of receipts; apply the reviewed receipt SQL in one transaction; verify receipt constraints and effective roles; then run synthetic integration tests. A failed receipt transaction must leave neither table nor maintenance role. No step in that order was executed in D2-B2-B1.

The 30-day replay window, 90-day result retention and permanent tombstone design remain unchanged. The maintenance worker remains unimplemented and unexecuted. `catalog_import` can still read another actor's receipt directly at the database level, so production enablement remains blocked pending a separately reviewed actor-isolation design.
