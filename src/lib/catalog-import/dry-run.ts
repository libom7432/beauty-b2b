/** Offline, read-only catalog import report. It never constructs a persistence plan. */
import { createHash } from "node:crypto";
import type { ImportParseResult, ImportRow } from "./csv.ts";
import type { ExcelConversionResult } from "./excel.ts";
import { mergeCatalogImport, type FinalCatalogProduct, type ImportChange } from "./merge.ts";
import { catalogSnapshotDigest, type CatalogSnapshot, type SnapshotIssue, type SourceLocator } from "./snapshot.ts";

export type SnapshotVersion = Readonly<{ contract: "catalog-snapshot-v1"; template_version: string; digest: string }>;
export type VersionCheck = "current" | "stale" | "invalid";
export type ImportSource = "csv" | "excel";
export type SourceLocation = {
  file_name?: string; sheet_name?: string; row_number?: number; column_name?: string;
  product_code?: string; sku?: string;
};
export type DryRunFieldChange = {
  entity_type: ImportChange["entity"]; entity_identity: string; field_path: string;
  previous_value: unknown; next_value: unknown; change_type: "created" | "updated" | "cleared";
  source_location: SourceLocation;
};
export type EntityChangeSummary = { created: number; updated: number };
export type ProductDryRunResult = {
  product_code: string; result_status: "created" | "updated" | "unchanged" | "invalid";
  action: "create" | "update" | "none";
  sku_changes: EntityChangeSummary; translation_changes: EntityChangeSummary;
  category_changes: EntityChangeSummary; image_changes: EntityChangeSummary;
  field_changes: DryRunFieldChange[]; errors: SnapshotIssue[]; warnings: SnapshotIssue[];
  source_locations: SourceLocation[];
};
export type CatalogDryRunReport = {
  report_id: string; import_source: { kind: ImportSource; files: string[] };
  snapshot_version: SnapshotVersion; report_status: "ready" | "no_changes" | "invalid";
  can_proceed_to_review: boolean; total_products: number; created_count: number;
  updated_count: number; unchanged_count: number; invalid_count: number;
  error_count: number; warning_count: number; product_results: ProductDryRunResult[];
  field_changes: DryRunFieldChange[]; errors: SnapshotIssue[]; warnings: SnapshotIssue[];
};

const FILES = ["products.csv", "product_variants.csv", "product_translations.csv", "product_categories.csv", "product_images.csv"] as const;
const SAFE_FIELDS: Readonly<Record<ImportChange["entity"], ReadonlySet<string>>> = {
  product: new Set(["slug", "product_type", "status", "oem", "odm", "lead_time_min_days", "lead_time_max_days", "seo_indexable", "featured", "new_arrival"]),
  variant: new Set(["status", "moq_quantity", "moq_unit", "order_multiple", "package_quantity", "package_unit", "reference_currency", "sort_order"]),
  translation: new Set(), category: new Set(["is_primary", "sort_order"]),
  image: new Set(["role", "status", "sort_order", "width", "height", "format"]),
};
const REDACTED = "[redacted]";
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

