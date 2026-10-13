# Sprint 2.5-B4.3 Excel workbook mapping

`convertCatalogWorkbook(bytes, mapping, options)` accepts `.xlsx` bytes and an explicit mapping. It returns canonical five-file CSV text, the B4.2 `parseCatalogCsvBundle` result, and structured issues with original Sheet coordinates. It performs no database or filesystem access, import writes, or formula calculation. The five B4.1 templates remain the source of field names through `getImportCsvColumns`; Excel does not define a second product model.

```ts
const mapping = {
  sheets: [
    { sheet: "商品", target: "products.csv", headerRow: 1, columns: [
      { source: "商品编码", target: "product_code", required: true },
      { source: "链接", target: "slug", required: true, transform: "trim" },
      { source: "品类", target: "product_type", required: true },
      { target: "operation", defaultValue: "create" },
    ] },
    { sheet: "规格", target: "product_variants.csv", columns: [
      { source: "商品编码", target: "product_code", required: true },
      { source: "SKU", target: "sku", required: true },
      { source: "起订量", target: "moq_quantity", required: true },
      { source: "单位", target: "moq_unit", required: true },
      { target: "operation", defaultValue: "create" },
    ] },
  ],
};
```

Each standard file may receive exactly one source Sheet. Every mapped target has one source header **or** one fixed text default. Transform rules are explicit: `none`, `trim`, `lowercase`, `uppercase`. No automatic header detection occurs. Missing Sheets, columns, required target mappings, duplicate source headers and target mappings are errors. Only mapped columns enter output. A blank mapped cell produces B4.2 `blank`; an unmapped target produces `missing`; literal `__CLEAR__` produces `clear` where B4.2 permits it; other values produce `value`. Blank does not clear a stored value.

Before ExcelJS parses the workbook, a streaming ZIP/XML preflight limits the input to 8 MiB compressed, 40 MiB declared **and actual** uncompressed, 1,000 archive entries, 20 worksheet XML files, 10,000 data rows per worksheet, 300,000 cells total, and 32,768 decoded text characters per cell. It reads each archive member, rejects unexpected file types, active content, external relationships, and XML document type declarations. ExcelJS then loads only an accepted workbook; its own object allocation is not a hard resident-memory limit. Formula cells in mapped Sheets are errors, including formulas with cached results. Dates, rich text, links, error cells, and unsafe numeric precision are errors. Text, safe numbers, and booleans become CSV cells. Nothing executes macros or formulas. Import issues include `error_code`, `message`, `severity`, `sheet_name`, `row_number`, `column_name`, `column_number`, `field_path`, and, when known, `product_code` and `sku`.

The returned `csvFiles` can be inspected or saved by a later trusted caller. `parsed.products` is the B4.2 output. When the caller supplies `validationContext`, the converter invokes B3 for complete **create** rows and returns `b3Results` plus their issues. Published creates need a trusted category snapshot in that context. For an **update**, the later database adapter must first resolve immutable identities, merge the patch with current state, and validate the complete final B3 snapshot. The converter deliberately does not run B3 on a partial update. This module does not publish or import anything.

Run `npm run test:catalog-excel` for isolated tests. The module does not modify Mock Catalog, RFQ, or database permissions.
