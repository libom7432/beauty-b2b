/** Offline B4.4-B final-state projection. No persistence or executable SQL plan. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { CellState, ImportParseResult, ImportRow } from "./csv.ts";
import { validateCatalogProduct, type ValidationIssue } from "../catalog-validation/index.ts";
import { catalogSnapshotDigest, resolveCatalogImport, type CatalogSnapshot, type ResolvedImportRow, type SnapshotIssue, type SourceLocator } from "./snapshot.ts";

type Data = Record<string, unknown>;
type Entity = "product" | "variant" | "translation" | "category" | "image";
export type PreviewCatalogId = `preview:${"product" | "variant" | "image"}:${string}`;
export type CatalogProductIdentity = { kind: "database"; product_id: string } | { kind: "preview"; preview_id: PreviewCatalogId };
export type ImportChange = {
  entity: Entity; identity: string; operation: "create" | "update"; field_path: string;
  before?: unknown; after: unknown; cell_state: CellState["kind"];
  file_name: string; row_number: number; sheet_name?: string; column_name?: string;
  product_code: string; sku?: string;
};
export type FinalCatalogProduct = {
  product_code: string; operation: "create" | "update"; identity: CatalogProductIdentity;
  product: Data; variants: Data[]; translations: Data[]; categories: Data[]; images: Data[];
};
export type CatalogMergeResult = {
  valid: boolean;
  /** Offline eligibility only; never authorizes persistence or waives a fresh transactional validation. */
  can_apply: boolean;
  outcome: "changed" | "unchanged" | "invalid"; snapshot_digest: string;
  products: FinalCatalogProduct[]; changes: ImportChange[]; issues: SnapshotIssue[];
};

