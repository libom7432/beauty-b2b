# Sprint 2.4.3-B2-C2: local RFQ test database initialization and audit

**Status (stage 04): stages 00–03 completed locally; the read-only stage 04
effective-permission audit passed. The real PostgreSQL integration suite has
not run.**
The public RFQ route remains disabled. This plan targets the verified Postgres.app
17.11 instance on `127.0.0.1:5432`, owned by local administrator `mima0000`.
It does not use Supabase, a cloud password, or `RFQ_DATABASE_URL`.

## Migration compatibility and prerequisites

Apply the existing files in this exact order, without editing them:

1. `supabase/migrations/20261010112952_create_rfq_schema.sql`
2. `supabase/migrations/20261011120000_grant_rfq_api_role.sql`

The first Migration uses PostgreSQL 17 features available locally: UUID and
JSONB types, `gen_random_uuid()` (built into PostgreSQL 17), PL/pgSQL,
indexes, triggers, and RLS. It does **not** require a Supabase extension.
It does name Supabase roles `anon`, `authenticated`, and `service_role` in
`REVOKE`; those roles do not exist in this local cluster. Stage 01 creates
inert local `NOLOGIN` stand-ins so the original SQL runs unchanged.
The second Migration creates `rfq_api NOLOGIN`, its column grants and four RLS
policies. Its final audit requires `NOLOGIN`, so local `LOGIN` is enabled only
after that Migration completes. Both migrations require a local administrator
with role-creation and object-owner privileges. Migration role names are
cluster-wide; run only on this dedicated local instance.

## Reviewed execution stages

Each SQL file checks the exact local server version, data directory, loopback
address, port, administrator, and target database before changing anything.
Use `psql -X -W -v ON_ERROR_STOP=1` and inspect each result before continuing.
`-W` prompts for the existing local administrator password; do not paste it
into commands, environment variables, or repository files.

1. Connect to the local `postgres` database and run
   `scripts/local-rfq/00-create-test-database.sql`. It stops if
   `rfq_integration_test`, a non-system database, or any planned role already
   exists. It creates the test database from `template0` with connections
   disabled, revokes all `PUBLIC` rights **only on the new database**, then
   enables connections. It never drops a database.
   `CREATE DATABASE` cannot be wrapped in a transaction, so verify the
   `REVOKE` succeeded before continuing. If this stage partially completes,
   stop and review manually; never rerun it over the existing database.
2. Connect as the same administrator to `rfq_integration_test` and run
   `scripts/local-rfq/01-create-migration-prerequisite-roles.sql`. It creates
   the three inert local role names in one transaction.
3. In the same database, run
   `scripts/local-rfq/02-apply-original-migrations.sql`. The wrapper checks
   that the RFQ schema and roles are absent, then includes the two unmodified
   Migration files in order. A failure must be investigated before continuing.
4. Run `scripts/local-rfq/03-configure-local-test-roles.sql`. It enables
   local `LOGIN` for `rfq_api`, creates `rfq_test_auditor`, grants each only
   `CONNECT` on this test database, and adds the auditor's minimal column
   grants and three SELECT RLS policies. Both roles still have NULL passwords
   and cannot authenticate through the current SCRAM HBA rules.
5. In an interactive local administrator `psql` session on the test database,
   run `\password rfq_api` and `\password rfq_test_auditor`. Generate two
   distinct strong local-only passwords and keep them in a protected local
   credential store. `\password` prompts without embedding the secret in a
   SQL file or shell command. Confirm `password_encryption` remains
   `scram-sha-256` first.
6. Run `scripts/local-rfq/04-audit-local-test-roles.sql` as administrator.
   It checks role attributes, SCRAM verifiers without displaying them,
   memberships, database ACL, schema/table/column/function grants, RLS, and
   the auditor's actual count queries. Then confirm separate login works for
   both limited roles and that unwanted reads/writes fail before running the
   integration suite. The integration runner itself has a separate explicit
   enable switch and two test-only connection variables.

Stages 00–03 were executed in order against the approved local instance. The
two independent local passwords were set through interactive `psql` password
prompts and stored outside the project in files with mode `0600` under a
directory with mode `0700`. Correct-password logins succeeded; incorrect and
absent passwords were rejected. The stage 04 script ran without error and its
auditor count queries returned zero. The commands below are a historical
review aid, **not** instructions to rerun stages against an existing database.
They prompt for the local administrator password and contain no credential:

