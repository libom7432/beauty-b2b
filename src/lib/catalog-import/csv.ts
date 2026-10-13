/** B4.2 pure CSV transport parser. No database, filesystem, or network access. */
export type ImportFileName = "products.csv" | "product_translations.csv" | "product_variants.csv" | "product_categories.csv" | "product_images.csv";
export type ImportIssue = {
  error_code: string;
  field_path: string;
  message: string;
  severity: "error" | "warning";
  file_name: string;
  row_number?: number;
  product_code?: string;
  sku?: string;
  conflict_file_name?: string;
  conflict_row_number?: number;
};
export type CellState =
  | { kind: "missing" }
  | { kind: "blank"; raw: "" }
  | { kind: "clear"; raw: "__CLEAR__"; value: null | "" | Record<string, never> | [] }
  | { kind: "value"; raw: string; value: string | number | boolean | Record<string, unknown> | unknown[] };
export type ImportRow = {
  file_name: ImportFileName;
  row_number: number;
  operation: "create" | "update" | null;
  product_code?: string;
  sku?: string;
  fields: Record<string, CellState>;
  /** Typed values only; missing/blank update fields are omitted. Create defaults are supplied. */
  data: Record<string, unknown>;
};
export type ProductPatch = {
  operation: "create" | "update";
  product_code: string;
  product: Record<string, unknown>;
  variants: Record<string, unknown>[];
  translations: Record<string, unknown>[];
  categories: Record<string, unknown>[];
  images: Record<string, unknown>[];
  /** Original parsed rows keep all four cell states after grouping. */
  source: { product: ImportRow; variants: ImportRow[]; translations: ImportRow[]; categories: ImportRow[]; images: ImportRow[] };
};
export type ImportParseResult = { valid: boolean; issues: ImportIssue[]; rows: Record<ImportFileName, ImportRow[]>; products: ProductPatch[] };
export type CsvInput = string | Uint8Array;
export type ImportFiles = Partial<Record<ImportFileName, CsvInput>>;
export type ImportOptions = {
  knownProductCodes?: ReadonlySet<string>;
  maxFileBytes?: number;
  maxRows?: number;
  maxFieldChars?: number;
};

