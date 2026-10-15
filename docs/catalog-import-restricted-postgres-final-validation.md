# Sprint 2.5-B4.5-D2-FIX1-B: restricted PostgreSQL integration validation

Review baseline: `main` at `840027f8ce6ffb029f695a79d1e2213b32af772d`. All pre-existing uncommitted D2 changes were preserved. No migration, production connection, public import route, RFQ permission change, commit, or push occurred. The only code change in FIX1-B extends the existing **synthetic PostgreSQL test** for independent role permissions, near-30-day replay behavior and the shared-role actor risk.

## Approved physical target and initial state

The existing test cluster was initially stopped. Before starting it, `pg_controldata` on the approved data directory reported system identifier `7696419892593432091` and a clean shutdown; port 55440 was free. It was started with Postgres.app 17.11 on loopback only. Authentication used the existing 0600 local pgpass without printing its secret. An actual authenticated connection then returned:

| Property | Observed |
| --- | --- |
| Address / port | `127.0.0.1/32` (`host(...) = 127.0.0.1`) / `55440` |
| Database | `catalog_receipts_d2b_test` |
| `session_user` / `current_user` | `catalog_d2b_owner` / `catalog_d2b_owner` |
| Data directory | `<approved local test workspace>/work/catalog-receipts-d2b-55440/data` (the original run checked the full server-reported path; the adapter now pins its digest) |
| `listen_addresses` | `127.0.0.1` |
| System identifier | `7696419892593432091` |
| Server version | `17.11 (Postgres.app)` |

The six B2 tables and receipt table existed with **zero rows**; both restricted lookup and maintenance functions existed; `rfq_private` was absent. The old 55439 cluster remained stopped. No migration was run.

## Final permission snapshot

All seven private tables have RLS; the receipt table also has `FORCE RLS`. Each of `anon`, `catalog_admin`, `catalog_import`, `catalog_receipt_lookup_owner`, `catalog_receipt_lifecycle_owner`, and `catalog_receipt_maintenance` was NOLOGIN, non-superuser, without BYPASSRLS or inherited membership. Actual privileges on the receipt table/functions were:

| Role | Direct receipt SELECT | Direct receipt DELETE | Restricted lookup EXECUTE | Maintenance EXECUTE |
| --- | --- | --- | --- | --- |
| `anon` | No | No | No | No |
| `catalog_admin` | No | No | No | No |
| `catalog_import` | No | No | **Yes** | No |
| `catalog_receipt_lookup_owner` | Six-column SELECT | No | Own function | No |
| `catalog_receipt_lifecycle_owner` | Due metadata SELECT | No | No | Own function |
| `catalog_receipt_maintenance` | No | No | No | **Yes** |

The four receipt policies are the import INSERT check, lookup-owner SELECT, lifecycle-owner SELECT of due committed/expired metadata, and lifecycle-owner UPDATE from due committed to expired. The lookup and purge functions are `SECURITY DEFINER`, owned by their dedicated non-superuser roles, with `search_path=pg_catalog, pg_temp`. The lifecycle RLS repair is present and did not replace the restricted lookup policy. No broad `catalog_import`/`catalog_admin` receipt SELECT policy, PUBLIC EXECUTE, or RFQ schema was observed.

The independent-login test created temporary synthetic **non-superuser LOGIN** roles, then used separate authenticated sessions and explicit role membership; it did not rely on a superuser merely invoking `SET ROLE`. It confirmed that `catalog_import` can call the restricted lookup but cannot directly SELECT/DELETE receipts or run maintenance; `catalog_admin`, anonymous, unrelated and maintenance callers cannot call the lookup; prohibited role switching fails; and a temporary table cannot redirect the schema-qualified lookup. The dedicated maintenance caller cannot directly read/update/delete receipt rows or modify products.

## Restricted full-import results

Both approved local suites now set `receipt_access_mode: "restricted_v1"` explicitly and check, before fixture writes, that the lookup function exists and the import/admin roles lack direct receipt SELECT. They use physical target validation on each adapter connection and before their fixture cleanup.

| Suite | Result | Relevant evidence |
| --- | --- | --- |
| `scripts/test-catalog-postgres-import.mjs` | **18/18 passed** | First draft and published imports, UUID allocation, SKU/translation/category-link/image relations, receipt creation, same-key replay, fingerprint conflict, no-op, stale version, SQL uniqueness, six write-stage rollback, timeouts, and lost-acknowledgement recovery. |
| `scripts/test-catalog-postgres-concurrency.mjs` | **17/17 passed** | Two-connection same SKU/key contention, one committed write, product/translation/category stale-update rejection, lock wait/release, disconnect/timeout rollback, receipt replay after later catalog changes, uniqueness, publication and retired rules. |
| `scripts/test-catalog-receipt-maintenance-postgres.mjs` | **12 stages passed** | Independent role logins, final ACL/RLS, `UPDATE RETURNING` repair, 90-day boundary, tombstones, restricted lookup, lock busy `55P03`, concurrent maintenance, rollback, 500+3 batches and indexed plan. |

