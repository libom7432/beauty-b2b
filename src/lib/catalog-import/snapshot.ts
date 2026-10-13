import { createHash } from "node:crypto";
import type { ImportFileName, ImportParseResult, ImportRow } from "./csv.ts";
import { normalizeVariantAttributes } from "../catalog-validation/index.ts";

type Status = "draft" | "published" | "retired";
type Timestamps = { created_at: string; updated_at: string };
export type SnapshotProduct = Timestamps & {
  id: string; product_code: string; slug: string; product_type: string; status: Status;
  attributes: Record<string, unknown>; customization_options: unknown[]; oem: boolean; odm: boolean;
  lead_time_min_days: number | null; lead_time_max_days: number | null;
  seo_indexable: boolean; featured: boolean; new_arrival: boolean; published_at: string | null;
};
export type SnapshotVariant = Timestamps & {
  id: string; product_id: string; sku: string; status: Status; attributes: Record<string, unknown>;
  moq_quantity: number; moq_unit: string; order_multiple: number | null;
  package_quantity: number | null; package_unit: string | null;
  reference_price: string | null; reference_currency: string | null; sort_order: number;
};
export type SnapshotCategory = Timestamps & {
  id: string; parent_id: string | null; slug: string; status: Status;
  name_en: string; name_zh: string; description_en: string; description_zh: string; sort_order: number;
};
export type SnapshotCategoryLink = Timestamps & { product_id: string; category_id: string; is_primary: boolean; sort_order: number };
export type SnapshotImage = Timestamps & {
  id: string; product_id: string; variant_id: string | null; storage_key: string; public_url: string;
  role: "primary" | "detail" | "variant"; status: Status; sort_order: number;
  width: number | null; height: number | null; format: "jpeg" | "png" | "webp" | "avif" | null;
  alt_en: string; alt_zh: string;
};
export type SnapshotTranslation = Timestamps & {
  product_id: string; locale: "en" | "zh"; name: string; short_description: string;
  description: string; seo_title: string; seo_description: string;
};
export type CatalogSnapshotRows = {
  products: SnapshotProduct[]; variants: SnapshotVariant[]; categories: SnapshotCategory[];
  product_categories: SnapshotCategoryLink[]; images: SnapshotImage[]; translations: SnapshotTranslation[];
};
export type CatalogSnapshot = { readonly [K in keyof CatalogSnapshotRows]: readonly CatalogSnapshotRows[K][number][] } & {
  readonly version: Readonly<{ contract: "catalog-snapshot-v1"; template_version: string; digest: string }>;
};
export type SnapshotIssue = {
  error_code: string; field_path: string; message: string; severity: "error" | "warning";
  product_code?: string; sku?: string; file_name?: string; sheet_name?: string;
  row_number?: number; column_name?: string;
};
export type ResolvedImportRow = {
  file_name: ImportFileName; row_number: number; operation: "create" | "update";
  product_code: string; product_id?: string; sku?: string; variant_id?: string;
  category_id?: string; image_id?: string; locale?: string;
  identity: "new" | "existing"; data: Readonly<Record<string, unknown>>;
};
export type ResolutionResult = { valid: boolean; snapshot_digest: string; issues: SnapshotIssue[]; rows: ResolvedImportRow[] };
export type SourceLocator = (row: ImportRow, field_path: string) => { sheet_name?: string; column_name?: string } | undefined;

const trustedSnapshots = new WeakSet<object>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS = new Set(["draft", "published", "retired"]);
const FILES: ImportFileName[] = ["products.csv", "product_variants.csv", "product_translations.csv", "product_categories.csv", "product_images.csv"];
const SNAPSHOT_FIELDS: Record<keyof CatalogSnapshotRows, readonly string[]> = {
  products: ["id", "product_code", "slug", "product_type", "status", "attributes", "customization_options", "oem", "odm", "lead_time_min_days", "lead_time_max_days", "seo_indexable", "featured", "new_arrival", "published_at", "created_at", "updated_at"],
  variants: ["id", "product_id", "sku", "status", "attributes", "moq_quantity", "moq_unit", "order_multiple", "package_quantity", "package_unit", "reference_price", "reference_currency", "sort_order", "created_at", "updated_at"],
  categories: ["id", "parent_id", "slug", "status", "name_en", "name_zh", "description_en", "description_zh", "sort_order", "created_at", "updated_at"],
  product_categories: ["product_id", "category_id", "is_primary", "sort_order", "created_at", "updated_at"],
  images: ["id", "product_id", "variant_id", "storage_key", "public_url", "role", "status", "sort_order", "width", "height", "format", "alt_en", "alt_zh", "created_at", "updated_at"],
  translations: ["product_id", "locale", "name", "short_description", "description", "seo_title", "seo_description", "created_at", "updated_at"],
};

