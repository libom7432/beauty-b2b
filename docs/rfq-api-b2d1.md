# Sprint 2.4.3-B2-D1: local PostgreSQL RFQ route

`POST /api/rfq` uses the existing RFQ handler and PostgreSQL Repository through
dependency injection. Its Next.js runtime is Node.js. The route returns
`503 {"error":"RFQ_UNAVAILABLE"}` by default, before creating a pool or reading
the request body. It also remains closed in every production environment.

## Local-only enablement

All of the following are required for local testing:

1. `NODE_ENV` must not be `production`.
2. `RFQ_ENABLE_LOCAL_POSTGRES=1` must be explicitly set.
3. `RFQ_LOCAL_DATABASE_URL` must be present, with exactly `127.0.0.1:5432`,
   database `rfq_integration_test`, and role `rfq_api`.
4. The incoming request URL and `Host` must refer to `http://127.0.0.1` on
   the same local HTTP port, and `Origin` must match that origin.
5. Before `BEGIN`, each checked-out PostgreSQL connection must report the
   expected database, role, `127.0.0.1:5432` backend address, Postgres.app
   17.11 version, and no SUPERUSER or BYPASSRLS attribute. A mismatch returns
   the fixed 503 response and discards that connection.

The route never reads `RFQ_DATABASE_URL` or Supabase credentials. The local URL
is server-side only; never prefix it with `NEXT_PUBLIC_`, put it in Git, or
print it in logs. Keep the independent local password in a protected store
outside this project. Restart the local Next.js process to intentionally
change the database connection configuration.

The current product catalog is Mock data. `catalogVerified` is enabled only
inside this local route gate so synthetic HTTP tests can exercise the existing
validation and snapshot code. The local `allowRequest` guard is a test-only
allowance, **not** a shared production rate limiter. Bind the local Next.js
server to loopback, use only fictional contacts, and do not expose this route
to real customers. Production remains disabled regardless of the switch.

## API and Repository behavior

The existing handler retains its 32 KiB byte limit, strict JSON and UUID
checks, normalized fingerprints, catalog validation for new keys, and safe
response fields. The injected Repository retains its single-client transaction
and database unique-constraint arbitration. A first submission returns 201,
an identical replay returns 200, and changed content on the same key returns
409. Invalid local configuration or database failures return a fixed 503
without SQL, connection details, or customer contact fields.

## Next HTTP integration stage

Before an HTTP write test, verify the loopback listener is the intended local
Postgres.app instance and that `rfq_integration_test` contains only synthetic
data. Start Next.js bound to `127.0.0.1` on an isolated local HTTP port with
the explicit switch and protected local test connection variable, then send
synthetic requests with matching `Host` and `Origin`. Check 503 while disabled,
then 201/200/409 and failure responses while locally enabled. Use
`rfq_test_auditor` to count committed rows. The route's backend identity probe
adds a second check, but a human should still inspect the local listener before
running HTTP writes. Do not connect Supabase, enable cloud `rfq_api LOGIN`, or
use real customer data. Cloud production support still requires B1 risk
acceptance, a verified non-Mock catalog, a deployed trusted-origin policy,
shared rate limiting, and separate authorization.
