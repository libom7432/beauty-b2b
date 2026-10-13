# Sprint 2.5-B3 catalog validation contract

`src/lib/catalog-validation/index.ts` is a pure, independent validator. It does not import the Mock Catalog, call the database, or write data. The same input shape can be built by a CSV/Excel importer or a future admin form. Call `validateCatalogProduct(input, context)` for one product or `validateCatalogBatch(rows, context)` for an import preview. The batch function uses a one-based row number and detects duplicates among earlier rows as well as in supplied existing-identifier sets.

## Input and context

One input object has the B2 `products` fields plus `variants`, `translations`, `categories`, and `images` arrays matching the six B2 tables. Database-generated UUIDs and timestamps may be omitted for new rows. SQL defaults may be omitted: product/SKU/image status defaults to `draft`, product JSONB fields to `{}` and `[]`, booleans to `false`, and category `is_primary` to `false`. Required SQL fields such as product code, slug, type, SKU, MOQ and unit, image storage key/URL/role, translation locale, and category ID still require values where those rows are present.

The caller supplies a **complete, current** `categories` snapshot for publication checks, plus existing product codes, slugs, SKUs and image storage keys. For edits, set `operation: "update"` and pass trusted `previous` identity: product UUID, original code/slug, prior `published_at`, and maps of existing variant UUID to SKU and image UUID to storage key. These values identify the current row so its own code, slug, SKU, and image key are not mistaken for new duplicates. For a new product, use `operation: "create"` (the single-product default) with no `previous`. The batch API requires explicit envelopes `{ operation, product, previous? }` for every row. Repeated updates of the same product in one batch are rejected. Neither importer nor admin UI may derive `previous` from untrusted spreadsheet data. `templates` may add new product types; it cannot replace the three built-in type templates. Treat templates as trusted application configuration, never as raw import row data.

`product_type` is nonempty text in B2 SQL, so `press_on_nails`, `gel_polish`, and `regular_nail_polish` are **application-level** controlled codes, not a database enum. Product-level and SKU-level attribute definitions are separate. Press-on nails use product `design`/`material` and SKU `nail_shape`/`nail_length`/`nail_size`/`finish`; polish uses product `product_type` and SKU `color`/`volume`/`finish`. Enumerated values are specified in `PRODUCT_TEMPLATES`; open string fields still require nonblank text. Unknown attributes are warnings for drafts and errors for publication. New attribute keys and values require a versioned template update before publishing.

`normalizeVariantAttributes` mirrors the B2 unique-index rule: remove leading/trailing ASCII spaces and lowercase keys; remove leading/trailing ASCII spaces, collapse SQL-style whitespace and lowercase string values; preserve finite numeric and boolean values; reject invalid keys, duplicate normalized keys, empty values and nested/null values. The database remains authoritative for Unicode case and locale-specific POSIX whitespace corner cases, and for concurrent uniqueness conflicts. The validator does not mutate source attributes.

Publication requires one published SKU, exactly one primary category with a published ancestor chain of at most three levels, both complete translations, and one published primary image with bilingual ALT. The result includes `canonical_category_path` when the primary category chain is valid. A retired product cannot have a published SKU. The price is optional; when present, the currency is required and checked against runtime ISO 4217 support. MOQ is per SKU. A below-MOQ inquiry remains a later UI/RFQ policy and is not rejected by this catalog validator.

## Error report

```json
{
  "valid": false,
  "issues": [{
    "error_code": "INVALID_MOQ",
    "field_path": "variants[0].moq_quantity",
    "message": "MOQ must be a positive safe integer",
    "severity": "error",
    "row_number": 12,
    "product_code": "PO-001",
    "sku": "PO-001-A"
  }]
}
```

All detectable errors are collected in one pass. `valid` is false when at least one error exists; warnings alone do not block a draft. For an edit or publication action, the caller must pass the full proposed final product aggregate, including existing related rows, and a current catalog snapshot. This detects removal of the last published SKU, primary category, primary image, or required translation. The application must still handle database uniqueness/constraint errors at write time, including concurrent changes after the snapshot. This phase contains no database adapter, import parser, or UI.

Run `npm run test:catalog-validation` for the standalone test suite.
