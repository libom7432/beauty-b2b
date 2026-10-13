# Sprint 2.4.3-B2-B: PostgreSQL RFQ repository

The adapter lives in `src/lib/rfq/postgres-repository.ts`. B2-D1 wires it to
`POST /api/rfq` only through an explicit local-only test gate described in
[rfq-api-b2d1.md](rfq-api-b2d1.md). The route still returns 503 by default
and in production. The catalog is Mock, cloud `rfq_api` remains NOLOGIN, and
launch controls are absent. No database connection is opened by importing the
adapter or building the app.

## Connection

`getPostgreSQLRFQRepository()` lazily creates one `pg` Pool per warm Node.js
worker. It reads only the server-side `RFQ_DATABASE_URL` variable. The URI must
use `postgres://` or `postgresql://`, include a password, and identify
`rfq_api` (direct connection) or `rfq_api.<project-ref>` (Supabase shared
Transaction Pooler). Admin usernames and URI query parameters are rejected.
The Pool uses one connection per worker, a 3-second connection timeout,
10-second client query timeout, and 10-second idle connection timeout. After
`BEGIN`, the adapter sets an 8-second transaction-local server statement
timeout. TLS always verifies the
server certificate and hostname. If the host requires a private CA, install
it in the Node trust store; do not turn certificate verification off.

The pool is not a global connection cap: deployment scale multiplies its
connections. It registers a listener for errors on idle clients without
logging database URLs, SQL, or buyer fields.

## Transaction and idempotency

One acquired `PoolClient` executes `BEGIN ISOLATION LEVEL READ COMMITTED`, all
queries, and `COMMIT`. Each error triggers a best-effort `ROLLBACK`; failed or
uncertain connections are discarded with `release(true)`. No query uses
`pool.query`, a named prepared statement, pipelining, or session state that
must survive the transaction. Values are parameterized; schema and table
names are fixed and qualified.

The transaction first selects only `id`, `rfq_number`, `request_fingerprint`,
`status`, and `created_at` by the normalized idempotency key. A new request
inserts the request row using only granted columns, then its item snapshots,
then one pending notification job. Database defaults set IDs, status, and
timestamps. The request insert uses `ON CONFLICT (idempotency_key) DO NOTHING
RETURNING` those same allowed metadata columns. PostgreSQL's unique constraint
arbitrates concurrent inserts. If a competing insert wins, its transaction
must commit before `DO NOTHING` completes; a following SELECT is a new
READ COMMITTED statement snapshot and can see the committed row. Matching
fingerprints replay; different fingerprints conflict. No old RFQ is updated.
The `rfq_api` grants include SELECT on the conflict target and returned
columns. They do not include SELECT on contacts or requirements.

## Error boundary

The adapter maps errors to fixed internal kinds: `CONFIGURATION`,
`IDEMPOTENCY_CONFLICT`, `RFQ_NUMBER_CONFLICT`, `DATABASE_UNAVAILABLE`, and
`UNEXPECTED_DATABASE_ERROR`. A normal idempotency conflict is represented by
the repository returning the existing fingerprint, so the API decides 200 or
409. A unique RFQ number collision is separate and never treated as replay.
The API currently catches adapter errors and returns a generic 503; it never
returns raw PostgreSQL errors. A COMMIT acknowledgement can be lost after the
database has committed. The API must retry with the same idempotency key to
discover that result; it must not assume the transaction rolled back.

## Required live verification before activation

Mock Pool tests assert SQL shape, same-client ordering, rollback attempts,
discard behavior, and simulated concurrency. A separate local PostgreSQL
integration run passed 10 cases using the limited local `rfq_api` login,
including actual RLS, rollback, and cross-connection contention. It did not
test Supabase Transaction Pooler or cloud TLS. B1 security acceptance,
verified catalog, deployed trusted-origin check, shared rate limit, and
resource limits remain launch blockers. No database password is stored in
this repository.

References: [node-postgres transactions](https://node-postgres.com/features/transactions),
[node-postgres pool](https://node-postgres.com/apis/pool),
[PostgreSQL INSERT privileges](https://www.postgresql.org/docs/17/sql-insert.html),
[PostgreSQL READ COMMITTED](https://www.postgresql.org/docs/17/transaction-iso.html),
[Supabase transaction pooler](https://supabase.com/docs/guides/database/connecting-to-postgres).
