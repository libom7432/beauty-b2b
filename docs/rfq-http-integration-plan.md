# Sprint 2.4.3-B2-D2: local RFQ HTTP preflight and test plan

## B1-D local origin guard fix (2026-10-13)

The B1-C diagnosis was confirmed: Next.js 16.3.8 gave the route a
`request.url` under `localhost:3109` even though the actual request carried
`Host: 127.0.0.1:3109` and `Origin: http://127.0.0.1:3109`. The old
`localOrigin` compared those real headers against the URL and incorrectly
returned 403 before idempotency-key validation.

The local-only guard now authorizes only the exact incoming
`Host: 127.0.0.1:3109` and `Origin: http://127.0.0.1:3109`. Missing headers,
`localhost`, and every other port are rejected. It does not derive permission
from `request.url` or use `X-Forwarded-Host` or `X-Forwarded-Proto` as
authorization inputs. Production closure, default 503, database backend
identity checks, and 201/200/409 behavior were not changed.

The HTTP integration script now uses raw `node:http` for its invalid-Host
negative case because Node `fetch` did not reliably deliver the overridden
Host. It also explicitly tests missing Origin and checks that a normal request
without `Idempotency-Key` reaches the expected 400 response. Default-disabled
and separate write gates remain in place; no retry or cleanup was added.

An isolated project copy excluded `.git`, `.env*`, the original `.next`, and
credentials, and used copied dependencies. Its original route returned 503
with the database disabled. For enabled-path checks, only the temporary copy
used a diagnostic route with a synthetic local URL and a Repository that would
throw if reached; no actual PostgreSQL adapter or credentials were provided.
The server listened only on `127.0.0.1:3109` and was stopped afterward.
Eleven raw HTTP cases passed: exact Host/Origin with a missing key returned
400; missing or wrong Origin, wrong Host, and both localhost headers returned
403; forged forwarded headers did not authorize an otherwise invalid pair.
A request without Host was rejected by Next.js itself with 400 before reaching
the route; the direct Request/Mock test verifies the guard would reject an
absent Host with 403 if the route receives one. A normal `fetch` request with
the exact Host/Origin also returned 400. No database request or RFQ write was
made in this regression.

Regressions passed: RFQ API Mock 29/29, RFQ validation 30/30, PostgreSQL
Mock Pool 11/11, HTTP script syntax/default-disabled mode, TypeScript, ESLint,
and Next.js production build. The real HTTP PostgreSQL write suite remains
unrun. Before B1-B resumes, repeat its local auditor identity and 6/6/6
baseline checks, then recheck the isolated server and write gates. Do not use
port 3000 or Supabase for this test.

## B1-C no-database 403 diagnosis (2026-10-13)

The B1-B prewrite request was `POST http://127.0.0.1:3109/api/rfq` with
`Host: 127.0.0.1:3109`, `Origin: http://127.0.0.1:3109`, JSON content type,
and no `Idempotency-Key`. An isolated Next.js 16.3.8 diagnostic copy used the
unchanged `createLocalRFQRoute` guard, a synthetic local URL, and an injected
Repository that always throws without opening a database connection. It
recorded only request routing metadata. Next.js passed the route
`request.url = http://localhost:3109/api/rfq` while preserving the actual Host
and Origin above. Therefore `localOrigin` in `src/lib/rfq/local-route.ts`
rejects the request: the URL hostname is `localhost`, the Host differs from
`url.host`, and Origin differs from `url.origin`. `createRFQHandler` returns
403 before it checks the missing idempotency key. The route handler, rather
than a middleware or framework rejection, produced `FORBIDDEN`.

Ten no-database HTTP header cases returned 403 under the current rule,
including exact Host/Origin, missing Origin, localhost Origin, wrong ports,
external Origin, and forwarded-header variants. Ten direct Request/Mock cases
confirmed the guard itself returns 400 for matching 127.0.0.1 URL/Host/Origin,
403 for absent or mismatched Origin/Host, and 403 for a Next-style localhost
URL. Header-name case is not the cause: Web Headers lookup is case-insensitive.
Next.js supplies `X-Forwarded-Host` and `X-Forwarded-Proto`, and a supplied
HTTPS forwarded proto changed the route's URL scheme. The local guard does not
read those headers directly, but reliance on `request.url` exposes it to
framework URL construction and forwarded-proto effects.

There is also an HTTP test issue: Node `fetch` did not deliver an overridden
`Host` header to this Next.js route in the invalid-Host scenario. A raw
`node:http` request did deliver the changed Host. After fixing the route,
replace that single negative case with a raw HTTP request to make the Host
assertion meaningful; keep the target fixed at 127.0.0.1:3109.

