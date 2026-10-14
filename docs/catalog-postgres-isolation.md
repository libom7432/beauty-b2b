# Sprint 2.5-B4.5-B1: isolated PostgreSQL verification

## Actual local environment (2026-10-14)

- Branch `main`; starting HEAD `5d438b56a89ce1444d6959f7745c804e765593f0`; worktree clean before this stage.
- Docker CLI and Colima are installed, but the Docker daemon / Colima VM was stopped. Supabase CLI was unavailable. No system software was installed.
- Existing Postgres.app 17.11 binaries were used to initialize a **new cluster**, separate from the RFQ test instance on port 5432.
- Database: `catalog_schema_test`; owner: `catalog_test_owner`; host: `127.0.0.1`; port: `55439`; `listen_addresses=127.0.0.1`.
- Cluster data: `/Users/mima0000/Documents/Codex/2026-10-13/sprint-2-5-a-beauty-b2b/work/catalog-postgres-b1-55439/data`. The cluster has only synthetic catalog fixtures and no `rfq_private` schema. No Supabase connection string or production data was used.
- The test cluster uses `trust` authentication **only for this disposable loopback instance**. It is unsuitable for shared machines or production: local processes can claim a database role. Role authorization assertions use actual `SET ROLE` execution, but do not test network authentication. A later production adapter must use authenticated server-only credentials.

## Initialization and repeatable checks

The original B2 migration was applied unchanged by `scripts/test-catalog-schema.mjs` after the script checked database name, host, port, physical data directory, PostgreSQL version, absence of the catalog schema, and absence of the RFQ schema. It passed 54 assertions. Its fixtures are synthetic despite historical fixture names containing `REAL`.

For a **fresh, dedicated cluster only**, use Postgres.app 17 commands (substitute an independently verified task-local path if necessary):

```sh
PG_BIN=/Applications/Postgres.app/Contents/Versions/17/bin
TEST_ROOT=/Users/mima0000/Documents/Codex/2026-10-13/sprint-2-5-a-beauty-b2b/work/catalog-postgres-b1-55439
"$PG_BIN/initdb" -D "$TEST_ROOT/data" -U catalog_test_owner -A trust --locale=C --encoding=UTF8 --no-instructions
"$PG_BIN/pg_ctl" -D "$TEST_ROOT/data" -l "$TEST_ROOT/server.log" -o '-h 127.0.0.1 -p 55439' start
"$PG_BIN/psql" -h 127.0.0.1 -p 55439 -U catalog_test_owner -d postgres -X -c "SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('data_directory'), current_setting('listen_addresses')"
"$PG_BIN/createdb" -h 127.0.0.1 -p 55439 -U catalog_test_owner catalog_schema_test
"$PG_BIN/psql" -h 127.0.0.1 -p 55439 -U catalog_test_owner -d catalog_schema_test -X -c "SELECT current_database(), current_user, inet_server_addr(), inet_server_port(), current_setting('data_directory'), to_regnamespace('rfq_private')"
```

Before applying the migration, verify the printed host, database, port, user, physical data directory, and local-only listener. Stop immediately if any differs. The B2 migration script is a **fresh-schema test** and must not be rerun against the populated database. On a verified fresh cluster only:

```sh
CATALOG_TEST_ENABLE=1 \
CATALOG_TEST_DATABASE_URL=postgresql://catalog_test_owner@127.0.0.1:55439/catalog_schema_test \
CATALOG_TEST_DATA_DIR="$TEST_ROOT/data" \
node scripts/test-catalog-schema.mjs
```

The new post-migration check is safe to repeat; its trial writes are rolled back:

```sh
CATALOG_TEST_ENABLE=1 \
CATALOG_TEST_DATABASE_URL=postgresql://catalog_test_owner@127.0.0.1:55439/catalog_schema_test \
CATALOG_TEST_DATA_DIR="$TEST_ROOT/data" \
node scripts/test-catalog-postgres-isolation.mjs
"$PG_BIN/pg_ctl" -D "$TEST_ROOT/data" stop
```

Do not delete an existing cluster path or use the RFQ port/database as a reset shortcut. A B4.5-B2 test setup should allocate a fresh task-local data directory or explicitly verify and reset only this disposable catalog cluster.

## Schema, roles, and RLS result

The six `catalog_private` tables exist with primary keys and RLS enabled. The original B2 suite exercised UUID and foreign keys, global product-code and SKU uniqueness, normalized SKU attribute combinations, translation uniqueness, category and image association constraints, and deferred published-product completeness at commit. The new script verifies the primary key, foreign key, and key index inventory after migration. All six `catalog_public` views have `security_barrier=true` and are owned by the non-login `catalog_public_reader` role.

`anon`, `catalog_admin`, `catalog_import`, `catalog_public_reader`, and `rfq_api` are `NOLOGIN NOINHERIT`, with no inheritance memberships among these roles. Actual role execution confirmed: `anon` cannot directly select or write private catalog tables but can select the public view; the public view excludes draft and retired products; `catalog_import` can insert and update draft catalog data but cannot delete; `rfq_api` cannot select or insert catalog products. Trial writes were rolled back. No `rfq_private` schema or RFQ data exists in this cluster, so this proves catalog-side RFQ isolation, not the permissions of a separate live RFQ database.

The synthetic fixture contains one draft, one published, and one retired product, with associated category, SKU, images, and English/Chinese translations. The public product view returned only the published product. The post-migration script built a B4.4-A trusted snapshot from all six private tables and verified stable digest, bilingual rows, SKU fields, and numeric mapping.

## Findings and B4.5-B2 conditions

1. `node-postgres` returns PostgreSQL `bigint` (`moq_quantity`, `order_multiple`, `package_quantity`) as strings by default. The B4.5-A `mapCatalogDatabaseRows` accepts `bigint` or number for safe conversion, but does **not** convert a numeric string. The local test explicitly registers an `int8` parser to `BigInt`; the future SQL reader must do likewise or cast safely, and reject values beyond `Number.MAX_SAFE_INTEGER`. `numeric(14,4)` remains decimal text as designed. No B2 schema change is needed.
2. `catalog_admin` has `DELETE` privilege on catalog tables, while B2 row guards block physical deletion of products and SKUs. Other association rows can be deleted, subject to deferred publication checks. The future import adapter must use the documented lock and mutation protocol, and must not grant browser access to either server role.
3. The local `trust` authentication is limited to disposable synthetic data on loopback. It cannot establish production client authentication safety. B4.5-B2 must use explicit server-side authentication and a separate test plan for any deployed configuration.
4. No production import API, SQL write adapter, idempotency table, or new migration was implemented. B4.5-B2 can proceed with these findings as explicit acceptance conditions.

## Verification summary

- Original B2 fresh migration and constraints: **54 assertions passed**.
- New repeatable post-migration schema, role, RLS, and snapshot checks: **28 passed**.
- B4.5-A through B3 automated suites: transaction 15, dry-run 17, merge 24, snapshot 23, Excel 16, CSV 17, validation 16; all passed.
- Mock catalog: 24 products and 48 variants valid. Search, filter, sort, inquiry (24), RFQ (31), and RFQ API (29) passed.
- ESLint, TypeScript, and production build passed. `git diff --check` is part of the final pre-handoff check.
