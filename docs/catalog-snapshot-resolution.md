# Sprint 2.5-B4.4-A trusted catalog snapshot and identity resolution

This is a pure offline module. It neither opens a database connection nor writes products. It consumes B4.2 `ImportParseResult` from CSV or B4.3 Excel conversion. A future trusted server-side reader must supply **all** current B2 catalog rows to `captureTrustedCatalogSnapshot(rows, templateVersion)`; uploaded files must never be passed to that constructor. In production, only a controlled, server-only, read-only database adapter may call this exported constructor. A TypeScript cast, a server request body, or a caller supplied object does not establish provenance. The function copies and recursively freezes the rows, checks the six table field sets, unique identities, references and core B2 state invariants, and returns an opaque in-process snapshot accepted by `resolveCatalogImport`. The runtime brand prevents accidentally passing a plain import object as a snapshot; it is not authentication or authorization. The future adapter must enforce its own permissions and construct rows from trusted database query results.

## Snapshot contract

`CatalogSnapshotRows` has products, variants, categories, product_categories, images and translations. Each row includes every corresponding B2 SQL business field, UUID/foreign-key identity, status, and creation/update timestamps. Products also carry `published_at`. Reference prices are decimal strings or null, avoiding a forced binary float conversion of PostgreSQL `numeric(14,4)`. No supplier-private table or Mock Catalog identity is present. The snapshot includes all products and categories, including draft and retired records, so global uniqueness and cross-product ownership checks can work. A partial snapshot must not be labeled trusted.

The version is `{ contract: "catalog-snapshot-v1", template_version, digest }`. The SHA-256 digest sorts entities by their database identity and object keys recursively. It covers every B2 business field in the six tables, including product UUID/code/slug/status/attributes, SKU UUID/code/owner/status/attributes, translations, category status/tree/links, image status/role/owner/SKU association, and the *presence* of `published_at`. The template version is also included. It excludes `created_at` and `updated_at` because these are audit timestamps, and the exact `published_at` timestamp because B2 makes it immutable after first publication; its presence is the business fact used by the immutable Slug rule. Identical business state yields the same digest regardless of row or property traversal order. This digest detects stale Dry Run previews; it cannot replace database locks, transaction isolation or uniqueness checks.

## Resolution rules

`resolveCatalogImport(parsed, snapshot, locate?)` returns `{ valid, snapshot_digest, issues, rows }`. It reads B4.2 source rows directly, including child-only batches where `products.csv` is absent. Each resolved row keeps the source file, physical row, operation, business keys, imported typed patch, and any UUID found **only** in the trusted snapshot. If `valid` is false, no returned row may be applied. A caller can provide `locate(row, fieldPath)` to add Excel Sheet and column labels; CSV file and row are always present.

| Entity | Create | Update |
|---|---|---|
| Product | `product_code` must be globally new; UUID remains absent | `product_code` resolves existing UUID; code and previously published Slug remain immutable |
| SKU | Globally new `sku`, explicit parent `product_code` | `sku` resolves existing UUID and must still belong to that product |
| Category link | Existing published category by **category UUID**; no `category_code` exists in B2 | Composite `(product UUID, category UUID)` must exist |
| Translation | Composite `(product UUID, locale)` must be new | Same composite identity must exist |
| Image | No `image_id`; new storage key and explicit product/SKU references | Trusted `image_id` must exist under the given product; SKU reference must stay in that product |

The resolver never matches by name, row order, or image filename. Missing products, SKUs, translations, category links and images generate no operation and remain unchanged. There is no delete or implicit replace action. The B4.1 image `source_file` is upload metadata, not image identity. Categories are supplied by a separate trusted master-data process; the five import files do not create categories.

The confirmed first-phase import policy rejects `retired → draft/published` product transitions. B2 does not itself forbid reactivation, and B3 validates a final retired state but does not enforce transition history; this resolver adds the CSV/Excel transition rule. Published SKUs cannot be attached to a retired product, including when a rejected reactivation is present in the same batch. Full final-product merge and B3 publication validation belong to B4.4-B; the database remains the final authority at write time. A changed product code cannot be inferred as a rename from a CSV row: `update` with an unknown code is rejected, and a row targeting another existing code is treated as that product. The future admin flow needs an explicit trusted identity for any exceptional rename, though B2 currently forbids it.

## Stable error codes

Identity errors include `PRODUCT_ALREADY_EXISTS`, `PRODUCT_NOT_FOUND`, `DUPLICATE_PRODUCT_CODE`, `SKU_ALREADY_EXISTS`, `SKU_NOT_FOUND`, `DUPLICATE_SKU`, `SKU_OWNERSHIP_CONFLICT`, `IMMUTABLE_PRODUCT_IDENTITY`, `IMMUTABLE_SKU_IDENTITY`, `PUBLISHED_SLUG_IMMUTABLE`, `SLUG_CONFLICT`, and `RETIRED_REACTIVATION_FORBIDDEN`. Reference errors include `CATEGORY_NOT_FOUND`, `CATEGORY_UNAVAILABLE`, `CATEGORY_LINK_ALREADY_EXISTS`, `CATEGORY_LINK_NOT_FOUND`, `TRANSLATION_ALREADY_EXISTS`, `TRANSLATION_NOT_FOUND`, `IMAGE_NOT_FOUND`, `IMAGE_OWNERSHIP_CONFLICT`, `IMAGE_SKU_NOT_FOUND`, `IMAGE_SKU_OWNERSHIP_CONFLICT`, `IMAGE_STORAGE_KEY_CONFLICT`, and `IMAGE_ID_ON_CREATE`. B4.2 parser issues are carried forward. Messages do not include database internals.

Run `npm run test:catalog-snapshot`. The tests use synthetic in-memory B2 rows only.