type ColumnKind = "text" | "integer" | "positiveInteger" | "positiveInt32" | "nonnegativeInteger" | "price" | "boolean" | "jsonObject" | "jsonArray" | "uuid" | "operation" | "status" | "locale" | "imageRole" | "imageFormat" | "productType" | "currency";
type Column = { kind: ColumnKind; createRequired?: boolean; headerRequired?: boolean; clear?: null | "" | "object" | "array"; default?: unknown };
const column = (kind: ColumnKind, extra: Omit<Column, "kind"> = {}): Column => ({ kind, ...extra });
const common = { operation: column("operation", { createRequired: true, headerRequired: true }), product_code: column("text", { createRequired: true, headerRequired: true }) };
const status = () => column("status", { default: "draft" });
const sort = () => column("integer", { default: 0 });
const bool = () => column("boolean", { default: false });
const nullableInt = (kind: ColumnKind = "nonnegativeInteger") => column(kind, { default: null, clear: null });
const schemas: Record<ImportFileName, Record<string, Column>> = {
  "products.csv": {
    ...common, slug: column("text", { createRequired: true, headerRequired: true }), product_type: column("productType", { createRequired: true, headerRequired: true }),
    status: status(), attributes: column("jsonObject", { default: {}, clear: "object" }), customization_options: column("jsonArray", { default: [], clear: "array" }),
    oem: bool(), odm: bool(), lead_time_min_days: nullableInt(), lead_time_max_days: nullableInt(), seo_indexable: bool(), featured: bool(), new_arrival: bool(),
  },
  "product_translations.csv": {
    ...common, locale: column("locale", { createRequired: true, headerRequired: true }),
    name: column("text", { default: "", clear: "" }), short_description: column("text", { default: "", clear: "" }),
    description: column("text", { default: "", clear: "" }), seo_title: column("text", { default: "", clear: "" }), seo_description: column("text", { default: "", clear: "" }),
  },
  "product_variants.csv": {
    ...common, sku: column("text", { createRequired: true, headerRequired: true }), status: status(), attributes: column("jsonObject", { default: {}, clear: "object" }),
    moq_quantity: column("positiveInteger", { createRequired: true, headerRequired: true }), moq_unit: column("text", { createRequired: true, headerRequired: true }),
    order_multiple: nullableInt("positiveInteger"), package_quantity: nullableInt("positiveInteger"), package_unit: column("text", { default: null, clear: null }),
    reference_price: column("price", { default: null, clear: null }), reference_currency: column("currency", { default: null, clear: null }), sort_order: sort(),
  },
  "product_categories.csv": { ...common, category_id: column("uuid", { createRequired: true, headerRequired: true }), is_primary: bool(), sort_order: sort() },
  "product_images.csv": {
    ...common, image_id: column("uuid"), sku: column("text", { default: null, clear: null }), source_file: column("text", { default: null }),
    storage_key: column("text", { createRequired: true, headerRequired: true }), public_url: column("text", { createRequired: true, headerRequired: true }),
    role: column("imageRole", { createRequired: true, headerRequired: true }), status: status(), sort_order: sort(), width: nullableInt("positiveInt32"),
    height: nullableInt("positiveInt32"), format: column("imageFormat", { default: null, clear: null }), alt_en: column("text", { default: "", clear: "" }), alt_zh: column("text", { default: "", clear: "" }),
  },
};
export const IMPORT_FILE_NAMES = Object.freeze(Object.keys(schemas) as ImportFileName[]);
/** Canonical B4.1 columns, shared with the workbook adapter to prevent a second schema. */
export function getImportCsvColumns(file: ImportFileName): readonly string[] {
  return Object.freeze(Object.keys(schemas[file]));
}
/** Call before RFC 4180 quoting if untrusted text is ever exported for spreadsheet use. */
export function safeSpreadsheetText(value: string): string {
  return /^\s*[=+\-@]/.test(value) || /^[\t\r]/.test(value) ? `'${value}` : value;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATES = new Set(["draft", "published", "retired"]);
const TYPES = new Set(["press_on_nails", "gel_polish", "regular_nail_polish"]);
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_ROWS = 10_000;
const DEFAULT_MAX_FIELD = 32_768;
const MAX_COLUMNS = 64;
const BLOCKED_JSON_KEYS = new Set(["__proto__", "prototype", "constructor"]);

type RawRecord = { row_number: number; values: string[] };
function issue(file_name: string, error_code: string, field_path: string, message: string, row_number?: number, product_code?: string, sku?: string, severity: "error" | "warning" = "error"): ImportIssue {
  return { error_code, field_path, message, severity, file_name, ...(row_number === undefined ? {} : { row_number }), ...(product_code ? { product_code } : {}), ...(sku ? { sku } : {}) };
}

function decode(file_name: string, input: CsvInput, maxBytes: number, issues: ImportIssue[]): string | null {
  if (typeof input === "string") for (let i = 0; i < input.length; i++) {
    const unit = input.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = input.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) { issues.push(issue(file_name, "INVALID_UNICODE", "$", "CSV contains an unpaired Unicode surrogate")); return null; }
    } else if (unit >= 0xdc00 && unit <= 0xdfff) { issues.push(issue(file_name, "INVALID_UNICODE", "$", "CSV contains an unpaired Unicode surrogate")); return null; }
  }
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  if (bytes.byteLength > maxBytes) { issues.push(issue(file_name, "FILE_TOO_LARGE", "$", `CSV exceeds ${maxBytes} bytes`)); return null; }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    // TextDecoder's BOM handling differs between runtimes; remove exactly one leading BOM.
    const text = decoded.startsWith("\uFEFF") ? decoded.slice(1) : decoded;
    if (text.includes("\uFEFF")) issues.push(issue(file_name, "UNEXPECTED_BOM", "$", "BOM is allowed only at the start of a file"));
    if (text.includes("\0")) issues.push(issue(file_name, "NUL_BYTE", "$", "NUL bytes are not allowed"));
    return text;
  } catch { issues.push(issue(file_name, "INVALID_UTF8", "$", "CSV must be UTF-8")); return null; }
}

