import ExcelJS from "exceljs";
import yauzl from "yauzl";
import { SaxesParser } from "saxes";
import { StringDecoder } from "node:string_decoder";
import { getImportCsvColumns, IMPORT_FILE_NAMES, parseCatalogCsvBundle } from "./csv.ts";
import type { ImportFileName, ImportOptions, ImportParseResult, ImportIssue } from "./csv.ts";
import { validateCatalogProduct } from "../catalog-validation/index.ts";
import type { CatalogValidationContext, ValidationResult } from "../catalog-validation/index.ts";

export type ExcelColumnMapping = {
  target: string;
  source?: string;
  defaultValue?: string;
  required?: boolean;
  transform?: "none" | "trim" | "lowercase" | "uppercase";
};
export type ExcelSheetMapping = { sheet: string; target: ImportFileName; columns: ExcelColumnMapping[]; headerRow?: number };
export type ExcelMapping = { sheets: ExcelSheetMapping[] };
export type ExcelIssue = Omit<ImportIssue, "file_name"> & {
  file_name?: string;
  sheet_name?: string;
  column_name?: string;
  column_number?: number;
};
export type ExcelOptions = ImportOptions & { maxWorkbookBytes?: number; maxUncompressedBytes?: number; maxSheets?: number; maxEntries?: number; maxCells?: number; validationContext?: Omit<CatalogValidationContext, "operation" | "previous"> };
export type ExcelConversionResult = { valid: boolean; issues: ExcelIssue[]; csvFiles: Partial<Record<ImportFileName, string>>; parsed: ImportParseResult | null; b3Results: { product_code: string; result: ValidationResult }[] };

const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_ENTRIES = 1000;
const MAX_CELLS = 300_000;
const fail = (error_code: string, message: string, extra: Partial<ExcelIssue> = {}): ExcelIssue =>
  ({ error_code, message, severity: "error", field_path: "$", ...extra });

