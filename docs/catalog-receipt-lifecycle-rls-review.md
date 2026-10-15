# Sprint 2.5-B4.5-D2-C2-B1: receipt lifecycle RLS repair review

## Scope and observed failure

This is a **design draft only**. No migration, permission change, or maintenance call was made in B1. Read-only diagnostics used the previously approved local Postgres.app 17.11 target at `127.0.0.1:55440`, database `catalog_receipts_d2b_test`, login `catalog_d2b_owner`, data directory `work/catalog-receipts-d2b-55440/data`, system identifier `7696419892593432091`. All nine live identity values matched before object inspection. The six catalog tables and receipt table had zero rows. The prior B-stage synthetic `INSERT` plus purge was rolled back on `new row violates row-level security policy`; it left no test data.

The live table has RLS and FORCE RLS enabled. The maintenance function is `SECURITY DEFINER`, owned by `catalog_receipt_lifecycle_owner` (`NOLOGIN`, non-superuser, no `BYPASSRLS`), with `search_path=pg_catalog,pg_temp`. Its EXECUTE ACL names only that owner and `catalog_receipt_maintenance`; the latter has no direct receipt SELECT, UPDATE, or DELETE. No trigger is attached to the receipt table. The function owner has SELECT only on `actor_id`, `idempotency_key`, `status`, and `result_purge_after`; UPDATE only on `status`, `result`, and `expired_at`; no INSERT, DELETE, or SELECT on `result`. No role membership was observed for either maintenance role.

## Actual policies and cause

All four live policies are **PERMISSIVE**. They apply to distinct roles; a role's policies are not a universal OR across other roles.

| Policy | Command / role | Current condition |
| --- | --- | --- |
| `catalog_import_receipts_insert` | INSERT / `catalog_import` | `WITH CHECK status='committed' AND result IS NOT NULL` |
| `catalog_receipt_lookup_owner_read` | SELECT / `catalog_receipt_lookup_owner` | `USING true`, for the separate restricted lookup owner |
| `catalog_receipt_lifecycle_owner_read` | SELECT / `catalog_receipt_lifecycle_owner` | `USING status='committed' AND result_purge_after < statement_timestamp()` |
| `catalog_receipt_lifecycle_owner_expire` | UPDATE / `catalog_receipt_lifecycle_owner` | `USING status='committed' AND result_purge_after < statement_timestamp()`; `WITH CHECK status='expired' AND expired_at > result_purge_after` |