function stable(value: unknown): string {
  const normalize = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") return Object.fromEntries(Object.keys(entry).sort(compare)
      .filter((key) => (entry as Record<string, unknown>)[key] !== undefined)
      .map((key) => [key, normalize((entry as Record<string, unknown>)[key])]));
    if (typeof entry === "number" && !Number.isFinite(entry)) throw new Error("Invalid report input number");
    return entry;
  };
  return JSON.stringify(normalize(value));
}
function location(value: SourceLocation): SourceLocation {
  const keys = ["file_name", "sheet_name", "row_number", "column_name", "product_code", "sku"] as const;
  return Object.fromEntries(keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])) as SourceLocation;
}
function sanitizedIssue(issue: SnapshotIssue): SnapshotIssue {
  // Some lower-layer error messages and JSON attribute paths can echo uploaded text.
  const sensitivePart = /\b(attributes|customization_options)\b/.exec(issue.field_path);
  const path = sensitivePart ? `${issue.field_path.slice(0, sensitivePart.index)}${sensitivePart[0]}.*` : issue.field_path;
  return { error_code: issue.error_code, field_path: path, message: `Catalog validation: ${issue.error_code}`,
    severity: issue.severity, ...location(issue) };
}
function publicChange(change: ImportChange): DryRunFieldChange | null {
  // Create defaults are useful in the final state but make a noisy report.
  if (change.operation === "create" && (change.cell_state === "missing" || change.cell_state === "blank")) return null;
  const visible = SAFE_FIELDS[change.entity].has(change.field_path);
  return { entity_type: change.entity, entity_identity: change.identity, field_path: change.field_path,
    previous_value: visible ? change.before ?? null : REDACTED,
    next_value: visible ? change.after : REDACTED,
    change_type: change.operation === "create" ? "created" : change.cell_state === "clear" ? "cleared" : "updated",
    source_location: location({ file_name: change.file_name, sheet_name: change.sheet_name, row_number: change.row_number,
      column_name: change.column_name, product_code: change.product_code, sku: change.sku }),
  };
}
function summary(entity: ImportChange["entity"], state: FinalCatalogProduct | undefined, snapshot: CatalogSnapshot, changes: ImportChange[]): EntityChangeSummary {
  if (!state) return { created: 0, updated: 0 };
  const owner = state.product.id;
  let created = 0;
  if (entity === "variant") created = state.variants.filter((row) => typeof row.id === "string" && row.id.startsWith("preview:")).length;
  if (entity === "image") created = state.images.filter((row) => typeof row.id === "string" && row.id.startsWith("preview:")).length;
  if (entity === "translation") created = state.translations.filter((row) => !snapshot.translations.some((prior) => prior.product_id === owner && prior.locale === row.locale)).length;
  if (entity === "category") created = state.categories.filter((row) => !snapshot.product_categories.some((prior) => prior.product_id === owner && prior.category_id === row.category_id)).length;
  const updated = new Set(changes.filter((change) => change.entity === entity && change.operation === "update").map((change) => change.identity)).size;
  return { created, updated };
}
function sourceOf(row: ImportRow, locate?: SourceLocator): SourceLocation {
  return location({ file_name: row.file_name, row_number: row.row_number, product_code: row.product_code, sku: row.sku,
    ...locate?.(row, "product_code") });
}
function safeLocator(locate?: SourceLocator): SourceLocator {
  return (row, field) => {
    const found = locate?.(row, field);
    if (!found) return undefined;
    return { ...(typeof found.sheet_name === "string" && found.sheet_name ? { sheet_name: found.sheet_name } : {}),
      ...(typeof found.column_name === "string" && found.column_name ? { column_name: found.column_name } : {}) };
  };
}

/** Only checks an offline trusted snapshot version; it is not a database concurrency check. */
export function compareCatalogSnapshotVersion(expected: unknown, current: CatalogSnapshot): VersionCheck {
  let digest: string;
  try { digest = catalogSnapshotDigest(current); } // also enforces the trusted constructor boundary
  catch { return "invalid"; }
  if (!expected || typeof expected !== "object" || Array.isArray(expected)) return "invalid";
  const value = expected as Record<string, unknown>;
  if (Object.keys(value).length !== 3 || value.contract !== "catalog-snapshot-v1"
    || typeof value.template_version !== "string" || !value.template_version.trim()
    || typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest)) return "invalid";
  return value.digest === digest && value.template_version === current.version.template_version ? "current" : "stale";
}