```sh
psql -X -W -h 127.0.0.1 -p 5432 -U mima0000 -d postgres \
  -v ON_ERROR_STOP=1 -f scripts/local-rfq/00-create-test-database.sql
psql -X -W -h 127.0.0.1 -p 5432 -U mima0000 -d rfq_integration_test \
  -v ON_ERROR_STOP=1 -f scripts/local-rfq/01-create-migration-prerequisite-roles.sql
psql -X -W -h 127.0.0.1 -p 5432 -U mima0000 -d rfq_integration_test \
  -v ON_ERROR_STOP=1 -f scripts/local-rfq/02-apply-original-migrations.sql
psql -X -W -h 127.0.0.1 -p 5432 -U mima0000 -d rfq_integration_test \
  -v ON_ERROR_STOP=1 -f scripts/local-rfq/03-configure-local-test-roles.sql
# Set two distinct passwords in a separate interactive administrator psql session.
psql -X -W -h 127.0.0.1 -p 5432 -U mima0000 -d rfq_integration_test \
  -v ON_ERROR_STOP=1 -f scripts/local-rfq/04-audit-local-test-roles.sql
```

No stage automatically runs a test, removes test records, or performs cleanup.
Use synthetic contacts such as `buyer@example.invalid` and the existing test
runner's unique run marker. Committed positive cases stay in the dedicated
database until a separately approved manual cleanup decision.

## Effective permission design

| Role | Database | Schema | RFQ tables | RLS |
| --- | --- | --- | --- | --- |
| `rfq_api` | `CONNECT` only | `USAGE` only | Original Migration's column-level request INSERT and metadata SELECT; item/job column INSERT only; no UPDATE/DELETE | Original four policies |
| `rfq_test_auditor` | `CONNECT` only | `USAGE` only | Request `id`, `idempotency_key`; item/job `rfq_request_id` SELECT only | Three local SELECT policies |
| `anon`, `authenticated`, `service_role` | No direct grant; `NOLOGIN` | Explicitly revoked by Migration | Explicitly revoked by Migration | None |

Neither test login is a superuser, database/role creator, replication role,
RLS bypasser, object owner, or member of another role. Both have `NOINHERIT`.
The new database has no `PUBLIC` `CONNECT`, `TEMPORARY`, or `CREATE`; neither
test role gets `TEMPORARY` or database `CREATE` there. Both have direct
`CONNECT` grants on the test database. Existing system-database `PUBLIC`
defaults also give both login roles `CONNECT` and `TEMPORARY` on `postgres`,
and `CONNECT` on `template1`. `template0` advertises `PUBLIC CONNECT` in its
ACL but has `datallowconn = false`, so connection is disabled. The three
`NOLOGIN` stand-ins inherit the same effective system-database `PUBLIC` ACLs
but cannot authenticate. No planned role owns these databases or gains these
rights through role membership. There is no other business database in this
cluster. Human review accepted this exception **only for this local test
environment**; no system database ACL was changed. It does not apply to
Supabase or production. A future business database with default `PUBLIC`
access would require a new isolation review.

The auditor can see only synthetic test identifiers and join keys. Its count
query is explicitly checked in stage 04. The API role cannot SELECT contact or
requirement columns. RLS is still required in addition to grants. The original
Migration creates no sequences; UUID defaults use `gen_random_uuid()`.

## Stage 04 audit result and limits

The local read-only audit found PostgreSQL 17.11 listening only on
`127.0.0.1:5432`; all three RFQ tables are empty. The five planned roles have
no superuser, BYPASSRLS, database/role creation, replication, or membership
privileges. The API and auditor roles have only schema `USAGE`, no schema
`CREATE`, no table-wide grants, no UPDATE/DELETE, and no RFQ function EXECUTE.
The original four API RLS policies remain, and the three auditor SELECT
policies apply only to `rfq_test_auditor`. The auditor's actual join/count
query works with its four identifier-column grants; protected contact and
snapshot columns remain unreadable. `rfq_private` schema, three tables, and
trigger function remain owned by the local administrator. No RFQ object has a
`PUBLIC` grant, and test-database `PUBLIC` privileges remain closed.

Static SQL review matches the Repository's explicit `INSERT`, `SELECT`,
`RETURNING`, and `ON CONFLICT (idempotency_key) DO NOTHING` columns to the
effective column grants. This read-only audit does not execute an INSERT or
establish actual transaction, conflict, concurrency, or rollback behavior;
those await the separate real PostgreSQL integration run. It also cannot
establish Supabase cloud permissions, Transaction Pooler behavior, or cloud
TLS compatibility. Cloud `rfq_api` remains `NOLOGIN`; these local-only steps
do not authorize cloud access or live RFQ submission.