const CLASSES: Record<ImportRow["file_name"], Entity> = {
  "products.csv": "product", "product_variants.csv": "variant", "product_translations.csv": "translation",
  "product_categories.csv": "category", "product_images.csv": "image",
};
const IDENTITY = new Set(["operation", "product_code", "id", "product_id", "published_at", "created_at", "updated_at", "image_id", "source_file"]);
const CLEAR: Record<Entity, ReadonlySet<string>> = {
  product: new Set(["attributes", "customization_options", "lead_time_min_days", "lead_time_max_days"]),
  variant: new Set(["attributes", "order_multiple", "package_quantity", "package_unit", "reference_price", "reference_currency"]),
  translation: new Set(["name", "short_description", "description", "seo_title", "seo_description"]),
  category: new Set(),
  image: new Set(["sku", "width", "height", "format", "alt_en", "alt_zh"]),
};
const BUSINESS_KEY: Record<Entity, ReadonlySet<string>> = {
  product: new Set(["product_code"]), variant: new Set(["sku"]), translation: new Set(["locale"]),
  category: new Set(["category_id"]), image: new Set(["image_id"]),
};
function previewId(kind: "product" | "variant" | "image", key: string): PreviewCatalogId {
  const hex = createHash("sha256").update(`catalog-preview-v1\0${kind}\0${key}`).digest("hex");
  return `preview:${kind}:${hex}`;
}
const isPreviewId = (value: unknown): value is PreviewCatalogId => typeof value === "string" && value.startsWith("preview:");
function validationId(value: unknown): unknown {
  if (!isPreviewId(value)) return value;
  const hex = createHash("sha256").update(`catalog-validation-v1\0${value}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
/** Future write adapters must reject diagnostic preview identifiers before constructing persistence DTOs. */
export function assertNoPreviewCatalogIds(value: unknown): void {
  const seen = new WeakSet<object>();
  const visit = (entry: unknown): void => {
    if (isPreviewId(entry)) throw new Error("Preview catalog identity cannot be persisted");
    if (entry && typeof entry === "object") {
      if (seen.has(entry)) return;
      seen.add(entry);
      for (const item of Object.values(entry)) visit(item);
    }
  };
  visit(value);
}
function copy<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) throw new Error("Circular catalog value is unsupported");
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((entry) => copy(entry, seen))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, copy((value as Data)[key], seen)]));
  seen.delete(value);
  return result as T;
}
const own = (value: object, key: string) => Object.hasOwn(value, key);

export function mergeCatalogImport(parsed: ImportParseResult, snapshot: CatalogSnapshot, locate?: SourceLocator): CatalogMergeResult {
  // The resolver verifies the in-process trusted brand; a TypeScript cast cannot create one.
  const resolved = resolveCatalogImport(parsed, snapshot, locate);
  const issues: SnapshotIssue[] = [...resolved.issues];
  const changes: ImportChange[] = [];
  const states = new Map<string, FinalCatalogProduct>();
  const existingByCode = new Map(snapshot.products.map((product) => [product.product_code, product]));
  const rowBySource = new Map<string, ImportRow>();
  for (const rows of Object.values(parsed.rows)) for (const row of rows) rowBySource.set(`${row.file_name}\0${row.row_number}`, row);
  const origin = new Map<string, ImportRow>();
  const sourceKey = (entity: Entity, code: string, identity: string) => `${entity}\0${code}\0${identity}`;
  const add = (row: ImportRow, error_code: string, field_path: string, message: string) => issues.push({
    error_code, field_path, message, severity: "error", file_name: row.file_name, row_number: row.row_number,
    ...(row.product_code ? { product_code: row.product_code } : {}), ...(row.sku ? { sku: row.sku } : {}), ...locate?.(row, field_path),
  });
  const state = (code: string): FinalCatalogProduct | undefined => {
    let current = states.get(code);
    if (current) return current;
    const product = existingByCode.get(code);
    if (!product) return undefined;
    current = {
      product_code: code, operation: "update", identity: { kind: "database", product_id: product.id }, product: copy(product),
      variants: snapshot.variants.filter((row) => row.product_id === product.id).map((row) => copy(row)),
      translations: snapshot.translations.filter((row) => row.product_id === product.id).map((row) => copy(row)),
      categories: snapshot.product_categories.filter((row) => row.product_id === product.id).map((row) => copy(row)),
      images: snapshot.images.filter((row) => row.product_id === product.id).map((row) => copy(row)),
    };
    states.set(code, current);
    return current;
  };
  const record = (row: ImportRow, entity: Entity, identity: string, operation: "create" | "update", field: string, before: unknown, after: unknown, cell: CellState["kind"]) => {
    if (isDeepStrictEqual(before, after)) return;
    changes.push({ entity, identity, operation, field_path: field, ...(before === undefined ? {} : { before: copy(before) }), after: copy(after), cell_state: cell,
      file_name: row.file_name, row_number: row.row_number, product_code: row.product_code!, ...(row.sku ? { sku: row.sku } : {}), ...locate?.(row, field) });
  };
  const apply = (target: Data, row: ImportRow, entity: Entity, identity: string, operation: "create" | "update") => {
    for (const [field, cell] of Object.entries(row.fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      if (IDENTITY.has(field) || BUSINESS_KEY[entity].has(field)) continue;
      if (entity === "image" && field === "sku") continue;
      if (cell.kind === "clear" && !CLEAR[entity].has(field)) { add(row, "CLEAR_NOT_ALLOWED", field, "This field cannot be cleared"); continue; }
      if (operation === "update" && (cell.kind === "missing" || cell.kind === "blank")) continue;
      if (cell.kind === "clear" && operation === "create") { add(row, "CLEAR_ON_CREATE", field, "Clear is only supported for updates"); continue; }
      if (!own(row.data, field)) continue;
      const value = row.data[field];
      if (value === undefined) continue;
      const after = entity === "variant" && field === "reference_price" && value !== null
        ? cell.kind === "value" ? cell.raw : String(value) : value;
      record(row, entity, identity, operation, field, target[field], after, cell.kind);
      target[field] = copy(after);
    }
    // Create defaults from B4.2 are applied even when a column is absent or blank.
    if (operation === "create") for (const [field, value] of Object.entries(row.data)) {
      if (IDENTITY.has(field) || BUSINESS_KEY[entity].has(field) || entity === "image" && field === "sku" || own(target, field) || value === undefined) continue;
      target[field] = entity === "variant" && field === "reference_price" && value !== null ? String(value) : copy(value);
    }
  };

  // Products first, then SKUs, so same-batch image references resolve by business key.
  const ordered: ResolvedImportRow[] = [...resolved.rows].sort((a, b) => {
    const rank = (row: ResolvedImportRow) => ["products.csv", "product_variants.csv", "product_translations.csv", "product_categories.csv", "product_images.csv"].indexOf(row.file_name);
    return rank(a) - rank(b);
  });
  for (const item of ordered) {
    const row = rowBySource.get(`${item.file_name}\0${item.row_number}`);
    if (!row || !row.product_code || !row.operation) continue;
    const entity = CLASSES[item.file_name];
    if (entity === "product" && item.operation === "create" && !existingByCode.has(row.product_code) && !states.has(row.product_code)) {
      const productPreviewId = previewId("product", row.product_code);
      states.set(row.product_code, { product_code: row.product_code, operation: "create", identity: { kind: "preview", preview_id: productPreviewId },
        product: { id: productPreviewId, product_code: row.product_code, published_at: null },
        variants: [], translations: [], categories: [], images: [] });
    }
    const current = state(row.product_code);
    if (!current) continue;
    let target: Data | undefined;
    let identity = row.product_code;
    if (entity === "product") target = current.product;
    if (entity === "variant") {
      identity = row.sku ?? "";
      target = current.variants.find((variant) => variant.sku === row.sku);
      if (!target && item.operation === "create" && row.sku) {
        target = { id: previewId("variant", row.sku), product_id: current.product.id, sku: row.sku };
        current.variants.push(target);
      }
    }
    if (entity === "translation") {
      identity = String(item.locale ?? "");
      target = current.translations.find((entry) => entry.locale === item.locale);
      if (!target && item.operation === "create" && item.locale) {
        target = { product_id: current.product.id, locale: item.locale };
        current.translations.push(target);
      }
    }
    if (entity === "category") {
      identity = String(item.category_id ?? "");
      target = current.categories.find((entry) => entry.category_id === item.category_id);
      if (!target && item.operation === "create" && item.category_id) {
        target = { product_id: current.product.id, category_id: item.category_id };
        current.categories.push(target);
      }
    }
    if (entity === "image") {
      identity = item.image_id ?? `new:${row.row_number}`;
      target = current.images.find((entry) => entry.id === item.image_id);
      if (!target && item.operation === "create") {
        target = { id: previewId("image", `${row.product_code}\0${row.row_number}\0${row.data.storage_key}`), product_id: current.product.id, variant_id: null };
        current.images.push(target);
      }
      if (target) identity = String(target.id);
    }
    if (!target) continue;
    origin.set(sourceKey(entity, row.product_code, identity), row);
    apply(target, row, entity, identity, item.operation);
    if (entity === "image") {
      const cell = row.fields.sku;
      if (cell?.kind === "clear" || cell?.kind === "value") {
        const next = cell.kind === "clear" ? null : current.variants.find((variant) => variant.sku === cell.value)?.id;
        if (next === undefined) add(row, "IMAGE_SKU_NOT_FOUND", "sku", "Image SKU is unavailable in final product state");
        else { record(row, entity, identity, item.operation, "variant_id", target.variant_id, next, cell.kind); target.variant_id = next; }
      }
    }
  }

  const finalStates = [...states.values()];
  // A collision can be introduced by two updates even when neither value was in the old snapshot.
  const finalSlugs = new Map<string, string>();
  const finalStorageKeys = new Map<string, string>();
  for (const old of snapshot.products) if (!states.has(old.product_code)) finalSlugs.set(old.slug, old.product_code);
  for (const old of snapshot.images) {
    const owner = snapshot.products.find((product) => product.id === old.product_id);
    if (owner && !states.has(owner.product_code)) finalStorageKeys.set(old.storage_key, owner.product_code);
  }
  for (const current of finalStates) {
    const slug = current.product.slug;
    if (typeof slug === "string") {
      const previous = finalSlugs.get(slug);
      if (previous && previous !== current.product_code) {
        const row = origin.get(sourceKey("product", current.product_code, current.product_code));
        if (row) add(row, "FINAL_SLUG_CONFLICT", "slug", "Final product slug is used by another product");
        else issues.push({ error_code: "FINAL_SLUG_CONFLICT", field_path: "slug", message: "Final product slug is used by another product", severity: "error", product_code: current.product_code });
      }
      finalSlugs.set(slug, current.product_code);
    }
    for (const image of current.images) {
      const key = image.storage_key;
      if (typeof key !== "string") continue;
      const previous = finalStorageKeys.get(key);
      if (previous && previous !== current.product_code) {
        const row = origin.get(sourceKey("image", current.product_code, String(image.id)));
        if (row) add(row, "FINAL_STORAGE_KEY_CONFLICT", "storage_key", "Final image storage key is used by another product");
        else issues.push({ error_code: "FINAL_STORAGE_KEY_CONFLICT", field_path: "images.storage_key", message: "Final image storage key is used by another product", severity: "error", product_code: current.product_code });
      }
      finalStorageKeys.set(key, current.product_code);
    }
  }
  const usedSlugs = new Set(snapshot.products.map((row) => row.slug));
  const categories = snapshot.categories.map(({ id, parent_id, slug, status }) => ({ id, parent_id, slug, status }));
  for (const current of finalStates) {
    const old = existingByCode.get(current.product_code);
    const skuMap = Object.fromEntries(snapshot.variants.filter((row) => row.product_id === old?.id).map((row) => [row.id, row.sku]));
    const imageMap = Object.fromEntries(snapshot.images.filter((row) => row.product_id === old?.id).map((row) => [row.id, row.storage_key]));
    const b3Product = { ...current.product, id: validationId(current.product.id),
      variants: current.variants.map((row) => ({ ...row, id: validationId(row.id), product_id: validationId(row.product_id),
        reference_price: row.reference_price === null || row.reference_price === undefined ? row.reference_price : Number(row.reference_price) })),
      translations: current.translations.map((row) => ({ ...row, product_id: validationId(row.product_id) })),
      categories: current.categories.map((row) => ({ ...row, product_id: validationId(row.product_id) })),
      images: current.images.map((row) => ({ ...row, id: validationId(row.id), product_id: validationId(row.product_id), variant_id: validationId(row.variant_id) })) };
    const result = validateCatalogProduct(b3Product, { operation: current.operation,
      ...(old ? { previous: { id: old.id, product_code: old.product_code, slug: old.slug, published_at: old.published_at, skus: skuMap, images: imageMap } } : {}),
      categories, productCodes: new Set(snapshot.products.map((row) => row.product_code)), slugs: usedSlugs,
      skus: new Set(snapshot.variants.map((row) => row.sku)), imageStorageKeys: new Set(snapshot.images.map((row) => row.storage_key)),
    });
    const b3Source = (issue: ValidationIssue): ImportRow | undefined => {
      const match = /^(variants|translations|categories|images)\[(\d+)\]/.exec(issue.field_path);
      if (match) {
        const kind = ({ variants: "variant", translations: "translation", categories: "category", images: "image" } as const)[match[1] as "variants" | "translations" | "categories" | "images"];
        const entry = current[match[1] as "variants" | "translations" | "categories" | "images"][Number(match[2])];
        const key = kind === "variant" ? String(entry?.sku ?? "") : kind === "translation" ? String(entry?.locale ?? "")
          : kind === "category" ? String(entry?.category_id ?? "") : String(entry?.id ?? "");
        return origin.get(sourceKey(kind, current.product_code, key));
      }
      return origin.get(sourceKey("product", current.product_code, current.product_code));
    };
    for (const issue of result.issues) {
      const source = b3Source(issue);
      const sourceField = issue.field_path.split(".").at(-1) ?? issue.field_path;
      issues.push({ ...issue, product_code: current.product_code,
        ...(source ? { file_name: source.file_name, row_number: source.row_number, ...locate?.(source, sourceField) } : {}) });
    }
    if (current.operation === "create" && typeof current.product.slug === "string") usedSlugs.add(current.product.slug);
  }
  const valid = !issues.some((issue) => issue.severity === "error");
  return { valid, can_apply: valid, outcome: valid ? changes.length ? "changed" : "unchanged" : "invalid",
    snapshot_digest: catalogSnapshotDigest(snapshot), products: finalStates, changes, issues };
}
