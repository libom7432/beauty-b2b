# RFQ database schema, V1

Migration: [`20261010112952_create_rfq_schema.sql`](../supabase/migrations/20261010112952_create_rfq_schema.sql). This is an offline design for Supabase PostgreSQL; this sprint adds no API, credentials, client database connection, email sender, or live submission.

## Tables and relationships

```text
rfq_private.rfq_requests (1) ──< (many) rfq_private.rfq_items
                         (1) ── (0 or 1) rfq_private.rfq_notification_jobs
```

| Table | Purpose | Main fields |
| --- | --- | --- |
| `rfq_requests` | Buyer contact, requirements, server-generated identity and submission state | UUID `id`, unique `rfq_number`, unique `idempotency_key`, SHA-256 `request_fingerprint`, contact fields, optional buyer details, `customization` JSONB, `status`, timestamps |
| `rfq_items` | Purchasable line items and immutable submission-time catalog facts | UUID `id`, `rfq_request_id`, text `product_id`, nullable text `sku`, positive `quantity`, `product_snapshot` JSONB, timestamps |
| `rfq_notification_jobs` | One future notification job per RFQ with retry bookkeeping | UUID `id`, unique `rfq_request_id`, `status`, `attempt_count`, `next_attempt_at`, `lease_expires_at`, `sent_at`, `last_error`, timestamps |

All timestamps are `timestamptz`. All three tables have `created_at` and an update trigger for `updated_at`. UUIDs use PostgreSQL's `gen_random_uuid()`; no product table or external extension is required. Product IDs and SKUs remain text because the current catalog uses text identifiers. There is intentionally no foreign key to the current in-code product dataset.

### Compatibility with the current TypeScript model

`RFQDraft.contact` maps to request contact columns. Optional `buyerType`, `customization`, and `purchaseTimeline` map to nullable columns or the JSONB array. `requirements` maps directly. `RFQSubmission.status` currently permits only `received`; the request status constraint matches that type. `RFQDraftItem.productId`, optional `sku`, and `quantity` map to item columns. The trusted `RFQItemSnapshot` fields `productName: {en, zh}`, `productSlug`, and `selectedVariant: {id, attributes} | null` map to `product_snapshot`. No price is stored. `rfq_number`, idempotency metadata, and notification state are server/database concerns, not new required front-end form fields.

The database checks trimmed text lengths, uppercase two-letter country *shape*, supported enum values, positive JavaScript-safe integer quantity, nonempty localized snapshot names and slug, and a variant snapshot when SKU is present. The application validator remains the authority for the actual ISO country list, email and URL formats. The future server must rerun that validation; the database is a final consistency boundary, not a replacement for it.

## Uniqueness, deletion, and snapshots

`rfq_number` and `idempotency_key` each have a unique constraint, which creates their indexes. The application identifies a duplicate item by the product ID and SKU pair. The database mirrors this with a partial unique index on `(rfq_request_id, product_id, sku)` when SKU is present. Variantless products are unique by `(rfq_request_id, product_id)` when SKU is null. Different SKUs of the same product remain separate items. Today the mock catalog additionally makes SKUs globally unique; the future server must still validate SKU membership in its product before insertion. The snapshot is required and checked for its essential shape; the future server must build it from the trusted catalog after validating product ID/SKU membership. The item record retains the name, slug, and selected variant at submission time even if the catalog later changes or is removed. Mutable catalog lookup is not needed to read historic RFQs.

Both item and job foreign keys use `ON DELETE RESTRICT`. V1 exposes no business operation for physical deletion and grants no client delete permission. A future authorized retention/erasure workflow must decide legal retention and delete dependent jobs and items before the request in one privileged transaction. No `CASCADE` silently destroys history. The database does **not** by itself guarantee at least one item or a job for every request; the future server must insert a validated nonempty request, its items, and the job atomically.

## Idempotency