function canonical(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Invalid snapshot number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object" || seen.has(value)) throw new Error("Invalid snapshot value");
  seen.add(value);
  let result: string;
  if (Array.isArray(value)) result = `[${value.map((item) => canonical(item, seen)).join(",")}]`;
  else {
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error("Invalid snapshot object");
    const entries = Object.entries(value);
    if (entries.some(([key]) => ["__proto__", "prototype", "constructor"].includes(key))) throw new Error("Invalid snapshot key");
    result = `{${entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, seen)}`).join(",")}}`;
  }
  seen.delete(value);
  return result;
}
function immutableCopy<T>(value: T): T {
  const copy = JSON.parse(canonical(value)) as T;
  const freeze = (node: unknown): void => {
    if (node && typeof node === "object") { for (const child of Object.values(node)) freeze(child); Object.freeze(node); }
  };
  freeze(copy);
  return copy;
}
function businessRow(row: Timestamps): Record<string, unknown> {
  const result: Record<string, unknown> = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "created_at" && key !== "updated_at"));
  if (Object.hasOwn(result, "published_at")) {
    result.ever_published = result.published_at !== null;
    delete result.published_at;
  }
  return result;
}
function sorted<T>(rows: T[], key: (row: T) => string): T[] { return [...rows].sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0); }
function digestRows(rows: CatalogSnapshotRows, templateVersion: string): string {
  const projection = {
    contract: "catalog-snapshot-v1", template_version: templateVersion,
    products: sorted(rows.products.map(businessRow), (row) => String(row.id)),
    variants: sorted(rows.variants.map(businessRow), (row) => String(row.id)),
    categories: sorted(rows.categories.map(businessRow), (row) => String(row.id)),
    product_categories: sorted(rows.product_categories.map(businessRow), (row) => `${row.product_id}\0${row.category_id}`),
    images: sorted(rows.images.map(businessRow), (row) => String(row.id)),
    translations: sorted(rows.translations.map(businessRow), (row) => `${row.product_id}\0${row.locale}`),
  };
  return createHash("sha256").update(canonical(projection)).digest("hex");
}
function unique(rows: readonly Record<string, unknown>[], key: (row: Record<string, unknown>) => string, label: string): void {
  const seen = new Set<string>();
  for (const row of rows) { const value = key(row); if (seen.has(value)) throw new Error(`Invalid trusted snapshot: duplicate ${label}`); seen.add(value); }
}

/** Trusted adapter boundary, not authentication: only a controlled server-side database reader may call this. */
export function captureTrustedCatalogSnapshot(input: CatalogSnapshotRows, templateVersion: string): CatalogSnapshot {
  if (typeof templateVersion !== "string" || !templateVersion.trim()) throw new Error("Snapshot template version is required");
  if (!input || typeof input !== "object") throw new Error("Trusted snapshot is incomplete");
  for (const name of ["products", "variants", "categories", "product_categories", "images", "translations"] as const) {
    if (!Array.isArray(input[name])) throw new Error("Trusted snapshot is incomplete");
  }
  const rows = immutableCopy(input);
  for (const name of Object.keys(SNAPSHOT_FIELDS) as (keyof CatalogSnapshotRows)[]) {
    const expected = SNAPSHOT_FIELDS[name];
    for (const row of rows[name]) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Trusted snapshot row is invalid");
      const keys = Object.keys(row);
      if (keys.length !== expected.length || keys.some((key) => !expected.includes(key)) || expected.some((key) => !Object.hasOwn(row, key))) {
        throw new Error("Trusted snapshot row does not match the B2 field contract");
      }
    }
  }
  for (const name of ["products", "variants", "categories", "images"] as const) {
    for (const row of rows[name]) if (!UUID.test(row.id) || !STATUS.has(row.status)) throw new Error("Invalid trusted snapshot identity or status");
    unique(rows[name] as unknown as Record<string, unknown>[], (row) => String(row.id), `${name} id`);
  }
  unique(rows.products as unknown as Record<string, unknown>[], (row) => String(row.product_code), "product code");
  unique(rows.products as unknown as Record<string, unknown>[], (row) => String(row.slug), "product slug");
  unique(rows.variants as unknown as Record<string, unknown>[], (row) => String(row.sku), "SKU");
  unique(rows.images as unknown as Record<string, unknown>[], (row) => String(row.storage_key), "image storage key");
  unique(rows.product_categories as unknown as Record<string, unknown>[], (row) => `${row.product_id}\0${row.category_id}`, "category link");
  unique(rows.translations as unknown as Record<string, unknown>[], (row) => `${row.product_id}\0${row.locale}`, "translation");
  for (const row of rows.translations) if (row.locale !== "en" && row.locale !== "zh") throw new Error("Invalid trusted snapshot locale");
  const productIds = new Set(rows.products.map((row) => row.id));
  const products = new Map(rows.products.map((row) => [row.id, row]));
  const categoryIds = new Set(rows.categories.map((row) => row.id));
  const categories = new Map(rows.categories.map((row) => [row.id, row]));
  const variants = new Map(rows.variants.map((row) => [row.id, row]));
  for (const row of rows.products) {
    if (typeof row.product_code !== "string" || !row.product_code.trim() || row.product_code !== row.product_code.trim()
      || typeof row.slug !== "string" || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug)
      || (row.status === "published" && !row.published_at)) throw new Error("Invalid trusted snapshot product identity or publication state");
  }
  const combinations = new Set<string>();
  for (const row of rows.variants) {
    if (!productIds.has(row.product_id)) throw new Error("Invalid trusted snapshot variant owner");
    if (typeof row.sku !== "string" || !row.sku.trim() || row.sku !== row.sku.trim()) throw new Error("Invalid trusted snapshot SKU");
    if (products.get(row.product_id)?.status === "retired" && row.status === "published") throw new Error("Invalid trusted snapshot retired product SKU");
    let normalized: Record<string, string | number | boolean>;
    try { normalized = normalizeVariantAttributes(row.attributes); }
    catch { throw new Error("Invalid trusted snapshot SKU attributes"); }
    const key = `${row.product_id}\0${canonical(normalized)}`;
    if (combinations.has(key)) throw new Error("Invalid trusted snapshot duplicate SKU combination");
    combinations.add(key);
  }
  for (const row of rows.product_categories) if (!productIds.has(row.product_id) || !categoryIds.has(row.category_id) || typeof row.is_primary !== "boolean") throw new Error("Invalid trusted snapshot category link");
  unique(rows.product_categories.filter((row) => row.is_primary) as unknown as Record<string, unknown>[], (row) => String(row.product_id), "primary category");
  for (const row of rows.translations) if (!productIds.has(row.product_id)) throw new Error("Invalid trusted snapshot translation owner");
  for (const row of rows.images) {
    if (!productIds.has(row.product_id) || (row.variant_id && variants.get(row.variant_id)?.product_id !== row.product_id)) throw new Error("Invalid trusted snapshot image owner");
    if (!["primary", "detail", "variant"].includes(row.role) || (row.variant_id !== null && !UUID.test(row.variant_id))) throw new Error("Invalid trusted snapshot image role");
    if ((row.role === "primary" && row.variant_id !== null) || (row.role === "variant" && row.variant_id === null)) throw new Error("Invalid trusted snapshot image role");
  }
  unique(rows.images.filter((row) => row.role === "primary" && row.status === "published") as unknown as Record<string, unknown>[], (row) => String(row.product_id), "published primary image");
  for (const row of rows.categories) {
    if (row.parent_id !== null && (!UUID.test(row.parent_id) || !categoryIds.has(row.parent_id))) throw new Error("Invalid trusted snapshot category parent");
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(row.slug)) throw new Error("Invalid trusted snapshot category slug");
    const seen = new Set<string>();
    let cursor: string | null = row.id;
    while (cursor) {
      if (seen.has(cursor)) throw new Error("Invalid trusted snapshot category cycle");
      seen.add(cursor);
      cursor = categories.get(cursor)?.parent_id ?? null;
    }
  }
  unique(rows.categories as unknown as Record<string, unknown>[], (row) => `${row.parent_id ?? "root"}\0${row.slug}`, "sibling category slug");
  for (const row of rows.categories) {
    if (row.status === "published" && row.parent_id && categories.get(row.parent_id)?.status !== "published") throw new Error("Invalid trusted snapshot published category parent");
  }
  for (const row of rows.products) {
    if (row.status !== "published") continue;
    if (!rows.variants.some((variant) => variant.product_id === row.id && variant.status === "published")) throw new Error("Invalid trusted snapshot published SKU requirement");
    if (rows.product_categories.filter((link) => link.product_id === row.id && link.is_primary && categories.get(link.category_id)?.status === "published").length !== 1) throw new Error("Invalid trusted snapshot primary category requirement");
    for (const locale of ["en", "zh"]) {
      const t = rows.translations.find((candidate) => candidate.product_id === row.id && candidate.locale === locale);
      if (!t || ![t.name, t.short_description, t.description, t.seo_title, t.seo_description].every((value) => typeof value === "string" && value.trim())) throw new Error("Invalid trusted snapshot translation requirement");
    }
    if (!rows.images.some((image) => image.product_id === row.id && image.role === "primary" && image.status === "published" && image.alt_en.trim() && image.alt_zh.trim())) throw new Error("Invalid trusted snapshot primary image requirement");
  }
  const digest = digestRows(rows, templateVersion);
  const snapshot = Object.freeze({ ...rows, version: Object.freeze({ contract: "catalog-snapshot-v1" as const, template_version: templateVersion, digest }) });
  trustedSnapshots.add(snapshot);
  return snapshot;
}

export function catalogSnapshotDigest(snapshot: CatalogSnapshot): string {
  if (!trustedSnapshots.has(snapshot)) throw new Error("Snapshot was not captured by the trusted constructor");
  return snapshot.version.digest;
}

/** Resolve only identities and references. This does not merge patches, validate final publication, or write. */
export function resolveCatalogImport(parsed: ImportParseResult, snapshot: CatalogSnapshot, locate?: SourceLocator): ResolutionResult {
  if (!trustedSnapshots.has(snapshot)) throw new Error("Snapshot was not captured by the trusted constructor");
  const issues: SnapshotIssue[] = parsed.issues.map((item) => {
    const row = FILES.includes(item.file_name as ImportFileName)
      ? parsed.rows[item.file_name as ImportFileName].find((candidate) => candidate.row_number === item.row_number) : undefined;
    return { ...item, ...(row ? locate?.(row, item.field_path) : {}) };
  });
  const resolved: ResolvedImportRow[] = [];
  const productsByCode = new Map(snapshot.products.map((row) => [row.product_code, row]));
  const productsById = new Map(snapshot.products.map((row) => [row.id, row]));
  const variantsBySku = new Map(snapshot.variants.map((row) => [row.sku, row]));
  const variantsById = new Map(snapshot.variants.map((row) => [row.id, row]));
  const categoriesById = new Map(snapshot.categories.map((row) => [row.id, row]));
  const imagesById = new Map(snapshot.images.map((row) => [row.id, row]));
  const imagesByStorageKey = new Map(snapshot.images.map((row) => [row.storage_key, row]));
  const links = new Set(snapshot.product_categories.map((row) => `${row.product_id}\0${row.category_id}`));
  const translations = new Set(snapshot.translations.map((row) => `${row.product_id}\0${row.locale}`));
  const incomingProducts = new Map(parsed.rows["products.csv"].filter((row) => row.product_code).map((row) => [row.product_code!, row]));
  const incomingSkus = new Map(parsed.rows["product_variants.csv"].filter((row) => row.sku).map((row) => [row.sku!, row]));
  const add = (row: ImportRow, code: string, path: string, message: string) => issues.push({
    error_code: code, field_path: path, message, severity: "error", file_name: row.file_name,
    row_number: row.row_number, ...(row.product_code ? { product_code: row.product_code } : {}),
    ...(row.sku ? { sku: row.sku } : {}), ...locate?.(row, path),
  });
  const productOwner = (code: string) => productsByCode.get(code);
  const desiredProductStatus = (code: string): Status | undefined => {
    const current = productOwner(code);
    if (current?.status === "retired") return "retired";
    const incoming = incomingProducts.get(code);
    const proposed = incoming?.data.status;
    return STATUS.has(proposed as string) ? proposed as Status : productOwner(code)?.status;
  };
  const findSku = (sku: string): { id?: string; product_code: string } | undefined => {
    const existing = variantsBySku.get(sku);
    if (existing) return { id: existing.id, product_code: productsById.get(existing.product_id)!.product_code };
    const incoming = incomingSkus.get(sku);
    if (incoming?.operation === "create" && incoming.product_code) return { product_code: incoming.product_code };
    return undefined;
  };
  const categoryUsable = (id: string): boolean => {
    const seen = new Set<string>();
    let cursor: string | null = id;
    let depth = 0;
    while (cursor) {
      if (seen.has(cursor) || ++depth > 3) return false;
      seen.add(cursor);
      const current: SnapshotCategory | undefined = categoriesById.get(cursor);
      if (!current || current.status !== "published") return false;
      cursor = current.parent_id;
    }
    return true;
  };
  const seenCodes = new Set<string>(), seenSkus = new Set<string>();
  for (const file_name of FILES) for (const row of parsed.rows[file_name]) {
    if (!row.product_code || !row.operation || !/^[^\s\u0000-\u001f][^\u0000-\u001f]*$/.test(row.product_code) || row.product_code.trim() !== row.product_code) {
      add(row, "INVALID_PRODUCT_CODE", "product_code", "Product code is missing or invalid"); continue;
    }
    const existingProduct = productOwner(row.product_code);
    const incomingProduct = incomingProducts.get(row.product_code);
    if (!existingProduct && !(incomingProduct?.operation === "create" && file_name !== "products.csv")) {
      if (file_name !== "products.csv" || row.operation === "update") { add(row, "PRODUCT_NOT_FOUND", "product_code", "Referenced product does not exist"); continue; }
    }
    let safeData: Readonly<Record<string, unknown>>;
    try { safeData = immutableCopy(row.data); }
    catch { add(row, "INVALID_IMPORT_DATA", "$", "Imported row data is invalid"); continue; }
    const productId = existingProduct?.id;
    const item: ResolvedImportRow = { file_name, row_number: row.row_number, operation: row.operation, product_code: row.product_code,
      ...(productId ? { product_id: productId } : {}), identity: row.operation === "create" ? "new" : "existing", data: safeData };
    if (file_name === "products.csv") {
      if (seenCodes.has(row.product_code)) add(row, "DUPLICATE_PRODUCT_CODE", "product_code", "Product code occurs more than once in the batch");
      seenCodes.add(row.product_code);
      if (row.operation === "create" && existingProduct) add(row, "PRODUCT_ALREADY_EXISTS", "product_code", "Product code already exists");
      if (row.operation === "update" && !existingProduct) add(row, "PRODUCT_NOT_FOUND", "product_code", "Product code does not exist");
      if (Object.hasOwn(safeData, "id") || Object.hasOwn(safeData, "product_id") || Object.hasOwn(safeData, "published_at") || safeData.product_code !== row.product_code) add(row, "IMMUTABLE_PRODUCT_IDENTITY", "product_code", "Product identity cannot be changed by import");
      if (existingProduct && row.operation === "update") {
        if (existingProduct.published_at && typeof safeData.slug === "string" && safeData.slug !== existingProduct.slug) add(row, "PUBLISHED_SLUG_IMMUTABLE", "slug", "Previously published product slug cannot change");
        if (existingProduct.status === "retired" && safeData.status && safeData.status !== "retired") add(row, "RETIRED_REACTIVATION_FORBIDDEN", "status", "Retired product cannot be reactivated by import");
      }
      const slug = safeData.slug;
      if (typeof slug === "string" && snapshot.products.some((candidate) => candidate.slug === slug && candidate.id !== existingProduct?.id)) add(row, "SLUG_CONFLICT", "slug", "Slug already belongs to another product");
    } else if (file_name === "product_variants.csv") {
      if (!row.sku || row.sku.trim() !== row.sku || /[\u0000-\u001f]/.test(row.sku)) { add(row, "INVALID_SKU", "sku", "SKU is missing or invalid"); continue; }
      if (seenSkus.has(row.sku)) add(row, "DUPLICATE_SKU", "sku", "SKU occurs more than once in the batch");
      seenSkus.add(row.sku);
      const variant = variantsBySku.get(row.sku);
      if (variant && variant.product_id !== productId) add(row, "SKU_OWNERSHIP_CONFLICT", "sku", "SKU belongs to another product");
      else if (row.operation === "create" && variant) add(row, "SKU_ALREADY_EXISTS", "sku", "SKU already exists");
      else if (row.operation === "update" && !variant) add(row, "SKU_NOT_FOUND", "sku", "SKU does not exist");
      if (Object.hasOwn(safeData, "id") || Object.hasOwn(safeData, "product_id") || safeData.sku !== row.sku) add(row, "IMMUTABLE_SKU_IDENTITY", "sku", "SKU identity cannot be changed by import");
      if (variant) item.variant_id = variant.id;
      item.sku = row.sku;
      if (desiredProductStatus(row.product_code) === "retired" && (safeData.status === "published" || (row.operation === "update" && variant?.status === "published" && safeData.status === undefined))) {
        add(row, "RETIRED_PRODUCT_PUBLISHED_SKU", "status", "Retired product cannot have a published SKU");
      }
    } else if (file_name === "product_translations.csv") {
      const locale = safeData.locale;
      if (locale !== "en" && locale !== "zh") add(row, "INVALID_LOCALE", "locale", "Translation locale is invalid");
      else {
        item.locale = locale;
        if (productId) {
          const exists = translations.has(`${productId}\0${locale}`);
          if (row.operation === "create" && exists) add(row, "TRANSLATION_ALREADY_EXISTS", "locale", "Translation already exists");
          if (row.operation === "update" && !exists) add(row, "TRANSLATION_NOT_FOUND", "locale", "Translation does not exist");
        } else if (row.operation === "update") add(row, "TRANSLATION_NOT_FOUND", "locale", "Translation does not exist");
      }
    } else if (file_name === "product_categories.csv") {
      const id = safeData.category_id;
      if (typeof id !== "string" || !UUID.test(id)) add(row, "INVALID_CATEGORY_ID", "category_id", "Category ID is invalid");
      else {
        item.category_id = id;
        if (!categoriesById.has(id)) add(row, "CATEGORY_NOT_FOUND", "category_id", "Category does not exist");
        else if (!categoryUsable(id)) add(row, "CATEGORY_UNAVAILABLE", "category_id", "Category is not available for import");
        if (productId) {
          const exists = links.has(`${productId}\0${id}`);
          if (row.operation === "create" && exists) add(row, "CATEGORY_LINK_ALREADY_EXISTS", "category_id", "Category link already exists");
          if (row.operation === "update" && !exists) add(row, "CATEGORY_LINK_NOT_FOUND", "category_id", "Category link does not exist");
        } else if (row.operation === "update") add(row, "CATEGORY_LINK_NOT_FOUND", "category_id", "Category link does not exist");
      }
    } else if (file_name === "product_images.csv") {
      const id = safeData.image_id;
      const image = typeof id === "string" ? imagesById.get(id) : undefined;
      if (row.operation === "create" && id !== undefined && id !== null) add(row, "IMAGE_ID_ON_CREATE", "image_id", "New image cannot supply an existing image ID");
      if (row.operation === "update" && (!id || !image)) add(row, "IMAGE_NOT_FOUND", "image_id", "Image ID does not exist");
      if (image && image.product_id !== productId) add(row, "IMAGE_OWNERSHIP_CONFLICT", "image_id", "Image belongs to another product");
      if (image) item.image_id = image.id;
      const storageKey = safeData.storage_key;
      if (typeof storageKey === "string") {
        const prior = imagesByStorageKey.get(storageKey);
        if (prior && prior.id !== image?.id) add(row, "IMAGE_STORAGE_KEY_CONFLICT", "storage_key", "Image storage key already exists");
      }
      const sku = safeData.sku;
      if (typeof sku === "string") {
        item.sku = sku;
        const found = findSku(sku);
        if (!found) add(row, "IMAGE_SKU_NOT_FOUND", "sku", "Image SKU does not exist");
        else if (found.product_code !== row.product_code) add(row, "IMAGE_SKU_OWNERSHIP_CONFLICT", "sku", "Image SKU belongs to another product");
        else if (found.id) item.variant_id = found.id;
      } else if (row.operation === "update" && image?.variant_id && sku === undefined) {
        const owner = variantsById.get(image.variant_id);
        if (owner) { item.variant_id = owner.id; item.sku = owner.sku; }
      }
    }
    resolved.push(item);
  }
  return { valid: !issues.some((issue) => issue.severity === "error"), snapshot_digest: snapshot.version.digest, issues, rows: resolved };
}