/** RFC 4180 state machine; records start at physical line numbers and may span lines. */
function readRecords(file_name: string, source: string, maxRows: number, maxField: number, issues: ImportIssue[]): RawRecord[] {
  const records: RawRecord[] = [];
  let row: string[] = [], field = "", mode: "start" | "bare" | "quoted" | "closed" = "start";
  let line = 1, rowLine = 1, bad = false, overflow = false, rowLimitReported = false, seenRecords = 0;
  const append = (char: string) => {
    if (field.length < maxField) field += char;
    else if (!overflow) { issues.push(issue(file_name, "FIELD_TOO_LONG", `columns[${row.length}]`, `Field exceeds ${maxField} characters`, rowLine)); overflow = true; bad = true; }
  };
  const endField = () => {
    if (row.length < MAX_COLUMNS) row.push(field);
    else if (!bad) { issues.push(issue(file_name, "COLUMN_LIMIT", "$", `CSV exceeds ${MAX_COLUMNS} columns`, rowLine)); bad = true; }
    field = ""; mode = "start"; overflow = false;
  };
  const endRecord = () => {
    endField();
    if (!(row.length === 1 && row[0] === "")) {
      seenRecords++;
      if (seenRecords > maxRows + 1) { if (!rowLimitReported) issues.push(issue(file_name, "ROW_LIMIT", "$", `CSV exceeds ${maxRows} data rows`, rowLine)); rowLimitReported = true; }
      else if (!bad) records.push({ row_number: rowLine, values: row });
    }
    row = []; bad = false; rowLine = line + 1;
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (mode === "quoted") {
      if (c === '"') { if (source[i + 1] === '"') { append('"'); i++; } else mode = "closed"; }
      else if (c === "\r" || c === "\n") { if (c === "\r" && source[i + 1] === "\n") i++; append("\n"); line++; }
      else append(c);
      continue;
    }
    if (c === "\r" || c === "\n") { if (c === "\r" && source[i + 1] === "\n") i++; endRecord(); line++; continue; }
    if (c === ",") { endField(); continue; }
    if (mode === "start") { if (c === '"') mode = "quoted"; else { mode = "bare"; append(c); } }
    else if (mode === "bare") { if (c === '"') { if (!bad) issues.push(issue(file_name, "CSV_QUOTE", `columns[${row.length}]`, "Quote inside an unquoted field", rowLine)); bad = true; } else append(c); }
    else { if (!bad) issues.push(issue(file_name, "CSV_QUOTE", `columns[${row.length}]`, "Characters after a closing quote", rowLine)); bad = true; mode = "bare"; }
  }
  if (mode === "quoted") issues.push(issue(file_name, "CSV_UNCLOSED_QUOTE", `columns[${row.length}]`, "Quoted field is not closed", rowLine));
  else if (row.length || field || mode !== "start") endRecord();
  return records;
}

