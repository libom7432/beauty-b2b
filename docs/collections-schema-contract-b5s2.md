# Sprint 2.6-B5-S2 — Collections offline schema and security contract

**DRAFT / NOT APPROVED FOR MIGRATION.** The companion SQL is
[`docs/sql/collections-schema-security.b5s2.draft.sql`](sql/collections-schema-security.b5s2.draft.sql).
It is deliberately outside `supabase/migrations`. Do not apply it to a cloud database.

## Scope and approved decisions

Collections are independent of Categories. Version 1 has manual product UUID membership,
many-to-many links, bilingual names, optional descriptions, three states, collection and
member ordering, no cover/SEO/homepage fields, and no automatic selection rules. Both
names must be nonblank before publication; descriptions may remain empty. An empty
collection may be Published, but its public page is empty and `noindex`. A product that
becomes unpublished remains linked and disappears from public membership. No existing
Catalog table, five-file Import contract, RFQ object, or product primary-category rule
is altered by this draft.

## Proposed database contract

`catalog_private.collections` has `id uuid` primary key, `slug text` unique and restricted
to at most 200 lower-case ASCII URL characters, `name_en`, `name_zh`, `description_en`,
`description_zh` text, `status` (`draft|published|retired`), integer `sort_order`, immutable
first `published_at`, and `created_at`/`updated_at`. Names and descriptions default to
empty strings for Draft creation; Published requires both names to be nonblank. The
description fields have no publication requirement. A trigger sets timestamps, prevents
physical collection deletion, protects identity and creation time, rejects every update
after retirement, and protects Slug forever once `published_at` exists. Draft → Published,
Published → Draft, Draft/Published → Retired, and Draft → Retired are accepted;
Retired is terminal. An insert with Published status is equivalent to first publication
and needs valid names. `published_at` remains set on Published → Draft.

`catalog_private.product_collections` has `collection_id uuid`, `product_id uuid`, and
`sort_order integer`. `(collection_id, product_id)` is the primary key; both foreign
keys use `ON DELETE RESTRICT`. The same product can appear in different collections,
but not twice in one. Duplicate sort values are legal and resolved by product UUID:
`ORDER BY sort_order, product_id`. `created_at` is omitted because no current
requirement uses membership age. Physical removal of a link is a future separately
authorized write operation; neither read role gets it.

Publication does **not** require a published member. This avoids an invalid cross-table
promise after a product's status changes without modifying the existing products table.
The public projection instead filters collection and product status at read time. It
must not be called a cross-request snapshot. A server rendering multiple queries must
use one read-only `REPEATABLE READ` transaction or a single statement if it requires
one consistent page image. B5-S3 two-session tests cover status changes, row-lock
serialization, Slug immutability and rollback; concurrent inserts and reorders remain
future read-path test cases.

## Privileges, RLS and projection

Both new private tables enable RLS and default-deny. `anon` receives no private schema
table grant. The existing `catalog_admin_reader_runtime` and `catalog_public_reader`
roles receive explicit SELECT only on the two new tables, each with two SELECT policies.
The Admin policy reads all collection statuses; the public reader policy admits only
Published collections and links whose collection and product are both Published.
There is no write role, write API, or Catalog Import grant in this draft.

Two `catalog_public` views project explicit safe columns. They have `security_barrier`
and are owned by the existing non-login, non-bypass `catalog_public_reader`, following
the Catalog Foundation pattern. Only the views get `anon` SELECT. The migration draft
checks prerequisite role attributes and membership, rejects existing public-schema
CREATE grants to the public reader or anon, rejects unknown or write-capable default
ACL grants on the new private tables, rejects unexpected trigger-function EXECUTE
grants, and checks effective anon/private and both reader roles' write privileges.
These checks must be rerun against the approved deployment target; local outcomes
cannot prove the cloud target's effective permissions. No view exposes `storage_key`,
private connection information, or unpublished rows.

The future Admin route must require `catalog.read` before creating/using a source, and
the Repository must authorize again before any source call. Public and Admin DTOs must
be separate allowlists. Proposed bounded reads: 25 items by default, 50 maximum, plus
one probe row; stable collection key `(sort_order,id)` and membership key
`(sort_order,product_id)`. If completeness cannot be proven, return `INCOMPLETE` or
`ERROR`, never an apparently empty complete collection. No source fallback may replace
a failed database read with mock data.

## Tests and evidence interpretation

`node --test scripts/test-collections-schema-offline.mjs` audits the draft's scope,
contract markers and ACL clauses without a database. It cannot prove PostgreSQL syntax,
RLS semantics, view ownership, transaction rollback, or concurrency.

`RUN_LOCAL_COLLECTIONS_SCHEMA_TESTS=1 node --test scripts/test-collections-schema-postgres-local.mjs`
targets only the existing Beauty B2B PostgreSQL 17 test cluster at port 55432. It checks
the physical data directory, database, loopback listener and version before executing
the draft. All DDL and synthetic collection rows run in a transaction that is rolled
back. The script exercises the database-observable cases and extra view and policy checks.
`RUN_LOCAL_COLLECTIONS_CONCURRENCY_TESTS=1 node --test scripts/test-collections-schema-postgres-local.mjs`
uses the same verified dedicated cluster but creates a separate disposable database
with only synthetic prerequisite objects. It applies the **draft**, not a formal
migration, commits the test structure so two sessions can see it, runs concurrency
cases, then drops the entire disposable database and verifies its absence. It refuses
to overwrite a pre-existing database with that name. This test has no Supabase or
production authority.

| Acceptance area | Offline | Dedicated PostgreSQL |
| --- | --- | --- |
| Draft, Slug, states, names, empty publication | draft structure | constraints and trigger results |
| Membership FK, duplicate, many-to-many, stable order | key structure | inserts and ordered SELECT |
| Product/collection unpublication | required status predicates | public view results with rolled-back status changes |
| Anonymous, runtime, DTO whitelist | grant/column review | SET ROLE, information_schema, view owner/RLS checks |
| Failure rollback | transaction markers | forced failure followed by absence check |
| Two-session state races and transaction snapshots | design review | separate disposable-database harness |

## Deployment and rollback gate

Before any migration proposal, independently verify approved Catalog project identity,
Foundation and Admin Read Runtime migration state, effective role/ACL snapshot, default
privileges, owner rights, and no unexpected Collections objects. Cloud Catalog migration
approval is separate and remains absent. The future additive migration must be reviewed
and tested on an approved isolated PostgreSQL instance before cloud deployment. A
failure before COMMIT must roll back every new object and privilege. A post-COMMIT
failure requires an approved forward repair or controlled restore; never auto-drop
tables containing collection relationships. The Catalog Import and RFQ projects are
outside this release.

## Unresolved deployment checks

- Confirm the target's actual default ACL and all effective grants; the draft fails
  closed when an unreviewed private-table grantee appears.
- Confirm the approved migration executor can transfer view ownership to
  `catalog_public_reader` without retaining CREATE or extra privileges.
- Verify public-view RLS under actual target role identities and PostgreSQL version.
- Decide whether empty Published collections should use HTTP 200 with `noindex` or a
  different public routing policy. This draft recommends 200 plus an explicit empty
  state and `noindex`; it does not modify frontend routes.
- Implement and test bounded keyset reads, authorization zero-call behavior, and
  concurrent read consistency in later approved B5 work.