function preflightZip(bytes: Buffer, options: ExcelOptions): Promise<ExcelIssue[]> {
  return new Promise((resolve) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) { resolve([fail("INVALID_WORKBOOK", "Workbook is not a valid XLSX ZIP archive")]); return; }
      const issues: ExcelIssue[] = [];
      let entries = 0, declaredBytes = 0, actualBytes = 0, sheets = 0, cells = 0, settled = false;
      const finish = () => { if (!settled) { settled = true; zip.close(); resolve(issues); } };
      zip.on("entry", (entry) => {
        if (settled) return;
        entries++;
        declaredBytes += entry.uncompressedSize;
        const worksheet = /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.fileName);
        if (worksheet) sheets++;
        if (entries > (options.maxEntries ?? MAX_ENTRIES) || declaredBytes > (options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES)) {
          issues.push(fail("WORKBOOK_LIMIT", "Workbook archive exceeds configured limits")); finish(); return;
        }
        if (sheets > (options.maxSheets ?? MAX_SHEETS)) { issues.push(fail("SHEET_LIMIT", "Workbook has too many worksheets")); finish(); return; }
        if (!entry.fileName.startsWith("xl/") && !entry.fileName.startsWith("_rels/") && !entry.fileName.startsWith("docProps/") && entry.fileName !== "[Content_Types].xml") {
          issues.push(fail("UNSAFE_WORKBOOK_ENTRY", "Workbook contains an unexpected archive entry")); finish(); return;
        }
        if (/vbaProject|externalLinks|embeddings|activeX/i.test(entry.fileName) || entry.fileName.includes("..") || entry.fileName.startsWith("/")) {
          issues.push(fail("UNSAFE_WORKBOOK_ENTRY", "Workbook contains unsupported active or external content")); finish(); return;
        }
        if (!entry.fileName.endsWith("/") && !/\.(xml|rels|png|jpe?g|webp|avif)$/i.test(entry.fileName)) {
          issues.push(fail("UNSAFE_WORKBOOK_ENTRY", "Workbook contains an unsupported archive member")); finish(); return;
        }
        // Stream every entry before ExcelJS sees it. Metadata alone does not bound real inflation.
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { issues.push(fail("INVALID_WORKBOOK", "Workbook archive entry is damaged")); finish(); return; }
          let rows = 0, cellChars = 0, inCell = 0;
          const parser = /\.(xml|rels)$/i.test(entry.fileName) ? new SaxesParser({ xmlns: true }) : null;
          const decoder = parser ? new StringDecoder("utf8") : null;
          if (parser) {
            parser.on("opentag", (tag) => {
              if (tag.local === "Relationship" && Object.values(tag.attributes).some((attribute) => attribute.local === "TargetMode" && attribute.value.toLowerCase() === "external")) {
                issues.push(fail("EXTERNAL_RELATIONSHIP", "Workbook contains an external relationship"));
              }
              if (worksheet && tag.local === "row" && ++rows > (options.maxRows ?? 10_000) + 1) issues.push(fail("ROW_LIMIT", "Worksheet exceeds configured row limit"));
              if (worksheet && tag.local === "c" && ++cells > (options.maxCells ?? MAX_CELLS)) issues.push(fail("CELL_LIMIT", "Workbook exceeds configured cell limit"));
              if ((worksheet && tag.local === "c") || (entry.fileName === "xl/sharedStrings.xml" && tag.local === "si")) { inCell = 1; cellChars = 0; }
              else if (inCell) inCell++;
            });
            parser.on("closetag", () => { if (inCell) inCell--; });
            parser.on("text", (value) => { if (inCell && (cellChars += value.length) > (options.maxFieldChars ?? 32_768)) issues.push(fail("CELL_TEXT_LIMIT", "Workbook cell text exceeds configured length")); });
            parser.on("cdata", (value) => { if (inCell && (cellChars += value.length) > (options.maxFieldChars ?? 32_768)) issues.push(fail("CELL_TEXT_LIMIT", "Workbook cell text exceeds configured length")); });
            parser.on("doctype", () => issues.push(fail("UNSAFE_WORKBOOK_XML", "Workbook XML contains a document type declaration")));
            parser.on("error", () => issues.push(fail("INVALID_WORKBOOK", "Workbook XML is malformed")));
          }
          stream.on("data", (chunk: Buffer) => {
            actualBytes += chunk.length;
            if (actualBytes > (options.maxUncompressedBytes ?? MAX_UNCOMPRESSED_BYTES)) issues.push(fail("WORKBOOK_LIMIT", "Workbook archive exceeds configured limits"));
            if (issues.length) { stream.destroy(); finish(); return; }
            if (parser) {
              try { parser.write(decoder!.write(chunk)); }
              catch { issues.push(fail("INVALID_WORKBOOK", "Workbook XML is malformed")); stream.destroy(); finish(); }
            }
            if (issues.length) { stream.destroy(); finish(); }
          });
          stream.on("error", () => { if (!settled) { issues.push(fail("INVALID_WORKBOOK", "Workbook archive entry is damaged")); finish(); } });
          stream.on("end", () => {
            if (settled) return;
            if (parser) try { parser.write(decoder!.end()); parser.close(); } catch { issues.push(fail("INVALID_WORKBOOK", "Workbook XML is malformed")); }
            if (issues.length) finish(); else zip.readEntry();
          });
        });
      });
      zip.on("error", () => { issues.push(fail("INVALID_WORKBOOK", "Workbook archive is damaged")); finish(); });
      zip.on("end", finish);
      zip.readEntry();
    });
  });
}

function quoted(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
function cellText(value: ExcelJS.CellValue): string | null {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) return null;
    const plain = String(value);
    return /e[+-]?\d/i.test(plain) || plain.replace(/[^0-9]/g, "").length > 15 ? null : plain;
  }
  return null;
}
function isFormula(value: ExcelJS.CellValue): boolean {
  return !!value && typeof value === "object" && ("formula" in value || "sharedFormula" in value);
}
function sourceHeader(cell: ExcelJS.Cell): string | null {
  return typeof cell.value === "string" ? cell.value.trim() : null;
}