function safeJson(raw: string, wantArray: boolean): unknown {
  const value: unknown = JSON.parse(raw);
  if (wantArray ? !Array.isArray(value) : value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Wrong JSON container type");
  const visit = (entry: unknown, depth: number): void => {
    if (depth > 16) throw new Error("JSON nesting is too deep");
    if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("JSON number is not finite");
    if (Array.isArray(entry)) for (const item of entry) visit(item, depth + 1);
    else if (entry && typeof entry === "object") for (const [key, item] of Object.entries(entry)) {
      if (BLOCKED_JSON_KEYS.has(key)) throw new Error("Reserved JSON key");
      visit(item, depth + 1);
    }
  };
  visit(value, 0);
  return value;
}

function convert(raw: string, kind: ColumnKind): unknown {
  if (kind === "text") return raw;
  if (kind === "jsonObject" || kind === "jsonArray") {
    if (raw.includes("\n") || raw.includes("\r")) throw new Error("JSON cell must be one line");
    return safeJson(raw, kind === "jsonArray");
  }
  if (kind === "boolean") { if (raw === "true") return true; if (raw === "false") return false; throw new Error("Expected true or false"); }
  if (kind === "integer" || kind === "positiveInteger" || kind === "positiveInt32" || kind === "nonnegativeInteger") {
    if (!/^-?\d+$/.test(raw)) throw new Error("Expected a decimal integer");
    const value = Number(raw);
    const max = kind === "positiveInteger" ? Number.MAX_SAFE_INTEGER : 2147483647;
    if (!Number.isSafeInteger(value) || value > max || (kind === "positiveInteger" || kind === "positiveInt32" ? value <= 0 : kind === "nonnegativeInteger" ? value < 0 : value < -2147483648)) throw new Error("Integer outside allowed range");
    return value;
  }
  if (kind === "price") {
    if (!/^\d+(?:\.\d{1,4})?$/.test(raw) || Number(raw) <= 0 || Number(raw) > 9999999999.9999) throw new Error("Expected positive numeric(14,4)");
    return Number(raw);
  }
  if (kind === "uuid") { if (!UUID.test(raw)) throw new Error("Expected UUID"); return raw; }
  const choices: Record<string, ReadonlySet<string>> = {
    operation: new Set(["create", "update"]), status: STATES, locale: new Set(["en", "zh"]), imageRole: new Set(["primary", "detail", "variant"]),
    imageFormat: new Set(["jpeg", "png", "webp", "avif"]), productType: TYPES, currency: CURRENCIES,
  };
  if (!choices[kind]?.has(raw)) throw new Error(`Invalid ${kind} value`);
  return raw;
}

function normalizeRow(file_name: ImportFileName, header: string[], raw: RawRecord, issues: ImportIssue[]): ImportRow {
  const spec = schemas[file_name];
  const cells: Record<string, CellState> = {};
  const data: Record<string, unknown> = {};
  const source: Record<string, string> = {};
  header.forEach((name, i) => { if (Object.hasOwn(spec, name)) source[name] = raw.values[i] ?? ""; });
  const code = source.product_code || undefined;
  const sku = source.sku || undefined;
  const op = source.operation === "create" || source.operation === "update" ? source.operation : null;
  for (const [name, rule] of Object.entries(spec)) {
    const path = name;
    const base = (error_code: string, message: string, severity: "error" | "warning" = "error") => issues.push(issue(file_name, error_code, path, message, raw.row_number, code, sku, severity));
    if (!Object.hasOwn(source, name)) {
      cells[name] = { kind: "missing" };
      if (op === "create" && rule.createRequired) base("REQUIRED_FIELD", "Required create field was not provided");
      else if (op === "create" && Object.hasOwn(rule, "default")) data[name] = rule.default;
      continue;
    }
    const value = source[name];
    if (value === "") {
      cells[name] = { kind: "blank", raw: "" };
      if (op === "create" && rule.createRequired) base("REQUIRED_FIELD", "Required create field is blank");
      else if (op === "create" && Object.hasOwn(rule, "default")) data[name] = rule.default;
      continue;
    }
    if (value === "__CLEAR__") {
      if (rule.clear === undefined || name === "operation" || name === "product_code") { base("CLEAR_NOT_ALLOWED", "This field cannot be cleared"); cells[name] = { kind: "clear", raw: "__CLEAR__", value: null }; continue; }
      const cleared = rule.clear === "object" ? {} : rule.clear === "array" ? [] : rule.clear;
      cells[name] = { kind: "clear", raw: "__CLEAR__", value: cleared };
      if (op === "update") data[name] = cleared;
      else base("CLEAR_ON_CREATE", "Clear marker is only valid on update");
      continue;
    }
    try {
      const parsed = convert(value, rule.kind);
      cells[name] = { kind: "value", raw: value, value: parsed as string | number | boolean | Record<string, unknown> | unknown[] };
      if (name !== "operation" && name !== "source_file") data[name] = parsed;
      if ((name === "product_code" || name === "sku") && value.trim() !== value) base("INVALID_BUSINESS_KEY", "Business key must not have surrounding whitespace");
      if (name === "source_file" && (value.startsWith("/") || value.includes("\\") || value.split("/").some((segment) => segment === ".." || segment === ""))) base("INVALID_SOURCE_FILE", "Source file must be a safe relative path");
      if (rule.kind === "text" && safeSpreadsheetText(value) !== value) base("FORMULA_RISK", "Text needs formula escaping before spreadsheet export", "warning");
    } catch { cells[name] = { kind: "value", raw: value, value }; base("INVALID_VALUE", `Invalid ${rule.kind} value`); }
  }
  if (file_name === "product_images.csv") {
    if (op === "update" && cells.image_id.kind !== "value") issues.push(issue(file_name, "IMAGE_ID_REQUIRED", "image_id", "Image update requires an image UUID", raw.row_number, code, sku));
    if (op === "create" && cells.image_id.kind === "value") issues.push(issue(file_name, "IMAGE_ID_ON_CREATE", "image_id", "New image must not supply an existing UUID", raw.row_number, code, sku));
  }
  return { file_name, row_number: raw.row_number, operation: op, ...(code ? { product_code: code } : {}), ...(sku ? { sku } : {}), fields: cells, data };
}

function parseOne(file_name: ImportFileName, input: CsvInput | undefined, limits: Required<Pick<ImportOptions, "maxFileBytes" | "maxRows" | "maxFieldChars">>, issues: ImportIssue[]): ImportRow[] {
  if (input === undefined) return [];
  const source = decode(file_name, input, limits.maxFileBytes, issues);
  if (source === null) return [];
  if (source === "") { issues.push(issue(file_name, "EMPTY_FILE", "$", "CSV file is empty")); return []; }
  const records = readRecords(file_name, source, limits.maxRows, limits.maxFieldChars, issues);
  if (!records.length) { issues.push(issue(file_name, "MISSING_HEADER", "$", "CSV header is missing")); return []; }
  const header = records[0].values;
  const names = new Set<string>();
  for (let i = 0; i < header.length; i++) {
    const name = header[i];
    if (!name) issues.push(issue(file_name, "EMPTY_HEADER", `header[${i}]`, "Header name is blank", records[0].row_number));
    else if (names.has(name)) issues.push(issue(file_name, "DUPLICATE_HEADER", `header[${i}]`, "Header is duplicated", records[0].row_number));
    else if (!Object.hasOwn(schemas[file_name], name)) issues.push(issue(file_name, "UNKNOWN_HEADER", `header[${i}]`, "Header is not in this CSV contract", records[0].row_number));
    names.add(name);
  }
  for (const [name, rule] of Object.entries(schemas[file_name])) if (rule.headerRequired && !names.has(name)) issues.push(issue(file_name, "MISSING_REQUIRED_HEADER", name, "Required header is missing", records[0].row_number));
  const rows: ImportRow[] = [];
  for (const record of records.slice(1)) {
    if (record.values.length !== header.length) { issues.push(issue(file_name, "COLUMN_COUNT", "$", `Expected ${header.length} columns; got ${record.values.length}`, record.row_number)); continue; }
    rows.push(normalizeRow(file_name, header, record, issues));
  }
  return rows;
}

export function parseCatalogCsvBundle(files: ImportFiles, options: ImportOptions = {}): ImportParseResult {
  const issues: ImportIssue[] = [];
  const supplied = Object.keys(files);
  if (!supplied.length) issues.push(issue("$bundle", "NO_FILES", "$", "At least one CSV file is required"));
  for (const name of supplied) if (!Object.hasOwn(schemas, name)) issues.push(issue(name, "UNKNOWN_FILE", "$", "File name is outside the five-file contract"));
  const limits = { maxFileBytes: options.maxFileBytes ?? DEFAULT_MAX_BYTES, maxRows: options.maxRows ?? DEFAULT_MAX_ROWS, maxFieldChars: options.maxFieldChars ?? DEFAULT_MAX_FIELD };
  const rows = {} as Record<ImportFileName, ImportRow[]>;
  for (const file_name of IMPORT_FILE_NAMES) rows[file_name] = parseOne(file_name, files[file_name], limits, issues);
  const known = new Set(options.knownProductCodes);
  for (const row of rows["products.csv"]) if (row.product_code) known.add(row.product_code);
  const seen = new Map<string, { file_name: ImportFileName; row_number: number }>();
  for (const file_name of IMPORT_FILE_NAMES) for (const row of rows[file_name]) {
    if (file_name !== "products.csv" && row.product_code && !known.has(row.product_code)) issues.push(issue(file_name, "UNKNOWN_PRODUCT_REFERENCE", "product_code", "Referenced product is absent from this batch and supplied existing codes", row.row_number, row.product_code, row.sku));
    const rawField = (name: string) => row.fields[name]?.kind === "value" ? row.fields[name].raw : undefined;
    const key = file_name === "products.csv" ? row.product_code
      : file_name === "product_variants.csv" ? row.sku
      : file_name === "product_translations.csv" ? row.product_code && rawField("locale") ? `${row.product_code}\0${rawField("locale")}` : undefined
      : file_name === "product_categories.csv" ? row.product_code && rawField("category_id") ? `${row.product_code}\0${rawField("category_id")}` : undefined
      : row.operation === "update" ? rawField("image_id") ? `id:${rawField("image_id")}` : undefined
      : rawField("storage_key") ? `key:${rawField("storage_key")}` : undefined;
    if (!key) continue;
    const scoped = `${file_name}\0${key}`;
    const first = seen.get(scoped);
    if (first) issues.push({ ...issue(file_name, "DUPLICATE_BUSINESS_RECORD", "$", "Business record is duplicated in this batch", row.row_number, row.product_code, row.sku), conflict_file_name: first.file_name, conflict_row_number: first.row_number });
    else seen.set(scoped, { file_name, row_number: row.row_number });
  }
  const products = rows["products.csv"].filter((row): row is ImportRow & { product_code: string; operation: "create" | "update" } => !!row.product_code && !!row.operation).map((row) => {
    const variantRows = rows["product_variants.csv"].filter((child) => child.product_code === row.product_code);
    const translationRows = rows["product_translations.csv"].filter((child) => child.product_code === row.product_code);
    const categoryRows = rows["product_categories.csv"].filter((child) => child.product_code === row.product_code);
    const imageRows = rows["product_images.csv"].filter((child) => child.product_code === row.product_code);
    const variants = variantRows.map((child) => ({ ...child.data }));
    const translations = translationRows.map((child) => ({ ...child.data }));
    const categories = categoryRows.map((child) => ({ ...child.data }));
    const images = imageRows.map((child) => ({ ...child.data }));
    return { operation: row.operation, product_code: row.product_code, product: { ...row.data, variants, translations, categories, images }, variants, translations, categories, images,
      source: { product: row, variants: variantRows, translations: translationRows, categories: categoryRows, images: imageRows } };
  });
  return { valid: !issues.some((entry) => entry.severity === "error"), issues, rows, products };
}
