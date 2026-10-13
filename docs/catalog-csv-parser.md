# Sprint 2.5-B4.2 CSV parser and normalization

This module implements the five CSV files defined in the B4.1 design report. The canonical example templates are separate design artifacts, not part of the application runtime. `src/lib/catalog-import/csv.ts` is pure: it receives strings or UTF-8 bytes and never opens files, connects to a database, uploads images, or writes catalog data.

## API

`parseCatalogCsvBundle(files, options)` accepts a partial object keyed by the five exact file names and returns `{ valid, issues, rows, products }`. `rows` retains each file, physical starting line number, raw cell states, typed values, operation, product code, and SKU. `products` groups child rows by explicit `product_code`, with `variants`, `translations`, `categories`, and `images` arrays on each product object. Each grouped product also has `source` containing the original product and child `ImportRow` objects, so none of the four cell states is lost after aggregation. Its create product shape is ready for B3 structural validation once the caller supplies a real category snapshot. Update objects are **patches**, not full B3 aggregates: B4.4 must resolve immutable identities from trusted database state, build the complete final snapshot, and then run B3. SKU-specific image UUIDs require that same later resolution step.

The input file name and row number are included in each `ImportIssue` alongside B3-style `error_code`, `field_path`, `message`, `severity`, and optional `product_code`/`sku`. A duplicate business-key issue also includes `conflict_file_name` and `conflict_row_number` for the first occurrence. Messages use stable generic wording and never include raw CSV values or database internals. Syntax and row errors are collected where parsing can safely recover. A broken quoted record that spans to EOF cannot be reliably resynchronized, so the parser reports its starting line and stops that file.

## Cell and field rules

Each declared column has one of four cell states: `missing` (optional header absent), `blank` (empty cell), `clear` (`__CLEAR__`), or `value` (raw and typed value). For an update, missing and blank are preserved as separate states but both leave the stored field unchanged; clear emits a typed null, empty string, `{}`, or `[]` only for fields allowed by B4.1. Create uses SQL defaults for optional blank or missing fields. JSON values replace the entire field; no implicit merging occurs.

CSV numbers use decimal ASCII syntax, booleans are lowercase `true`/`false`, and enums are exact. There are no date input columns in the five B4.1 templates; `published_at` and timestamps are database managed. Text and JSON retain their original raw spellings for error display and any future exact decimal write. The parser validates transport types and keys; B3 remains responsible for product templates, publication completeness, category status, SKU combination normalization, image roles/ALT and other business rules. Global create/update existence and ownership checks require the future database adapter. Optional `knownProductCodes` allows a local caller to check child references against an already known code set without any database access inside this module.

Limits default to 2 MiB per file, 10,000 data rows, 32,768 characters per field and 64 columns. UTF-8 decoding is strict; one leading BOM is accepted. Invalid byte sequences, isolated UTF-16 surrogate code units in string inputs, and BOMs elsewhere are reported. LF and CRLF, quoted commas, escaped quotes, and embedded newlines are handled by a state machine. Duplicate/unknown/missing required headers, inconsistent column counts, duplicate business keys, unsafe JSON keys, nonfinite JSON numbers and unsafe relative image source paths are reported. The parser does not execute spreadsheet formulas. Formula-prone text receives `FORMULA_RISK`; a future exporter must call `safeSpreadsheetText` before RFC 4180 quoting and preserve the escaped result as text. No CSV exporter is implemented in this sprint.

Example issue:

```json
{
  "error_code": "INVALID_VALUE",
  "field_path": "moq_quantity",
  "message": "Invalid positiveInteger value",
  "severity": "error",
  "file_name": "product_variants.csv",
  "row_number": 3,
  "product_code": "DEMO-PO-001",
  "sku": "DEMO-PO-001-A"
}
```

Run `npm run test:catalog-csv` for the isolated parser tests. The parser does not import the Mock Catalog or alter RFQ behavior.