The import adapter reads all six catalog tables. It writes products, variants, translations, product-category links and images; **category definitions are a synthetic pre-existing fixture and are referenced, not created by the import contract**. The tests check published product completeness and referential integrity. Receipt and catalog changes are committed in one transaction; injected product, variant, translation, category-link, image and receipt failures left neither partial catalog rows nor receipt rows. The category table is counted during cleanup and remained zero.

## Idempotency and lifecycle

The composite `(actor_id,idempotency_key)` key separates records for different actors and permanently prevents reuse of the same actor/key. Real import tests verified same actor/key/fingerprint replay and same-key/different-fingerprint conflict. Independent-login SQL tests verified that a shared `catalog_import` role can create another synthetic actor's receipt with the same key and query either known actor/key; this is a **residual database-level actor isolation risk**, not evidence of strict per-admin isolation. Application-level tests separately verify that authorized service code derives a fixed actor ID and rejects actor substitution; a real production administrator provider remains absent.

The database lookup uses `clock_timestamp() <= retry_until`; an inspection of the deployed function confirmed the inclusive predicate. Real PostgreSQL fixtures just inside and just outside 30 days returned `within_retry_window=true/false`, respectively; the offline receipt contract maps the true boundary to replay and the false boundary to `IDEMPOTENCY_KEY_EXPIRED`. A live clock cannot be reliably sampled at the exact equality microsecond, so **the exact 30-day instant was proven by the deployed operator and offline boundary test, not by a deterministic wall-clock execution**. This limitation does not change the database predicate.

The separate maintenance test proved the **exact** 90-day boundary with one PostgreSQL `statement_timestamp()` for insert and purge; equality was not purged, and strictly later rows were. It also verified the permanent actor/key/fingerprint/original timestamps, no resurrection of expired rows, a maximum batch of 500, idempotent repeat, the due-row index, lock-busy `55P03`, and rollback. The production maintenance scheduler is not implemented; no production cleanup ran.

`COMMIT_UNKNOWN` was exercised by **simulating a lost COMMIT acknowledgement** and reissuing the original actor/key/request over a new connection. The committed receipt was returned before a stale snapshot check, while changed content conflicted. This is not a real network partition or process-crash test. `restricted_v1` uses only the function query. Its absence or denied EXECUTE maps to `RECEIPT_ACCESS_UNAVAILABLE` before `writeCommitAttempted`; offline tests verify this mapping and no legacy fallback. The final database was not deliberately deprived of its approved function/grant, so this failure mapping was **not** injected end to end in PostgreSQL. No database grant was widened to make the suites pass.

## Cleanup and regression

Each integration suite cleaned its own synthetic catalog and receipt fixtures after revalidating the physical target. The independent-role test removed only its two named synthetic actors' receipts and its temporary logins. A final authenticated identity query again matched the approved physical target, showed **0 rows in all six catalog tables and the receipt table**, no temporary test logins, no RFQ schema, and receipt RLS/FORCE RLS still enabled. The test cluster was then stopped; the old cluster was not started or modified.

| Regression | Result |
| --- | --- |
| Complete catalog import, receipt/access, admin and lifecycle offline suite | **166/166 passed** |
| Mock catalog | 24 products, 48 SKUs, 8 collections valid |
| Search / filter / sort | Passed |
| Inquiry / RFQ / RFQ API | **24 / 31 / 29 passed** |
| TypeScript / lint / production build | Passed; 245 static pages generated |
| `git diff --check` | Passed |

The current branch remains `main`, HEAD remains `840027f8ce6ffb029f695a79d1e2213b32af772d`, and the pre-existing uncommitted D2 work is preserved. This stage changed only `scripts/test-catalog-receipt-maintenance-postgres.mjs` and added this report. Nothing was staged or committed.

## Acceptance recommendation and production blockers

**Recommend ending D2's isolated PostgreSQL integration-validation phase**: the previously missing end-to-end `restricted_v1` evidence is now present, both full suites pass under the final local permissions, the physical target and cleanup are verified, and the lifecycle/role tests remain green. This is a local technical acceptance recommendation, **not production approval**.

Production remains blocked by: real administrator authentication/directory and disablement handling; a separately reviewed non-owner production DB runtime identity and deployment of ordered immutable SQL migrations; explicit acceptance or redesign of the shared-role cross-actor threat model; an authorized import API that stays closed by default until review; a scheduled and monitored maintenance worker; all future catalog write paths following the same lock protocol; production-like connection-pool and permission tests; and real transport/process interruption recovery tests. The 30-day exact-instant and missing-function end-to-end cases have the bounded test evidence described above. RFQ permissions and production RFQ state were untouched.