/** Convert a mapped workbook to canonical CSV, then immediately run B4.2. No IO beyond the supplied bytes. */
export async function convertCatalogWorkbook(input: Uint8Array, mapping: ExcelMapping, options: ExcelOptions = {}): Promise<ExcelConversionResult> {
  const issues: ExcelIssue[] = [];
  const csvFiles: Partial<Record<ImportFileName, string>> = {};
  const bytes = Buffer.from(input);
  if (bytes.length > (options.maxWorkbookBytes ?? MAX_WORKBOOK_BYTES)) {
    return { valid: false, issues: [fail("WORKBOOK_TOO_LARGE", "Workbook exceeds configured file size")], csvFiles, parsed: null, b3Results: [] };
  }
  if (!bytes.length) return { valid: false, issues: [fail("INVALID_WORKBOOK", "Workbook is empty")], csvFiles, parsed: null, b3Results: [] };
  if (!mapping || !Array.isArray(mapping.sheets) || !mapping.sheets.length) {
    return { valid: false, issues: [fail("INVALID_MAPPING", "At least one explicit sheet mapping is required")], csvFiles, parsed: null, b3Results: [] };
  }
  issues.push(...await preflightZip(bytes, options));
  if (issues.length) return { valid: false, issues, csvFiles, parsed: null, b3Results: [] };
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { return { valid: false, issues: [fail("INVALID_WORKBOOK", "Workbook cannot be parsed")], csvFiles, parsed: null, b3Results: [] }; }
  if (workbook.worksheets.length > (options.maxSheets ?? MAX_SHEETS)) issues.push(fail("SHEET_LIMIT", "Workbook has too many worksheets"));
  const targets = new Set<string>();
  const locationMaps = new Map<ImportFileName, { sheet: string; lines: Map<number, { sheetRow: number; fields: Map<string, { source: string; number: number }> }> }>();
  for (const entry of mapping.sheets) {
    const context = { sheet_name: entry.sheet, file_name: entry.target };
    if (!entry.sheet || !IMPORT_FILE_NAMES.includes(entry.target) || !Array.isArray(entry.columns) || !entry.columns.length || !Number.isInteger(entry.headerRow ?? 1) || (entry.headerRow ?? 1) < 1) {
      issues.push(fail("INVALID_MAPPING", "Sheet mapping is incomplete or invalid", context)); continue;
    }
    if (targets.has(entry.target)) { issues.push(fail("DUPLICATE_SHEET_MAPPING", "Multiple sheets target the same standard file", context)); continue; }
    targets.add(entry.target);
    const sheet = workbook.getWorksheet(entry.sheet);
    if (!sheet) { issues.push(fail("MISSING_SHEET", "Mapped worksheet is missing", context)); continue; }
    if (sheet.rowCount - (entry.headerRow ?? 1) > (options.maxRows ?? 10_000)) {
      issues.push(fail("ROW_LIMIT", "Worksheet exceeds the configured data row limit", context)); continue;
    }
    const headers = new Map<string, number>();
    const headerRow = entry.headerRow ?? 1;
    sheet.getRow(headerRow).eachCell({ includeEmpty: true }, (cell, number) => {
      if (cell.value === null) return;
      const name = sourceHeader(cell);
      if (name === null || !name) { issues.push(fail("INVALID_HEADER", "Header must be nonempty text", { ...context, row_number: headerRow, column_number: number })); return; }
      if (headers.has(name)) issues.push(fail("DUPLICATE_HEADER", "Source header is repeated", { ...context, row_number: headerRow, column_name: name, column_number: number }));
      else headers.set(name, number);
    });
    const targetColumns = getImportCsvColumns(entry.target);
    const mapped = new Map<string, ExcelColumnMapping>();
    const sources = new Set<string>();
    for (const column of entry.columns) {
      const where = { ...context, row_number: headerRow, column_name: column.source, field_path: column.target };
      if (!targetColumns.includes(column.target)) issues.push(fail("UNKNOWN_TARGET_FIELD", "Target field is outside the standard CSV contract", where));
      if (mapped.has(column.target)) issues.push(fail("DUPLICATE_TARGET_FIELD", "Target field is mapped more than once", where));
      if ((column.source === undefined) === (column.defaultValue === undefined)) issues.push(fail("INVALID_MAPPING", "Specify exactly one source column or fixed default", where));
      if (column.defaultValue !== undefined && typeof column.defaultValue !== "string") issues.push(fail("INVALID_MAPPING", "Fixed default must be text", where));
      if (column.source && sources.has(column.source)) issues.push(fail("DUPLICATE_SOURCE_FIELD", "Source column is mapped more than once", where));
      if (column.source && !headers.has(column.source)) issues.push(fail("MISSING_COLUMN", "Mapped source column is absent", where));
      if (column.transform && !["none", "trim", "lowercase", "uppercase"].includes(column.transform)) issues.push(fail("INVALID_TRANSFORM", "Transform is unsupported", where));
      if (typeof column.required !== "undefined" && typeof column.required !== "boolean") issues.push(fail("INVALID_MAPPING", "Required flag must be boolean", where));
      if (column.source) sources.add(column.source);
      mapped.set(column.target, column);
    }
    // Always expose B4.2 mandatory header columns; absent values remain blank and B4.2 reports them.
    const included = targetColumns.filter((name) => mapped.has(name));
    for (const required of ["operation", "product_code", ...(entry.target === "products.csv" ? ["slug", "product_type"] : entry.target === "product_variants.csv" ? ["sku", "moq_quantity", "moq_unit"] : entry.target === "product_translations.csv" ? ["locale"] : entry.target === "product_categories.csv" ? ["category_id"] : ["storage_key", "public_url", "role"])]) {
      if (!mapped.has(required)) issues.push(fail("MISSING_MAPPING", "Required standard field is not mapped", { ...context, field_path: required }));
    }
    if (issues.some((problem) => problem.sheet_name === entry.sheet && problem.severity === "error")) continue;
    const lines = [included.join(",")];
    const locations = new Map<number, { sheetRow: number; fields: Map<string, { source: string; number: number }> }>();
    let csvLine = 2;
    for (let rowNumber = headerRow + 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      if (!row.hasValues) continue;
      const identity = (target: "product_code" | "sku") => {
        const rule = mapped.get(target);
        if (!rule) return undefined;
        const value = rule.source ? cellText(row.getCell(headers.get(rule.source)!).value) : rule.defaultValue;
        return value && value !== "__CLEAR__" ? value : undefined;
      };
      const rowIdentity = { product_code: identity("product_code"), sku: identity("sku") };
      row.eachCell((cell, number) => {
        const columnName = sourceHeader(sheet.getRow(headerRow).getCell(number)) ?? undefined;
        const field = entry.columns.find((rule) => rule.source === columnName)?.target;
        if (isFormula(cell.value)) issues.push(fail("FORMULA_CELL", "Formula cells are not accepted", { ...context, ...rowIdentity, row_number: rowNumber, column_number: number, column_name: columnName, field_path: field ?? "$" }));
      });
      const cells: string[] = [];
      const fields = new Map<string, { source: string; number: number }>();
      for (const target of included) {
        const rule = mapped.get(target)!;
        let value: string | null;
        if (rule.source) {
          const number = headers.get(rule.source)!;
          fields.set(target, { source: rule.source, number });
          const raw = row.getCell(number).value;
          if (isFormula(raw)) { value = ""; }
          else if (raw instanceof Date) { issues.push(fail("UNSUPPORTED_CELL_TYPE", "Date cells require an explicit text export", { ...context, ...rowIdentity, row_number: rowNumber, column_name: rule.source, column_number: number, field_path: target })); value = ""; }
          else { value = cellText(raw); if (value === null) { issues.push(fail("UNSUPPORTED_CELL_TYPE", "Cell type or numeric precision is unsupported", { ...context, ...rowIdentity, row_number: rowNumber, column_name: rule.source, column_number: number, field_path: target })); value = ""; } }
        } else value = rule.defaultValue ?? "";
        if (value && value !== "__CLEAR__") {
          if (rule.transform === "trim") value = value.trim();
          else if (rule.transform === "lowercase") value = value.toLowerCase();
          else if (rule.transform === "uppercase") value = value.toUpperCase();
        }
        if (rule.required && value === "") issues.push(fail("REQUIRED_CELL", "Required mapped cell is blank", { ...context, ...rowIdentity, row_number: rowNumber, column_name: rule.source, column_number: rule.source ? headers.get(rule.source) : undefined, field_path: target }));
        cells.push(quoted(value));
      }
      locations.set(csvLine, { sheetRow: rowNumber, fields });
      const serialized = cells.join(",");
      lines.push(serialized);
      csvLine += 1 + (serialized.match(/\n/g)?.length ?? 0);
    }
    csvFiles[entry.target] = `${lines.join("\n")}\n`;
    locationMaps.set(entry.target, { sheet: entry.sheet, lines: locations });
  }
  const parsed = Object.keys(csvFiles).length ? parseCatalogCsvBundle(csvFiles, options) : null;
  if (parsed) for (const item of parsed.issues) {
    const location = locationMaps.get(item.file_name as ImportFileName);
    const origin = location?.lines.get(item.row_number ?? -1);
    const field = origin?.fields.get(item.field_path);
    issues.push({ ...item, sheet_name: location?.sheet, row_number: origin?.sheetRow ?? item.row_number, column_name: field?.source, column_number: field?.number });
  }
  const b3Results: ExcelConversionResult["b3Results"] = [];
  if (parsed?.valid && options.validationContext) for (const product of parsed.products) {
    // An update patch is not a complete product. B3 must run after the trusted database merge.
    if (product.operation !== "create") continue;
    const result = validateCatalogProduct(product.product, { ...options.validationContext, operation: "create" });
    b3Results.push({ product_code: product.product_code, result });
    const source = product.source.product;
    const location = locationMaps.get("products.csv")?.lines.get(source.row_number);
    for (const item of result.issues) issues.push({ ...item, file_name: "products.csv", sheet_name: locationMaps.get("products.csv")?.sheet,
      row_number: location?.sheetRow ?? source.row_number, product_code: product.product_code });
  }
  return { valid: !issues.some((item) => item.severity === "error"), issues, csvFiles, parsed, b3Results };
}
