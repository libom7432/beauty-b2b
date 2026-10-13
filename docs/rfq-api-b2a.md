# Sprint 2.4.3-B2-A: RFQ API core

For the later local-only PostgreSQL route integration, see
[rfq-api-b2d1.md](rfq-api-b2d1.md). The B2-A launch blockers below still
apply to any real customer or production submission.

At B2-A, `POST /api/rfq` had a testable Node.js handler and the deployed route
returned `503 RFQ_UNAVAILABLE` before reading customer data. The catalog still
contains Mock Products. B2-D1 adds only a gated local PostgreSQL test route;
it does not add a production trusted-origin policy or shared rate limiter.
Do not enable `catalogVerified` for real customer submissions with this catalog.

The accepted JSON body is the existing `RFQDraft` shape: `contact`, optional
`buyerType`, `requirements`, optional `customization`, optional
`purchaseTimeline`, and `items` containing only `productId`, optional `sku`, and
`quantity`. Unknown keys are rejected, including server-owned snapshot, price,
number, status, and timestamp fields. A UUID `Idempotency-Key` header is required.
The maximum body is 32 KiB of bytes actually read. Successful responses contain
only request ID, RFQ number, status, creation time, and a `replayed` flag. The
UUID idempotency key is stored in lowercase. An existing key is compared using
a structurally validated, normalized client request, so later catalog changes
do not prevent a matching retry; new keys still require current catalog checks.

## Persistent repository contract

The `RFQRepository.transaction` callback must execute within one database
transaction. Its `insertRequestIfAbsent` operation must use the unique
`idempotency_key` as a cross-process arbiter, such as `INSERT ... ON CONFLICT
(idempotency_key) DO NOTHING RETURNING ...`. If an insert loses a race, the
transaction must wait for the winner to commit, then `findByKey` must return the
winner's fingerprint and public metadata. A missing winner is an error; it must
never start a second request. On a successful insert, the adapter must insert
all items and one pending notification job before commit. Any failure rolls
back the request, items, and job together. The request row must use database
defaults for ID, status, and timestamps. SQL must be parameterized and use only
the `rfq_api` column grants; no administrator credential may be used.

The SHA-256 fingerprint covers normalized buyer fields and a deterministic item
order. It excludes mutable catalog snapshot details so a retry of the same
validated request can match the stored fingerprint. New submissions take their
product name, slug, and selected variant solely from the verified server
catalog. The response never contains buyer contact fields.

## Launch blockers

- Replace Mock Products with an independently verified server catalog and
  deliberately enable `catalogVerified` only after that review.
- Implement and integration-test the persistent transaction adapter with a
  database role approved for `LOGIN`. B1 approval is still pending.
- Provide a trusted-origin policy for the deployed domain and a shared rate
  limiter that works across all instances. In-memory counters are insufficient.
- Set connection, statement, and storage/resource limits; review the accepted
  `TEMPORARY` and large-object risks before opening database login.
- Verify the live database constraints, permission boundaries, concurrent
  idempotency behavior, and failure rollback in a non-production environment.
- Keep secrets server-side and out of `NEXT_PUBLIC_` variables and logs. Mail
  delivery is a separate future integration; this API only queues a job.