Proposed minimal application change, pending review: for this local-only
route, require the exact incoming `Host: 127.0.0.1:3109` and
`Origin: http://127.0.0.1:3109` instead of deriving the permitted origin
from `request.url`. Do not authorize a request based on `X-Forwarded-*`.
Consider rejecting forwarded host/proto values that conflict with the fixed
local endpoint. Keep the production and database gates. No production source
or HTTP test script was changed in B1-C, and no database credential or
connection was supplied to the diagnostic server.

## B1-B attempt (2026-10-13): halted before RFQ write

The script and route safety review passed. Immediately before startup, direct
read-only connections as `rfq_api` and `rfq_test_auditor` confirmed the expected
local Postgres.app 17.11 backend, database, address, and limited role attributes.
The auditor confirmed a `6 / 6 / 6` baseline. An isolated copy without env,
Git, or original build files started on `127.0.0.1:3109`; its actual process
working directory and listener were checked. The password was supplied only
in the isolated server process environment and was not found in the copied
build files.

A deliberately invalid POST with no idempotency key, sent before any valid RFQ
request, returned HTTP `403` instead of the expected `400`. The server log
confirmed `POST /api/rfq 403`. The local origin guard is the route's 403 path,
but the exact request URL/Host/Origin discrepancy has not been established.
The run stopped immediately: the write-mode integration script was not run,
no valid RFQ POST was sent, and the database fault case was not attempted.
After stopping the isolated server, a direct auditor read-only transaction
again counted `6 / 6 / 6`. No test rows or notification jobs were added.
Investigate the guard behavior in an isolated, no-write session before another
write attempt; do not automatically retry this run or clean up historical rows.

## B1-A final read-only preflight (2026-10-13)

**Status: read-only preflight passed; no RFQ write performed.** The B0
isolation check used a temporary copy of the current project files, excluding
`.git`, `.next`, `.env`, `.env.*`, test reports, and generated output. It used a
real copy of `node_modules`: Turbopack rejected a dependency symlink pointing
outside the temporary project's filesystem root. The original `next.config.ts`
was not changed. The copy was launched with a cleared environment, no RFQ
enable switch or database URL, and `next dev -H 127.0.0.1 -p 3109`. The actual
listener was `127.0.0.1:3109` and a closed-mode POST returned `503
RFQ_UNAVAILABLE`. The temporary server was stopped and the copy removed.
The original PID 27377 remained on `*:3000`; it must not be used for RFQ tests.
No public proxy or tunnel was used in the controlled test, though local process
inspection alone cannot rule out every external forwarding configuration. At
the end of B1-A, no port 3000 listener was observed; this check did not stop
or modify that service. Port 3109 also had no listener.

The local initialization record says the distinct `rfq_api` and
`rfq_test_auditor` passwords were set interactively and stored outside the
project in files with mode `0600`, under a directory with mode `0700`. It does
not identify their path or loading command. The existing files were later
located under the user's protected Postgres application-support directory.
Their owner, `0700` directory and `0600` file permissions, distinct single-line
password format, and lack of embedded connection strings were verified without
printing either value. The auditor password was read directly from its file
into the client process for this read-only check. The HTTP runner expects
`RFQ_TEST_AUDIT_DATABASE_URL`; a future enabled isolated server would need
`RFQ_LOCAL_DATABASE_URL` for `rfq_api`. Neither variable nor an RFQ write
switch was enabled in B1-A. Do not recreate passwords, use an administrator
or Supabase account, or place credentials in the project.

The current `5432` listener is a local `postgres` process on `127.0.0.1`,
whose executable is under Postgres.app's version 17 directory. A direct
`rfq_test_auditor` connection over `127.0.0.1:5432` independently reported
database `rfq_integration_test`, version `17.11 (Postgres.app)`, and no
`SUPERUSER` or `BYPASSRLS`. In a read-only transaction, its permitted columns
and RLS returned actual counts of `6 / 6 / 6` for requests, items, and jobs.
Recheck these facts and the isolated server listener immediately before B1-B;
stop if any identity or count differs.

Static review of `scripts/test-rfq-http-integration.mjs` found default-disabled
mode, separate `write` mode and `RFQ_RUN_LOCAL_HTTP_WRITES=1` gate, fixed
`127.0.0.1:3109` target, fictional `example.invalid` contact, independent
UUID keys, Mock Catalog data, and no cleanup, retry, permission change, or
Migration step. The HTTP path creates a notification job; it has no external
mail sender. No write mode was run in B1-A. Recheck the isolated listener and
credential target immediately before any future write test. Do not use the
existing port 3000 service or Supabase cloud for this test.

