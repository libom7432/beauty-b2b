# Sprint 2.5-B4.5-D2 final security and integration review

Review baseline: `main` at `840027f8ce6ffb029f695a79d1e2213b32af772d`; `origin/main` is four commits behind. This review preserves the existing worktree. It performs no database migration, import, maintenance cleanup, production connection, commit, or push. The local PostgreSQL findings below distinguish earlier approved isolated-cluster tests from tests run in this final review.

## Decision

**D2 is not ready for unconditional closure or production activation.** The isolated database migration, restricted receipt access, lifecycle RLS repair, and synthetic PostgreSQL checks have been completed in earlier approved stages. The current import adapter still defaults to `legacy_direct`, and both 55440 import integration scripts omit `receipt_access_mode: "restricted_v1"`. After the restricted-access migration, `catalog_import` has no direct receipt SELECT, so these scripts' import requests should fail closed; the full import and concurrency suites have **not** been shown to pass against the final hardened permissions. Do not expand receipt grants to make them pass. Require an explicit restricted mode and rerun both suites in the verified isolated cluster in a separately approved write-test stage. The other production blockers below remain even after that test.

The next isolated business-design stage may proceed without enabling production import. Production deployment, a public/admin import route, and production SQL remain unapproved.

## Implemented scope and trust boundary

- B2 defines six catalog tables, foreign keys, uniqueness, deferred published-product completeness triggers, RLS, and six `catalog_public` read views. The committed B2 migration is unchanged in this worktree. Existing Mock catalog, Inquiry, RFQ route, and RFQ permissions are unchanged.
- B3/B4 provide product validation, CSV and Excel normalization, trusted snapshot, patch merge, deterministic dry run, and a mock transaction. The local PostgreSQL adapter reads all six tables, validates the physical local target, rechecks the snapshot after locking, writes product relations and receipt in one transaction, and allocates real UUIDs for new records.
- D2 aligns the receipt table name and lifecycle, adds a fixed single-key receipt lookup, a provider-neutral administrator authorization contract, a maintenance contract, and three independent incremental SQL drafts. No production authentication provider, production database adapter, import API, or maintenance scheduler exists.
- The `actor_id` in the normal service path comes from `requireCatalogPermission()` after an injected provider and private directory validate an active administrator and a specific `catalog.import.preview`, `catalog.import.commit`, or `catalog.import.receipt.read` grant. `commit` builds the branded transaction actor. Current providers in tests are fake; there is no deployed authentication or administrator registry. The brand and TypeScript types are process-level controls, not a database identity proof.

## Final migration order and consistency

| Order | Artifact | Function and state |
| --- | --- | --- |
| 1 | `supabase/migrations/20261013120000_create_catalog_foundation.sql` | Committed B2 foundation: six tables, roles, deferred triggers, RLS, public views. Unmodified. Executed only in approved local tests. |
| 2 | `docs/sql/catalog-import-receipts.draft.sql` | Receipt table, composite permanent key, 30/90-day checks, partial due index, FORCE RLS. Executed in the approved 55440 local cluster; remains a review draft outside the automatic migration directory. |
| 3 | `docs/sql/catalog-receipt-access-hardening.draft.sql` | Creates non-login, non-bypass lookup owner and single-key `SECURITY DEFINER` lookup; revokes broad import/admin direct SELECT, retains narrow import INSERT. Executed locally. |
| 4 | `docs/sql/catalog-receipt-lifecycle-maintenance.draft.sql` | Creates non-login lifecycle function owner and bounded purge function; revokes maintenance caller's direct table grants; only maintenance role can EXECUTE. Executed locally. |
| 5 | `docs/sql/catalog-receipt-lifecycle-rls-fix.draft.sql` | Extends only lifecycle owner's SELECT policy to due expired metadata so `UPDATE ... RETURNING` can see the new row. Executed locally after the original failure. |

Static review finds no duplicate CREATE target when run in this order. Each receipt draft has `BEGIN`/`COMMIT` and preconditions; the access and lifecycle steps require prior objects. The final repair changes no table columns, grants, function body, UPDATE `USING` or `WITH CHECK`, catalog object, or RFQ permission. Receipt `ENABLE` and `FORCE` RLS remain in force. The final policy set has no broad `catalog_import`/`catalog_admin` SELECT policy, no PUBLIC function EXECUTE, and no superuser/BYPASSRLS function owner. `catalog_receipt_lookup_owner` has a broad *row* SELECT policy but only a six-column SELECT grant; its fixed function returns one known key and an allowlisted result. A shared import role can still supply any actor/key to that function (see risk section).