The idempotency key is globally unique across all buyers and retained for the lifetime of the request; V1 has no expiration or cleanup. A 64-character lowercase hexadecimal request fingerprint is required. The future API should compute SHA-256 from a canonicalized, validated payload and resolved trusted item snapshots, excluding incidental field order and transient timestamps. It must perform request, items, and job creation in a transaction. On a unique-key collision, it should load the existing fingerprint: identical fingerprint returns the existing RFQ, different fingerprint returns a conflict (for example HTTP 409). Database constraints prevent duplicate rows; they do not compare payloads or implement the response behavior. The server, not the browser, generates the RFQ number, UUID/created time, status, and fingerprint. The key should contain no contact data.

Do not delete idempotency rows simply because a retry window has elapsed: doing so would permit the same key to create a second RFQ. If retention requirements later require deleting buyer records, first design a durable key tombstone/erasure policy and its collision behavior in a separately reviewed migration.

## Status and notifications

Request status is `received` in V1, matching the current `RFQSubmission` type. Additional request states require a future migration and a corresponding application model update. Notification job states are `pending`, `processing`, `retry_wait`, `sent`, and `failed`. Intended flow is `pending → processing → sent`, with `processing → retry_wait → processing` for bounded retries, and terminal `failed` when retries are exhausted. The database constrains allowed states and which scheduling timestamp is present; it does not enforce state-transition order.

The future worker should claim due jobs transactionally, increment `attempt_count`, set a finite lease, use exponential backoff for `retry_wait`, reclaim expired leases, and keep the operation idempotent. `last_error` must be short and sanitized, without contact details or provider secrets. No mail payload or buyer contact is duplicated in the jobs table. The schema's one-job-per-request constraint fits the initial single notification workflow; multiple notification channels would need a reviewed schema change.

## Indexes

- Unique constraints provide indexes for RFQ number, idempotency key, job-to-request one-to-one relation, and primary keys.
- Request `created_at DESC` supports recent-RFQ views. A `(status, created_at DESC)` index was considered but deferred: request status can only be `received` in V1, so it would duplicate the ordering value of the existing index. Add it when meaningful request states are introduced.
- Item `rfq_request_id` supports foreign-key lookups and loading an RFQ's items. Two partial unique indexes implement SKU and variantless-product uniqueness.
- Partial `(status, next_attempt_at)` finds due notification jobs; the partial lease index finds stalled `processing` jobs.

No extra standalone index duplicates a unique constraint.

## Access boundary

The migration creates `rfq_private`, which must **not** be added to Supabase's exposed API schemas. It enables RLS on all three tables, adds **no** policies, and explicitly revokes schema/table access from `PUBLIC`, `anon`, `authenticated`, and `service_role`. It also revokes execution of the update trigger function from those roles; the function is `SECURITY INVOKER` and has a fixed search path. The migration changes no existing tables, public schema defaults, or project-wide role defaults. `anon` and `authenticated` receive no RFQ read/write access. There is no public buyer lookup policy.

Supabase's `service_role` can bypass RLS when granted access, so RLS alone is not an authorization boundary for server credentials. The future API should access this schema only from a server-side database connection using a dedicated least-privilege role with explicitly reviewed grants and policies, or another strictly server-held privileged connection. It must never put a privileged database password or service key in the browser, and must not expose this private schema through the Data API by accident. Trigger/function execution grants also need review whenever new functions are added.

## Migration and verification

The timestamped migration runs in one transaction and deliberately uses plain `CREATE`; it should fail loudly if applied twice or if a schema name already exists. The migration runner records the version and applies it once. It contains no credentials, test buyer records, or production data.

Local PostgreSQL/Supabase execution is required before deployment. In a disposable **local** Supabase environment, run `supabase start` then `supabase db reset` to replay migrations; do not use a linked production project for this check. Verify table/constraint/index creation, then check role access with `SET ROLE anon` and `SET ROLE authenticated` (schema/table access should fail). Exercise insert failures for duplicate idempotency key, duplicate product ID/SKU pair, zero quantity, missing snapshot, and invalid notification state; verify the update trigger and rollback. Before deploying, have the migration and future grants reviewed against the target Supabase project's PostgreSQL version and existing schemas. Never run `db reset` against a production database.

When products move to a real database, keep the historic JSONB snapshot. The server should resolve Product ID and SKU against the new authoritative catalog before insertion. Add catalog foreign keys only after deciding what should happen when a product is archived or removed; a hard FK is not appropriate for the current code-backed catalog.