**D2-A historical status:** preparation only. No HTTP RFQ write, real mail
delivery, database change, or cloud connection was performed in D2-A. Its
last verified counts were six synthetic requests, six items, and six
notification jobs from the earlier Repository integration run. The B1-A
read-only audit above has now reverified those counts.

## Safety preflight

The route defaults to 503 and stays closed in production. The local enable
path requires the explicit switch, server-only local URL, exact
`127.0.0.1:5432/rfq_integration_test` target and `rfq_api` role, matching HTTP
Host and Origin, and a read-only PostgreSQL backend identity query before
`BEGIN`. The pool is created only after a validated request reaches the
Repository; neither import nor a disabled request creates it. Fixed HTTP error
bodies exclude SQL, credentials, contact fields, and request text. UUID keys
are normalized to lowercase, and the existing handler owns 201/200/409.

The current `127.0.0.1:5432` listener is the Postgres.app 17.11 binary, and
read-only connections as `rfq_api` and `rfq_test_auditor` report the expected
server address, database, role, and no SUPERUSER/BYPASSRLS. The credentials
used for these checks were the independent local test credentials, never the
administrator or Supabase credentials. The 5432 listener is a PostgreSQL
process, not a forwarding process.

Port 3000 is already occupied by an existing Node development server in this
project, and it listens on `*`, not loopback only. Its environment is unknown;
do not reuse or terminate it as part of this plan. Port 3109 was unoccupied at
preflight and is reserved for a separately controlled loopback-only HTTP
session. Before D2-B writes, either the existing dev process must be safely
stopped/reconfigured by its owner or an isolated Next.js development checkout
and process must be prepared. Confirm its actual listener is
`127.0.0.1:3109`, with no wildcard listener, public proxy, or tunnel. A
production build can exercise the closed route on this port but cannot enable
the local-write gate because `NODE_ENV=production`.

## Synthetic fixture

The prepared runner reads the first product and its first SKU directly from
the current Mock Catalog. Quantity comes from that variant's MOQ. It generates
a fresh run marker and independent UUID idempotency keys for serial and
concurrent submissions. The contact is `HTTP Fixture <run>`,
`buyer+<run>@example.invalid`, and `Synthetic Fixture`; no phone, real email,
or customer data is used. Requirements contain the run marker. The runner
does not edit Mock Products, trigger mail delivery, or clean up committed
records. The API only creates notification jobs.

## HTTP matrix for D2-B

| Case | Server state and expected result | Database effect |
| --- | --- | --- |
| A default closed | No enable switch: 503 `RFQ_UNAVAILABLE` | None |
| B production closed | Production with switch present: 503 | None |
| C missing condition | Missing switch or local URL: 503 | None |
| D invalid Host/Origin | Enabled local server: 403 | None |
| E invalid Content-Type | Enabled local server: 415 | None |
| F over 32 KiB | Enabled local server: 413 | None |
| G missing key | Enabled local server: 400 | None |
| H invalid UUID | Enabled local server: 400 | None |
| I first valid submission | Enabled local server: 201 | One row in each RFQ table |
| J same-key replay | Enabled local server: 200, `replayed=true` | No new row |
| K changed content, same key | Enabled local server: 409 | No new row |
| L concurrent same-key requests | Enabled local server: one 201 and one 200 | One RFQ, item, job |
| M database fault | Separately controlled local server with intentionally unusable local test credential: fixed 503 | None; verify before and after |
| N three-table counts | Auditor counts by both fresh keys | Each key has 1/1/1 |
| O no duplicate jobs | Auditor counts distinct request IDs in jobs | One job per new RFQ |

`scripts/test-rfq-http-integration.mjs` is disabled by default. Its `closed`
mode sends only a request to an already running loopback server. Its `write`
mode additionally requires `RFQ_RUN_LOCAL_HTTP_WRITES=1`, a validated
`RFQ_TEST_AUDIT_DATABASE_URL` for `rfq_test_auditor`, and a single Node
listener bound exactly to `127.0.0.1:3109`; it checks the actual audit
backend identity before sending any valid write. It reports only synthetic
run IDs and keys. Never run write mode in D2-A. Case M requires a separately
reviewed fault setup and is not automatically triggered by the runner.

## D2-B execution boundary

Confirm the dev server and database processes again immediately before a
write run. Supply the local server credential from protected storage outside
the repository; do not print or commit a URL. Start an isolated dev server
bound to `127.0.0.1:3109`, with the local switch and exact test database URL.
Run closed, invalid-request, then write cases only after explicit D2-B
approval. On any failed case, stop without automatic retry or cleanup, use
the auditor's permitted identifier columns to inspect the run, and preserve
all synthetic records for review. Never connect Supabase, enable cloud LOGIN,
or use real customer information.