These are **draft files**, not production migration entries. Before any production deployment, make separately reviewed immutable migration artifacts in the same order, verify target roles/permissions and rollback strategy, and do not replay the local fixture `scripts/catalog-import-local-receipts.sql` alongside the formal receipt migration. Some stage documents and SQL header comments still say a draft was “not executed”; that describes their original stage, not the later approved **local** execution. The final deployment runbook must distinguish historical stage notes from current local state. A production rollback must not DROP an existing receipt table or lose permanent tombstones.

## Current permission matrix after local incremental SQL

| Principal | Six private catalog tables | Receipt table | Receipt functions | RFQ |
| --- | --- | --- | --- | --- |
| `anon` / `PUBLIC` | No private-table access; `anon` reads six filtered `catalog_public` views | No direct access | No EXECUTE | Unchanged by D2 |
| `catalog_import` (NOLOGIN) | B2 SELECT, INSERT, UPDATE; no DELETE | Column-limited INSERT, no direct SELECT/UPDATE/DELETE | Single-key lookup EXECUTE; no purge | No new RFQ grant |
| `catalog_admin` (NOLOGIN) | B2 SELECT, INSERT, UPDATE, DELETE | No direct SELECT after hardening | No lookup or purge EXECUTE | No new RFQ grant |
| `catalog_receipt_lookup_owner` (NOLOGIN) | No catalog-write grant | SELECT of six lookup columns, RLS policy | Owns fixed lookup | No RFQ grant |
| `catalog_receipt_lifecycle_owner` (NOLOGIN) | No catalog-write grant | SELECT due-row metadata; UPDATE only `status,result,expired_at`, constrained by RLS | Owns fixed purge | No RFQ grant |
| `catalog_receipt_maintenance` (NOLOGIN) | No catalog-write grant | No direct SELECT/UPDATE/DELETE after step 4 | Purge EXECUTE only | No RFQ grant |
| `rfq_api` | No new catalog grant | Explicit optional revoke, no receipt grant | No EXECUTE | Existing RFQ rights unchanged |

The receipt table has RLS **and FORCE RLS**; B2's six base tables have RLS but not FORCE RLS. A future production runtime must be non-owner, non-superuser, without BYPASSRLS, with only reviewed role membership. NOLOGIN alone does not isolate administrators. The local 55440 database has no RFQ business schema, so RFQ table-level isolation was a static review, not a real permission test in that database. The local owner login is a test setup and is not an acceptable production runtime identity.

## Transaction and idempotency acceptance

The local adapter pins two physical test targets, checks actual server identity on each connection, uses one `PoolClient`, begins a bounded `READ COMMITTED` transaction, sets `catalog_import` locally, obtains transaction advisory lock `725604510131`, then locks the six tables in fixed order. It reads an existing receipt **before** snapshot comparison, so a committed same-key request can be replayed after later catalog edits. Otherwise it rereads the six-table snapshot, compares the expected digest, merges the full state, invokes B3 final-state validation, writes catalog records in foreign-key order, writes a five-field allowlisted receipt, and commits. Any pre-commit failure rolls back both business data and receipt. Database unique keys, foreign keys, RLS, and deferred publication triggers remain final guards. Other future catalog writers must adopt the same lock protocol; this has not been implemented or verified.

Receipt primary key `(actor_id,idempotency_key)` persists forever. The SHA-256 request fingerprint distinguishes same-key changed requests. The database sets `retry_until = completed_at + 30 days`; replay at the exact boundary is allowed, later replay returns `IDEMPOTENCY_KEY_EXPIRED`. Result body is retained until strictly after `result_purge_after = completed_at + 90 days`; expiry clears only the allowlisted JSONB result while preserving actor, key, fingerprint, original timestamps, and permanent tombstone. The 90-day deadline does not promise removal exactly on day 90: it needs a scheduled maintenance worker, which is absent.

`COMMIT_UNKNOWN` is not a failure verdict. Recovery requires the original actor, original normalized request, original key, and fingerprint. The original receipt is checked before a possibly stale snapshot. Existing local tests injected a lost commit acknowledgement and checked recovery over a new connection; they did **not** simulate a real production network split or deployment restart. A disabled administrator is denied by the current authorization contract; a controlled operational recovery path is not built.

**Restricted-mode integration gap:** `PostgresCatalogImportTransaction` accepts `receipt_access_mode?: "legacy_direct" | "restricted_v1"` and branches to direct SELECT whenever it is omitted. There is no catch-and-retry fallback from the restricted function to direct SELECT, and revoked direct SELECT makes the legacy branch fail closed in the hardened database. Nonetheless, both `scripts/test-catalog-postgres-import.mjs` and `scripts/test-catalog-postgres-concurrency.mjs` now pin port 55440 while omitting restricted mode. Their historical 18/17-test successes predate the final permission state; neither is evidence of end-to-end import under the five-step final SQL set.