The purge function selects due `committed` rows, then runs `UPDATE ... SET status='expired', result=NULL, expired_at=v_cutoff ... RETURNING 1`. The old row passes both the SELECT and UPDATE `USING` predicates. The new row passes the UPDATE `WITH CHECK` predicate: the synthetic row was 91 days old, so `v_cutoff > result_purge_after`. It **fails the SELECT policy** because its new status is `expired`. PostgreSQL checks SELECT RLS on an updated row returned by `RETURNING` and throws rather than silently omitting it. This exactly explains the observed `new row violates row-level security policy` error. [PostgreSQL 17 CREATE POLICY](https://www.postgresql.org/docs/17/sql-createpolicy.html) documents the post-update SELECT check for `RETURNING`.

There is no trigger to explain the error. The table's status/result/expired-time CHECK accepts the proposed expired row, and the deadline CHECK still defines `result_purge_after = completed_at + interval '90 days'`. The failure was RLS, not the deadline or table CHECK.

## Minimal incremental repair

`docs/sql/catalog-receipt-lifecycle-rls-fix.draft.sql` alters **only** `catalog_receipt_lifecycle_owner_read` after strict preflight of the observed function, policy, owner, and FORCE RLS state. The repaired SELECT policy allows due rows whose status is either `committed` or `expired`. The unchanged UPDATE `USING` still limits source rows to due `committed` receipts; its unchanged `WITH CHECK` limits target rows to `expired` with `expired_at > result_purge_after`. The function remains the only public-to-maintenance path, keeps the global nonwaiting advisory lock and 500-row bound, and returns only a count. The draft is transactional and leaves FORCE RLS enabled.

There is **no GRANT or REVOKE change**, no new column privilege, no INSERT/DELETE policy, no change to `restricted_v1`, and no change to the function body. The effective SELECT row set for the private, NOLOGIN function owner expands to due expired tombstone **metadata**. It still cannot SELECT `result`. This is the precise permission delta and a residual scope increase that must be verified with an independent non-superuser login in B2. We intentionally avoid `WITH CHECK (true)`: the existing narrow check is already correct. A direct UPDATE by the ordinary maintenance caller remains denied.

## Lifecycle guarantee matrix

| Requirement | Current enforcement after proposed repair | Limit |
| --- | --- | --- |
| Due committed → expired | Function predicate, UPDATE `USING` and `WITH CHECK`, RLS SELECT repair | Requires real PostgreSQL retest; currently broken until approved repair executes. |
| Before or exactly 90 days cannot clear | Stored `result_purge_after`, strict `<` in function and both RLS source checks | Database `statement_timestamp()` is authoritative. |
| Expired cannot return to committed | UPDATE `USING` excludes expired; ordinary roles have no direct UPDATE; fixed function only expires | Table CHECK alone does not forbid privileged resurrection. |
| Cleared result cannot be restored | Expired-row CHECK requires `result IS NULL`; no UPDATE path for expired via maintenance owner | A privileged table owner could update status and result together. |
| Actor, key, fingerprint and original deadlines unchanged | Function updates only status/result/expired_at; owner has no UPDATE grants on those fields; composite key and deadline CHECKs | No immutable-column trigger exists; table owner/superuser can override. |
| Original key cannot be imported again | Permanent `(actor_id,idempotency_key)` primary key, no DELETE grant to import/maintenance roles | A privileged owner can delete a row; retention requires operational controls. |
| No receipt deletion by maintenance | No DELETE grant or DELETE policy for either maintenance role | Superuser/table owner remains privileged. |
| `restricted_v1` lookup and COMMIT_UNKNOWN recovery | Separate lookup policy/function unchanged; 30-day replay and 90-day result fields unchanged | Must regress against the repaired policy in PostgreSQL. |

## B2 isolated PostgreSQL validation plan

1. Reverify all nine physical target identifiers with the protected pgpass, require zero synthetic rows, and save policy/ACL/function snapshots. Check the independent draft against the live baseline and use `ON_ERROR_STOP` with its explicit transaction. Never modify the already executed migrations.
2. Confirm the new SELECT policy, unchanged UPDATE/INSERT policies, unchanged column grants and function ACL, RLS/FORCE RLS, NOLOGIN and no BYPASSRLS. Use separate real non-superuser login sessions; `SET ROLE` alone is insufficient.
3. Insert clearly tagged synthetic receipts only. Verify due `committed → expired` succeeds, while 30-day recovery remains available, before/exactly 90 days remain committed, and strictly older rows clear. Verify tombstone fields, original timestamps, uniqueness, repeat calls, 500-row batches, multiple batches and rollback.
4. Test ordinary maintenance caller direct SELECT/UPDATE/DELETE denial, private-owner effective row visibility and column limits, unauthorized EXECUTE denial, no catalog/RFQ privilege expansion, `restricted_v1`, advisory-lock `55P03`, concurrent calls and COMMIT_UNKNOWN behavior. Use `EXPLAIN` on synthetic data without index DDL.
5. Reverify physical target before cleanup; remove **only** B2 synthetic rows and temporary test logins, retain schemas and receipts table, then confirm all seven business/receipt tables are empty and RFQ schema absent. Run the full offline regression separately.

Production blockers remain the unexecuted RLS repair, its real PostgreSQL validation, dedicated production maintenance identity/scheduler, formal admin authentication, and the already documented shared-import-role cross-actor limitation. The production import API remains closed.
