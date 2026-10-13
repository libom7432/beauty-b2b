# Sprint 2.5-B2 catalog database foundation

The catalog migration is `supabase/migrations/20261013120000_create_catalog_foundation.sql`.
It creates an independent `catalog_private` schema with six tables and a
`catalog_public` schema with six read-only, explicit-column views. It does not
change Mock Catalog, RFQ tables, RFQ roles, or the application data source.

## Data model

- `products`: UUID identity, globally unique immutable product code, stable
  slug, product type, draft/published/retired status, `published_at`, shared
  JSONB attributes and customization options, OEM/ODM, lead time, SEO flag.
- `product_variants`: UUID identity, globally unique immutable SKU, status,
  scalar JSONB option values, MOQ and unit, optional order multiple, package
  contents, optional reference price and currency. A normalized JSONB unique
  index prevents duplicate option combinations within one product.
- `categories`: UUID identity, parent tree, sibling-unique slug, status and
  bilingual names/descriptions. Cycles and changes to published URL segments
  are rejected.
- `product_categories`: many-to-many links, with a unique primary link per
  product. Publication requires exactly one active primary category.
- `product_images`: product images and optional same-product SKU association;
  role/status/order, URL, storage key, dimensions, format, bilingual ALT.
- `product_translations`: one English and one Chinese row for a published
  product, including display and SEO text.

Rows in `products`, `product_variants`, and `categories` cannot be physically
deleted. Codes and SKUs cannot be changed. A slug cannot be changed after a
product was ever published. Future slug changes require a separate alias and
redirect registry. Published products must have a published SKU, published
primary category, complete English and Chinese translations, and a published
primary image with both ALT texts. A retired product cannot retain a published
SKU. Deferred constraint triggers check the final state at transaction end and
also run when related rows are inserted, updated, or deleted.

## Permissions

`anon` receives only `USAGE` on `catalog_public` and `SELECT` on its views.
It receives no `catalog_private` schema usage, table grants, or writes. Views
filter product, SKU, category, image and translation status and expose only
listed columns. Their owner is the dedicated `catalog_public_reader` role,
which is `NOLOGIN NOINHERIT`, has no RLS bypass, receives base-table SELECT
but no writes, and has matching published-only RLS policies. The views use
`security_barrier=true`. Do not grant untrusted users ownership, membership
in `catalog_public_reader`, or `CREATE` on either schema. No function uses
`SECURITY DEFINER`.

`catalog_admin` and `catalog_import` are `NOLOGIN NOINHERIT` roles. The admin
role has private table read/write/delete grants; the import role has
read/insert/update grants but no delete. Private tables have RLS enabled and
role-specific policies. PostgreSQL grants and RLS both apply: an RLS policy
does not itself grant table access. A trusted owner or superuser can bypass
RLS, so production server credentials must be selected and reviewed
separately. The migration grants no database `CONNECT` or role membership.
It does not grant `rfq_api` any catalog access. Do not expose either schema
through an API or connect a production catalog adapter in this sprint.

## Local test

`scripts/test-catalog-schema.mjs` applies the migration only when all of these
are true: explicit enable switch, URL host `127.0.0.1`, port `55439`, database
`catalog_schema_test`, PostgreSQL 17+, exact expected data directory, no
existing catalog/RFQ schema. It creates a local `anon NOLOGIN` stand-in if
needed. Use a **fresh, disposable local cluster/database** for every run.
The test checks publication, deletion and update guards, option combination
uniqueness, cross-product image references, immutable identifiers, actual
anonymous visibility and denied writes, import permissions, untrusted role
inheritance, view ownership and reader RLS. It verifies deferred failures at
`COMMIT`, confirms the previously committed rows remain unchanged, and commits
a valid replacement of SKU, category, image and translation in one transaction.
Only synthetic data is used; the disposable database retains those test rows.

Example invocation, after independently creating a fresh cluster and database
on the stated loopback port:

```sh
CATALOG_TEST_ENABLE=1 \
CATALOG_TEST_DATABASE_URL=postgresql://catalog_test_owner@127.0.0.1:55439/catalog_schema_test \
CATALOG_TEST_DATA_DIR=/absolute/path/to/the/disposable/cluster \
node scripts/test-catalog-schema.mjs
```

Never point this runner or migration at production Supabase. If the expected
local directory or target cannot be verified, do not run the migration.