## Lifecycle acceptance

The purge function validates `1..500`, tries the same catalog transaction advisory lock without waiting, and raises SQLSTATE `55P03` if busy. It samples PostgreSQL `statement_timestamp()` once per batch, selects only `status='committed' AND result_purge_after < cutoff`, sorts by deadline/actor/key, takes bounded row locks with `SKIP LOCKED`, updates only `status='expired', result=NULL, expired_at=cutoff`, and returns a count. The executor maps `55P03` to `CATALOG_RECEIPT_MAINTENANCE_BUSY`; an uncertain commit is reported separately and the fixed purge can be safely retried. The RLS repair permits the due post-update expired row to satisfy `UPDATE RETURNING` without widening the lookup role or making result readable to the maintenance caller. The partial due index supports the batch order in the earlier local `EXPLAIN`.

Earlier approved PostgreSQL validation on the exact 55440 test cluster covered independent non-superuser logins, the `UPDATE RETURNING` repair, exact and later-than-90-day boundaries, permanent fields, function ACL/RLS/FORCE RLS, 500+3 batch behavior, two maintenance connections, import-lock contention with `55P03`, rollback, temp-object resistance, restricted lookup, and cleanup to zero rows. The test script records 12 stages. This final review did not rerun database writes. There is no production scheduler, maintenance login/credentials, monitoring, or operational alerting.

## Cross-administrator access and remaining security boundary

Normal service authorization derives `actor_id` from an active admin directory and uses it for the receipt lookup, so ordinary clients cannot choose another actor through that helper. The shared `catalog_import` database role, however, can directly call `lookup_catalog_import_receipt(actor_id,key)` with **any syntactically valid actor ID** and known key; its receipt INSERT can likewise submit an arbitrary actor ID. The function's schema-qualified, parameterized query prevents SQL injection and bulk enumeration, but cannot authenticate a human actor from a shared login. Compromise/misuse of that service credential or privileged SQL path could read a targeted other actor's allowlisted receipt, including its identity map. Strict database-level cross-admin isolation is **not** achieved. Compensating controls are server-only credentials, application authentication/authorization, a fixed single-key function, revoked direct SELECT, and no public import endpoint; production implementations of authentication, runtime role, logging, rate limiting, and network isolation are still absent. Production approval requires explicit acceptance of this application-level threat model or a database-verifiable per-actor identity design.

## Test evidence and limits

| Area | Evidence in this review or earlier approved local stage | Still unverified |
| --- | --- | --- |
| B2 constraints and permissions | Earlier isolated PostgreSQL schema/role tests; deferred trigger and RLS checks | Production role/owner/pooler behavior |
| Receipt permissions and restricted lookup | Earlier independent non-superuser 55440 tests; lookup owner and effective grants checked | Production runtime grants; strict per-actor DB isolation is known absent |
| Import transaction / concurrency | Earlier isolated PostgreSQL B4.5-B2 18 and B3 17 synthetic tests under their then-current permissions | Full two-suite rerun after restricted migration; production multi-writer paths |
| `COMMIT_UNKNOWN` | Earlier synthetic lost-acknowledgement/new-connection recovery; current offline mock recovery | Real network partition, actual process crash and restart, production retry transport |
| Lifecycle and RLS repair | Earlier 12-stage real PostgreSQL 55440 synthetic test; this review's offline suite | Production scheduler, monitoring, 90-day service execution |
| Administrator authorization | This review's offline tests for anonymous, ordinary, disabled and underprivileged identities; stable actor binding | Real identity provider, account directory, deactivation race, production route |
| B3 through B4.5-A / receipt offline | **163/163 passed** in this review | Does not prove SQL permissions or actual PostgreSQL transaction behavior |
| Mock/search/filter/sort | 24 products, 48 SKUs, 8 collections; respective scripts passed | Live DB-backed storefront is not connected |
| Inquiry / RFQ / RFQ API | **24 / 31 / 29 passed**, respectively, in this review | No production RFQ write performed; no E2E browser run requested |
| TypeScript / lint / production build | All passed; 245 static pages generated | Deployment and production credentials |

`git diff --check` and staged diff check passed. No PostgreSQL write test, maintenance task, migration, or database status query was run in this final stage.

## Git change inventory and hygiene