export function createCatalogDryRunReport(input: ImportParseResult | ExcelConversionResult, snapshot: CatalogSnapshot, importSource: ImportSource, locate?: SourceLocator): CatalogDryRunReport {
  if (importSource !== "csv" && importSource !== "excel") throw new Error("Invalid catalog import source");
  const conversion = "csvFiles" in input ? input : null;
  if (conversion && importSource !== "excel") throw new Error("Workbook conversion requires Excel import source");
  const parsed: ImportParseResult = conversion?.parsed ?? (conversion ? {
    valid: false, issues: [], rows: {
      "products.csv": [], "product_variants.csv": [], "product_translations.csv": [],
      "product_categories.csv": [], "product_images.csv": [],
    }, products: [],
  } : input as ImportParseResult);
  const trustedLocate = safeLocator(locate);
  const merged = mergeCatalogImport(parsed, snapshot, trustedLocate);
  const snapshotVersion: SnapshotVersion = { ...snapshot.version };
  const import_source = { kind: importSource, files: FILES.filter((name) => parsed.rows[name].length > 0) };
  const combined = new Map<string, SnapshotIssue>();
  for (const issue of merged.issues) combined.set(stable([issue.error_code, issue.file_name, issue.row_number, issue.field_path, issue.product_code, issue.sku]), issue);
  if (conversion) for (const issue of conversion.issues) {
    const key = stable([issue.error_code, issue.file_name, issue.row_number, issue.field_path, issue.product_code, issue.sku]);
    combined.set(key, issue);
  }
  if (conversion && !conversion.valid && ![...combined.values()].some((issue) => issue.severity === "error")) {
    combined.set("conversion", { error_code: "EXCEL_CONVERSION_INVALID", field_path: "$", message: "Workbook conversion failed", severity: "error" });
  }
  const issues = [...combined.values()].map(sanitizedIssue).sort((a, b) => compare(stable(a), stable(b)));
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");
  const allChanges = merged.changes.map(publicChange).filter((change): change is DryRunFieldChange => change !== null)
    .sort((a, b) => compare(stable(a), stable(b)));
  const codes = new Set(merged.products.map((state) => state.product_code));
  for (const rows of Object.values(parsed.rows)) for (const row of rows) if (row.product_code) codes.add(row.product_code);
  for (const issue of issues) if (issue.product_code) codes.add(issue.product_code);
  const stateByCode = new Map(merged.products.map((state) => [state.product_code, state]));
  const product_results: ProductDryRunResult[] = [...codes].sort(compare).map((code) => {
    const state = stateByCode.get(code);
    const productIssues = issues.filter((issue) => issue.product_code === code);
    const ownErrors = productIssues.filter((issue) => issue.severity === "error");
    const ownWarnings = productIssues.filter((issue) => issue.severity === "warning");
    const sourceRows = FILES.flatMap((name) => parsed.rows[name].filter((row) => row.product_code === code));
    const source_locations = [...new Map(sourceRows.map((row) => { const place = sourceOf(row, trustedLocate); return [stable(place), place] as const; })).values()]
      .sort((a, b) => compare(stable(a), stable(b)));
    const ownRawChanges = merged.changes.filter((change) => change.product_code === code);
    const field_changes = allChanges.filter((change) => change.source_location.product_code === code);
    const result_status: ProductDryRunResult["result_status"] = ownErrors.length || !state ? "invalid"
      : state.operation === "create" ? "created" : ownRawChanges.length ? "updated" : "unchanged";
    return { product_code: code, result_status,
      action: result_status === "created" ? "create" : result_status === "updated" ? "update" : "none",
      sku_changes: summary("variant", state, snapshot, ownRawChanges),
      translation_changes: summary("translation", state, snapshot, ownRawChanges),
      category_changes: summary("category", state, snapshot, ownRawChanges),
      image_changes: summary("image", state, snapshot, ownRawChanges),
      field_changes, errors: ownErrors, warnings: ownWarnings, source_locations };
  });
  const count = (status: ProductDryRunResult["result_status"]) => product_results.filter((row) => row.result_status === status).length;
  const report_status: CatalogDryRunReport["report_status"] = errors.length ? "invalid"
    : product_results.every((row) => row.result_status === "unchanged") ? "no_changes" : "ready";
  const body = { import_source, snapshot_version: snapshotVersion, report_status,
    can_proceed_to_review: report_status === "ready", total_products: product_results.length,
    created_count: count("created"), updated_count: count("updated"), unchanged_count: count("unchanged"), invalid_count: count("invalid"),
    error_count: errors.length, warning_count: warnings.length, product_results, field_changes: allChanges, errors, warnings };
  const normalizedInput = FILES.map((name) => parsed.rows[name].map((row) => ({
    file_name: row.file_name, row_number: row.row_number, operation: row.operation,
    product_code: row.product_code, sku: row.sku,
    fields: Object.fromEntries(Object.entries(row.fields).map(([field, cell]) => [field,
      { kind: cell.kind, ...(cell.kind === "value" || cell.kind === "clear" ? { value: cell.value } : {}),
        ...(field === "reference_price" && cell.kind === "value" ? { decimal: cell.raw } : {}) } ])),
  })));
  const report_id = createHash("sha256").update(stable({ contract: "catalog-dry-run-v1", body, normalizedInput })).digest("hex");
  return { report_id, ...body };
}
