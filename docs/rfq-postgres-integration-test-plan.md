# Sprint 2.4.3-B2-C2: local PostgreSQL integration tests

`scripts/test-rfq-postgres-integration.mjs` is an executable test runner.
**The first real local PostgreSQL run passed 10 cases.** Stages 00–03 initialized
the approved local test database and roles; stage 04 performed read-only
effective permission checks. The HTTP route remains disabled by default. The runner uses the
actual `PostgreSQLRFQRepository` and API handler;
its second, read-only connection checks committed row counts in all three tables.

## Local-only safety gate

Without `RFQ_RUN_PG_INTEGRATION=1`, the script exits before creating any Pool.
It reads only `RFQ_TEST_DATABASE_URL` for `rfq_api` and
`RFQ_TEST_AUDIT_DATABASE_URL` for `rfq_test_auditor`; it never reads
`RFQ_DATABASE_URL` or falls back to `PG*` variables. Both URLs must specify the
same port and an exact database name, `rfq_integration_test`. Accepted hosts are
`localhost`, `127.0.0.1`, and `::1`; `localhost` is resolved by the runner to
`127.0.0.1`, so a hosts-file alias cannot redirect it. Every other host,
including Supabase, and every other database name, including `postgres`,
`production`, `template0`, and `template1`, is rejected. URL query strings and
fragments are rejected. There is no normal environment-variable override.
The guard accepts any loopback port; before a future run, the operator must
confirm both test URLs use the verified local PostgreSQL listener on port 5432
and that no local forwarding service redirects it. Stage 04 verified the
current listener, but a URL guard alone cannot attest a future server's
physical location.

The local Pool has TLS off because its endpoint is restricted to loopback.
This setting is exclusive to this test runner. The production adapter still
requires verified TLS. The runner never prints a URL, password, SQL parameter,
or buyer detail. Failure output names the failed case only.

## Local environment preparation and stage 04 result

The reviewed local initialization plan and staged, password-free SQL are in
[rfq-local-postgres-initialization.md](rfq-local-postgres-initialization.md).
Stages 00–03 were completed under separate approvals. Both original Migrations
remain unchanged; the local test database has no `PUBLIC` rights, and the
auditor has only the identifier columns needed by this runner. Stage 04 found
the expected role attributes, column grants, RLS policies, function denials,
object ownership, and zero RFQ rows. The auditor's exact join/count query
executed successfully. Static review found the Repository's `ON CONFLICT`
arbiter and `RETURNING` columns among `rfq_api`'s SELECT grants. No write was
performed to prove INSERT or concurrent conflict behavior in stage 04.

The existing local system-database defaults permit `rfq_api` and
`rfq_test_auditor` to connect to `postgres` and `template1`, and to use
`TEMPORARY` on `postgres`. `template0` has an effective `PUBLIC CONNECT` ACL
but disallows connections. Human review accepted this exception for the
dedicated local test environment only; no system-database ACL was changed.
It does not apply to cloud or production. The test runner still rejects every
database name except `rfq_integration_test`.

Keep the two test-only database URLs outside the repository and use independent
local passwords. Any future rerun still requires its explicit
`RFQ_RUN_PG_INTEGRATION=1` switch. The completed run left six synthetic rows
in each RFQ table; no cleanup was performed.

## Coverage and test data

The runner verifies actual `rfq_api` identity, required INSERT/SELECT column
grants, denied contact/item/job reads, denied UPDATE/DELETE grants, and RLS on
all three tables. It exercises a successful three-table write; parent, item,
and notification failures with full rollback; identical-key replay; changed
request conflict; two separately pooled connections synchronized after their
initial lookup; RFQ-number uniqueness; retired product and SKU replay; a local
connection failure; and one notification job per committed RFQ. A read-only
auditor counts parent, item, and job rows by the test idempotency key.

Every fixture uses fictional contact information (`buyer@example.invalid`). RFQ
numbers include a random run marker such as `RFQ-B2C2-<run>-001`. Negative cases
are rolled back. Positive, replay, and concurrency cases must commit to prove
database behavior, so their records remain in the dedicated database. The
runner never DELETEs or TRUNCATEs anything and never assumes `rfq_api` has
cleanup rights. After review, a local operator can retire the entire disposable
database; do not run cleanup in a shared database.

## Failure handling and limits

On failure, identify the printed case name, inspect the synthetic run's rows
with the local auditor, and verify local roles, grants, RLS policies, cluster
port, and server logs. The runner intentionally suppresses raw driver messages
because they could contain SQL or connection details. The Mock Pool suite
remains separate; only a future real run can establish PostgreSQL behavior.

This local test does not prove Supabase Transaction Pooler compatibility, cloud
TLS certificate trust, or cloud effective permissions. It does not authorize
Supabase access, cloud Migration execution, cloud `rfq_api LOGIN`, or production
submission. Those remain under B1 risk acceptance and separate approval.