At review start there were **10 modified tracked files, 20 untracked files, and no staged files**. `main` is four commits ahead of `origin/main`. This review adds only this untracked document; the full list for a future explicit staging decision is:

| Stage | Files |
| --- | --- |
| D2-A receipt contract/name | `docs/catalog-database-security-review.md`, `docs/catalog-import-transaction-contract.md`, `docs/catalog-postgres-import-adapter.md`, `docs/sql/catalog-import-receipts.draft.sql`, `docs/catalog-import-receipts-compatibility.md`, `src/lib/catalog-import/receipt.ts`, `src/lib/catalog-import/transaction.ts`, `package.json`, `scripts/catalog-import-local-receipts.sql`, `scripts/test-catalog-receipt-contract.mjs` |
| D2-B isolated target / import tests | `docs/catalog-receipts-d2b-isolation.md`, `src/lib/catalog-import/postgres.ts`, `scripts/test-catalog-postgres-import.mjs`, `scripts/test-catalog-postgres-concurrency.mjs` |
| B4 actor isolation and identity | `docs/catalog-receipt-actor-isolation-review.md`, `docs/catalog-receipt-identity-architecture-decision.md`, `docs/catalog-admin-auth-foundation.md`, `src/lib/catalog-import/admin-auth.ts`, `scripts/test-catalog-admin-auth.mjs` |
| B4 restricted access | `docs/catalog-receipt-access-hardening.md`, `docs/sql/catalog-receipt-access-hardening.draft.sql`, `src/lib/catalog-import/receipt-access.ts`, `scripts/test-catalog-receipt-access.mjs` |
| C1/C2 lifecycle and RLS | `docs/catalog-receipt-lifecycle-maintenance.md`, `docs/catalog-receipt-lifecycle-sql-review.md`, `docs/catalog-receipt-lifecycle-rls-review.md`, `docs/sql/catalog-receipt-lifecycle-maintenance.draft.sql`, `docs/sql/catalog-receipt-lifecycle-rls-fix.draft.sql`, `src/lib/catalog-import/receipt-maintenance.ts`, `scripts/test-catalog-receipt-maintenance.mjs`, `scripts/test-catalog-receipt-maintenance-postgres.mjs` |
| Final review | `docs/catalog-import-d2-final-review.md` |

The changed/untracked paths are within catalog code, synthetic tests, SQL drafts and catalog documentation. There are no RFQ source, production connection config, or B2 migration diffs. The local `work/` test cluster and protected pgpass are ignored and not staged; no database data directory, backup, build output, or temporary log appears in Git status. A pattern scan over catalog docs/code/scripts found no hardcoded production credentials, private keys, or password-bearing PostgreSQL URLs. Broad repository scanning matched three existing RFQ test/guard scripts containing credential *patterns/fixtures*; they are unchanged and outside this diff. No real customer or supplier data was found in changed files. This scan is a review aid, not a secret-scanning service guarantee.

Suggested future commit split, **after** the integration gap and documentation drift are reviewed: (1) D2-A receipt naming/lifecycle contract and tests; (2) local target adaptation and real-import test updates; (3) admin identity contract and restricted access SQL/code/tests; (4) lifecycle SQL/code/tests plus RLS repair; (5) stage documentation and this final review. Stage explicit paths only. Do not commit partial migration order, deploy drafts, or include `work/`.

## Production blockers and next decision

1. Make `restricted_v1` explicit/required for the hardened target; rerun the import and concurrency PostgreSQL suites against the approved isolated instance with all five migration steps. Do not restore direct SELECT.
2. Select and implement the real administrator identity provider, private admin directory, disablement/authorization race handling, and server-only production runtime login with reviewed grants. The current fake provider and local owner login are test facilities.
3. Obtain explicit acceptance of application-level actor isolation or design stronger database-verifiable actor identity. The shared role can still call the lookup with another known actor/key.
4. Convert the receipt/access/maintenance/RLS repair drafts into separately reviewed deployable incremental migrations with environment preflight and safe forward recovery. Do not overwrite B2 or delete receipt tombstones.
5. Implement an authorized, monitored maintenance runner and separately approved production import entry point, both default closed until security acceptance. Preserve RFQ separation.
6. Test production-like connectivity/pooling, restricted lookup under the actual runtime role, multiple writers using one lock protocol, account revocation races, real interruption/restart recovery, failure rollback, and operational retention. Prior local tests do not prove those scenarios.

Recommendation: keep D2 under **conditional technical review** rather than mark it fully accepted. The next business stage can continue with isolated offline work, while production import and migrations remain blocked pending separate human approval and the items above.
