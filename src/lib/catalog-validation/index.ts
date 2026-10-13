/** Pure catalog input validation. Mirrors the B2 schema; never reads or writes a database. */
export type Severity = "error" | "warning";
export type ValidationIssue = {
  error_code: string;
  field_path: string;
  message: string;
  severity: Severity;
  row_number?: number;
  product_code?: string;
  sku?: string;
};
export type ValidationResult = {
  valid: boolean;
  issues: ValidationIssue[];
  canonical_category_path?: string;
};
export type AttributeRule = { kind: "string" | "number" | "boolean"; values?: readonly (string | number | boolean)[] };
export type ProductTemplate = { product: Readonly<Record<string, AttributeRule>>; sku: Readonly<Record<string, AttributeRule>> };

export const PRODUCT_TEMPLATES: Readonly<Record<string, ProductTemplate>> = {
  press_on_nails: {
    product: { design: { kind: "string" }, material: { kind: "string", values: ["abs", "gel", "acrylic", "soft_gel"] } },
    sku: {
      nail_shape: { kind: "string", values: ["almond", "coffin", "oval", "round", "square", "stiletto"] },
      nail_length: { kind: "string", values: ["short", "medium", "long", "extra_long"] },
      nail_size: { kind: "string", values: ["xs", "s", "m", "l", "custom"] },
      finish: { kind: "string", values: ["glossy", "matte", "glitter", "chrome"] },
    },
  },
  gel_polish: {
    product: { product_type: { kind: "string", values: ["color_gel", "base_coat", "top_coat", "builder_gel"] } },
    sku: { color: { kind: "string" }, volume: { kind: "number" }, finish: { kind: "string", values: ["glossy", "matte", "glitter", "sheer"] } },
  },
  regular_nail_polish: {
    product: { product_type: { kind: "string", values: ["color_polish", "base_coat", "top_coat"] } },
    sku: { color: { kind: "string" }, volume: { kind: "number" }, finish: { kind: "string", values: ["glossy", "matte", "glitter", "sheer"] } },
  },
};

export type CategoryReference = { id: string; parent_id: string | null; slug: string; status: string };
export type CatalogValidationContext = {
  operation?: "create" | "update";
  categories?: readonly CategoryReference[];
  productCodes?: ReadonlySet<string>;
  slugs?: ReadonlySet<string>;
  skus?: ReadonlySet<string>;
  imageStorageKeys?: ReadonlySet<string>;
  templates?: Readonly<Record<string, ProductTemplate>>;
  /** Trusted current identity of the row being updated, loaded outside this pure module. */
  previous?: { id: string; product_code: string; slug: string; published_at?: string | null; skus?: Readonly<Record<string, string>>; images?: Readonly<Record<string, string>> };
  row_number?: number;
};
export type CatalogBatchRow = { operation: "create" | "update"; product: unknown; previous?: CatalogValidationContext["previous"] };

type Obj = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const KEY = /^[a-z][a-z0-9_]*$/;
const STATES = new Set(["draft", "published", "retired"]);
const IMAGE_ROLES = new Set(["primary", "detail", "variant"]);
const IMAGE_FORMATS = new Set(["jpeg", "png", "webp", "avif"]);
const CURRENCIES = new Set(Intl.supportedValuesOf("currency"));
const MAX_BIGINT = 9007199254740991;
const obj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string";
const nonblank = (v: unknown): v is string => str(v) && v.trim().length > 0;
const trimmed = (v: unknown): v is string => nonblank(v) && v === v.trim();
const integer = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);
const positive = (v: unknown): v is number => integer(v) && v > 0;
const optional = (v: unknown) => v === undefined || v === null;
const uuid = (v: unknown): v is string => str(v) && UUID.test(v);
// PostgreSQL btrim(text) removes ASCII spaces by default, not every JS whitespace character.
const pgBtrim = (value: string) => value.replace(/^ +| +$/g, "");
const imageUrl = (value: unknown): value is string => {
  if (!trimmed(value)) return false;
  if (value.startsWith("/") && !value.startsWith("//")) return !/[\s\\]/.test(value);
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !!parsed.hostname && !/[\s\\]/.test(value);
  } catch { return false; }
};

/** The SQL index uses lower(btrim(key)) and lower(regexp_replace(btrim(value), '[[:space:]]+', ' ', 'g')). */
export function normalizeVariantAttributes(value: unknown): Record<string, string | number | boolean> {
  if (!obj(value)) throw new Error("Variant attributes must be an object");
  const result: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = pgBtrim(key).toLowerCase();
    if (!KEY.test(name) || Object.hasOwn(result, name)) throw new Error(`Invalid or duplicate normalized attribute key: ${key}`);
    if (str(raw)) {
      const normalized = pgBtrim(raw).replace(/[\t\n\v\f\r ]+/g, " ").toLowerCase();
      if (!normalized) throw new Error(`Empty attribute value: ${key}`);
      result[name] = normalized;
    } else if (typeof raw === "boolean" || (typeof raw === "number" && Number.isFinite(raw))) {
      result[name] = raw;
    } else throw new Error(`Invalid scalar attribute value: ${key}`);
  }
  return result;
}

function combinationKey(value: Record<string, string | number | boolean>): string {
  return JSON.stringify(Object.keys(value).sort().map((key) => [key, value[key]]));
}

export function validateCatalogProduct(input: unknown, context: CatalogValidationContext = {}): ValidationResult {
  const issues: ValidationIssue[] = [];
  const data: Obj = obj(input) ? input : {};
  const code = nonblank(data.product_code) ? data.product_code : undefined;
  const productStatus = data.status === undefined ? "draft" : data.status;
  const operation = context.operation ?? "create";
  const previous = operation === "update" ? context.previous : undefined;
  const add = (error_code: string, field_path: string, message: string, severity: Severity = "error", sku?: string) =>
    issues.push({ error_code, field_path, message, severity, ...(context.row_number === undefined ? {} : { row_number: context.row_number }), ...(code ? { product_code: code } : {}), ...(sku ? { sku } : {}) });
  if (!obj(input)) add("INVALID_OBJECT", "$", "Product must be an object");
  if (operation === "update" && !previous) add("MISSING_UPDATE_IDENTITY", "id", "Update requires a trusted previous product identity");
  if (operation === "create" && context.previous) add("INVALID_CREATE_IDENTITY", "id", "Create must not include a previous product identity");
  if (operation === "update" && previous && data.id !== previous.id) add("UPDATE_ID_MISMATCH", "id", "Update product ID does not match previous identity");
  if (data.id !== undefined && !uuid(data.id)) add("INVALID_UUID", "id", "Product ID must be UUID");
  if (!trimmed(data.product_code)) add("REQUIRED_TEXT", "product_code", "Product code must be nonempty and trimmed");
  else if (context.productCodes?.has(data.product_code) && data.product_code !== previous?.product_code) add("DUPLICATE_PRODUCT_CODE", "product_code", "Product code is already used");
  if (!str(data.slug) || !SLUG.test(data.slug)) add("INVALID_SLUG", "slug", "Slug must use lowercase letters, digits and single hyphens");
  else if (context.slugs?.has(data.slug) && data.slug !== previous?.slug) add("DUPLICATE_SLUG", "slug", "Slug is already used");
  if (previous && data.product_code !== previous.product_code) add("IMMUTABLE_PRODUCT_CODE", "product_code", "Existing product code cannot change");
  if (previous?.published_at && data.slug !== previous.slug) add("IMMUTABLE_PUBLISHED_SLUG", "slug", "Published slug cannot change");
  if (!trimmed(data.product_type)) add("REQUIRED_TEXT", "product_type", "Product type must be nonempty and trimmed");
  if (!STATES.has(productStatus as string)) add("INVALID_STATUS", "status", "Status must be draft, published or retired");
  for (const [field, fallback] of [["attributes", "object"], ["customization_options", "array"]] as const) {
    const value = data[field];
    if (value !== undefined && (field === "attributes" ? !obj(value) : !Array.isArray(value))) add("INVALID_JSONB", field, `${field} must be a JSON ${fallback}`);
  }
  for (const field of ["oem", "odm", "seo_indexable", "featured", "new_arrival"]) {
    if (data[field] !== undefined && typeof data[field] !== "boolean") add("INVALID_BOOLEAN", field, `${field} must be boolean`);
  }
  for (const field of ["lead_time_min_days", "lead_time_max_days"]) {
    if (!optional(data[field]) && (!integer(data[field]) || (data[field] as number) < 0 || (data[field] as number) > 2147483647)) add("INVALID_LEAD_TIME", field, "Lead time must be a nonnegative PostgreSQL integer or null");
  }
  if (integer(data.lead_time_min_days) && integer(data.lead_time_max_days) && data.lead_time_max_days < data.lead_time_min_days) add("LEAD_TIME_ORDER", "lead_time_max_days", "Maximum lead time must not be less than minimum");
  if (data.published_at !== undefined && data.published_at !== null && data.published_at !== previous?.published_at) add("MANAGED_PUBLISHED_AT", "published_at", "Publication timestamp is managed by the database");

  const registry = { ...context.templates, ...PRODUCT_TEMPLATES };
  const template = str(data.product_type) ? registry[data.product_type] : undefined;
  if (!template) add("UNKNOWN_PRODUCT_TYPE", "product_type", "No controlled attribute template exists for this product type");
  const checkAttributes = (value: unknown, rules: Readonly<Record<string, AttributeRule>>, path: string, sku?: string) => {
    if (!obj(value)) return;
    const names = new Set<string>();
    for (const [key, raw] of Object.entries(value)) {
      const normalized = pgBtrim(key).toLowerCase();
      if (!KEY.test(normalized) || names.has(normalized)) { add("INVALID_ATTRIBUTE_KEY", `${path}.${key}`, "Attribute key is invalid or duplicated after normalization", "error", sku); continue; }
      names.add(normalized);
      const rule = rules[normalized];
      if (!rule) { add("UNDEFINED_ATTRIBUTE", `${path}.${key}`, "Attribute is not defined for this product type and level", productStatus === "published" ? "error" : "warning", sku); continue; }
      const typeOk = rule.kind === "string" ? nonblank(raw) : rule.kind === "number" ? typeof raw === "number" && Number.isFinite(raw) && raw > 0 : typeof raw === "boolean";
      if (!typeOk) { add("INVALID_ATTRIBUTE_TYPE", `${path}.${key}`, `Expected ${rule.kind}${rule.kind === "number" ? " greater than zero" : ""}`, "error", sku); continue; }
      if (rule.values && !rule.values.includes(raw as string | number | boolean)) add("INVALID_ATTRIBUTE_VALUE", `${path}.${key}`, `Allowed values: ${rule.values.join(", ")}`, "error", sku);
    }
  };
  if (template) checkAttributes(data.attributes, template.product, "attributes");
  if (Array.isArray(data.customization_options)) {
    for (let i = 0; i < data.customization_options.length; i++) if (!obj(data.customization_options[i])) add("INVALID_CUSTOMIZATION_OPTION", `customization_options[${i}]`, "Customization option must be an object");
  }

  const variants = Array.isArray(data.variants) ? data.variants : [];
  if (data.variants !== undefined && !Array.isArray(data.variants)) add("INVALID_LIST", "variants", "Variants must be an array");
  const seenSkus = new Set<string>();
  const seenCombos = new Set<string>();
  const variantProductIds = new Map<string, unknown>();
  for (let i = 0; i < variants.length; i++) {
    const path = `variants[${i}]`;
    const v: Obj = obj(variants[i]) ? variants[i] : {};
    if (!obj(variants[i])) add("INVALID_OBJECT", path, "Variant must be an object");
    const sku = str(v.sku) ? v.sku : undefined;
    if (!trimmed(v.sku)) add("REQUIRED_TEXT", `${path}.sku`, "SKU must be nonempty and trimmed", "error", sku);
    else {
      if (seenSkus.has(v.sku) || context.skus?.has(v.sku) && previous?.skus?.[v.id as string] !== v.sku) add("DUPLICATE_SKU", `${path}.sku`, "SKU is already used", "error", sku);
      seenSkus.add(v.sku);
      if (previous?.skus && uuid(v.id) && previous.skus[v.id] && previous.skus[v.id] !== v.sku) add("IMMUTABLE_SKU", `${path}.sku`, "Existing SKU code cannot change", "error", sku);
    }
    if (v.id !== undefined && !uuid(v.id)) add("INVALID_UUID", `${path}.id`, "Variant ID must be UUID", "error", sku);
    if (v.product_id !== undefined && v.product_id !== data.id) add("VARIANT_PRODUCT_MISMATCH", `${path}.product_id`, "SKU must belong to this product", "error", sku);
    if (uuid(v.id)) variantProductIds.set(v.id, v.product_id ?? data.id);
    if (!STATES.has((v.status === undefined ? "draft" : v.status) as string)) add("INVALID_STATUS", `${path}.status`, "Invalid SKU status", "error", sku);
    if (v.attributes !== undefined && !obj(v.attributes)) add("INVALID_JSONB", `${path}.attributes`, "SKU attributes must be a JSON object", "error", sku);
    else {
      try {
        const key = combinationKey(normalizeVariantAttributes(v.attributes ?? {}));
        if (seenCombos.has(key)) add("DUPLICATE_SPECIFICATION", `${path}.attributes`, "SKU attribute combination duplicates another SKU of this product", "error", sku);
        seenCombos.add(key);
      } catch (error) { add("INVALID_SPECIFICATION", `${path}.attributes`, (error as Error).message, "error", sku); }
      if (template) checkAttributes(v.attributes ?? {}, template.sku, `${path}.attributes`, sku);
    }
    if (!positive(v.moq_quantity) || v.moq_quantity > MAX_BIGINT) add("INVALID_MOQ", `${path}.moq_quantity`, "MOQ must be a positive safe integer", "error", sku);
    if (!trimmed(v.moq_unit)) add("INVALID_MOQ_UNIT", `${path}.moq_unit`, "MOQ unit must be nonempty and trimmed", "error", sku);
    if (!optional(v.order_multiple) && !positive(v.order_multiple)) add("INVALID_ORDER_MULTIPLE", `${path}.order_multiple`, "Order multiple must be a positive integer or null", "error", sku);
    if (!optional(v.package_quantity) && !positive(v.package_quantity)) add("INVALID_PACKAGE_QUANTITY", `${path}.package_quantity`, "Package quantity must be a positive integer or null", "error", sku);
    if (!optional(v.package_unit) && !trimmed(v.package_unit)) add("INVALID_PACKAGE_UNIT", `${path}.package_unit`, "Package unit must be nonempty and trimmed", "error", sku);
    if (optional(v.package_quantity) !== optional(v.package_unit)) add("PACKAGE_PAIR", path, "Package quantity and unit must both be present or absent", "error", sku);
    if (!optional(v.reference_price) && (typeof v.reference_price !== "number" || !Number.isFinite(v.reference_price) || v.reference_price <= 0 || !/^\d{1,10}(\.\d{1,4})?$/.test(String(v.reference_price)))) add("INVALID_PRICE", `${path}.reference_price`, "Reference price must fit numeric(14,4) and be positive", "error", sku);
    if (!optional(v.reference_currency) && (!str(v.reference_currency) || !CURRENCIES.has(v.reference_currency))) add("INVALID_CURRENCY", `${path}.reference_currency`, "Currency must be an ISO 4217 code", "error", sku);
    if (optional(v.reference_price) !== optional(v.reference_currency)) add("PRICE_CURRENCY_PAIR", path, "Price and currency must both be present or absent", "error", sku);
    if (v.sort_order !== undefined && (!integer(v.sort_order) || Math.abs(v.sort_order) > 2147483647)) add("INVALID_SORT_ORDER", `${path}.sort_order`, "Sort order must be a PostgreSQL integer", "error", sku);
    if (productStatus === "retired" && v.status === "published") add("RETIRED_PUBLISHED_SKU", `${path}.status`, "Retired product cannot have a published SKU", "error", sku);
  }

  const translations = Array.isArray(data.translations) ? data.translations : [];
  if (data.translations !== undefined && !Array.isArray(data.translations)) add("INVALID_LIST", "translations", "Translations must be an array");
  const localeSet = new Set<string>();
  for (let i = 0; i < translations.length; i++) {
    const t: Obj = obj(translations[i]) ? translations[i] : {};
    const path = `translations[${i}]`;
    if (t.locale !== "en" && t.locale !== "zh") add("INVALID_LOCALE", `${path}.locale`, "Locale must be en or zh");
    if (str(t.locale) && localeSet.has(t.locale)) add("DUPLICATE_LOCALE", `${path}.locale`, "Locale is duplicated");
    if (str(t.locale)) localeSet.add(t.locale);
    for (const field of ["name", "short_description", "description", "seo_title", "seo_description"]) {
      if (t[field] !== undefined && !str(t[field])) add("INVALID_TEXT", `${path}.${field}`, "Translation field must be text");
      if (productStatus === "published" && !nonblank(t[field])) add("INCOMPLETE_TRANSLATION", `${path}.${field}`, "Published product requires this translated field");
    }
  }
  if (productStatus === "published") for (const locale of ["en", "zh"]) if (!localeSet.has(locale)) add("MISSING_TRANSLATION", `translations.${locale}`, `Published product requires ${locale} translation`);

  const categories = Array.isArray(data.categories) ? data.categories : [];
  if (data.categories !== undefined && !Array.isArray(data.categories)) add("INVALID_LIST", "categories", "Categories must be an array");
  const categoryMap = new Map(context.categories?.map((c) => [c.id, c]) ?? []);
  const usedCategories = new Set<string>();
  let primaryCount = 0;
  let canonical_category_path: string | undefined;
  for (let i = 0; i < categories.length; i++) {
    const link: Obj = obj(categories[i]) ? categories[i] : {};
    const path = `categories[${i}]`;
    if (!uuid(link.category_id)) add("INVALID_UUID", `${path}.category_id`, "Category ID must be UUID");
    if (str(link.category_id)) {
      if (usedCategories.has(link.category_id)) add("DUPLICATE_CATEGORY", `${path}.category_id`, "Category link is duplicated");
      usedCategories.add(link.category_id);
    }
    if (link.is_primary !== undefined && typeof link.is_primary !== "boolean") add("INVALID_BOOLEAN", `${path}.is_primary`, "is_primary must be boolean");
    if (link.sort_order !== undefined && (!integer(link.sort_order) || Math.abs(link.sort_order) > 2147483647)) add("INVALID_SORT_ORDER", `${path}.sort_order`, "Sort order must be a PostgreSQL integer");
    const category = categoryMap.get(link.category_id as string);
    if (!category) add("UNKNOWN_CATEGORY", `${path}.category_id`, "Category is absent from the supplied category snapshot");
    if (link.is_primary === true) primaryCount++;
    if (category) {
        const segments: string[] = [];
        const visited = new Set<string>();
        let node: CategoryReference | undefined = category;
        while (node) {
          if (visited.has(node.id)) { add("CATEGORY_CYCLE", `${path}.category_id`, "Category hierarchy contains a cycle"); break; }
          visited.add(node.id);
          if (!SLUG.test(node.slug)) add("INVALID_CATEGORY_SLUG", `${path}.category_id`, "Category slug is invalid");
          if (productStatus === "published" && link.is_primary === true && node.status !== "published") add("UNPUBLISHED_CATEGORY", `${path}.category_id`, "Primary category and ancestors must be published");
          segments.unshift(node.slug);
          if (node.parent_id && !categoryMap.has(node.parent_id)) add("UNKNOWN_CATEGORY_PARENT", `${path}.category_id`, "Category parent is missing");
          node = node.parent_id ? categoryMap.get(node.parent_id) : undefined;
        }
        if (segments.length > 3 && productStatus === "published") add("CATEGORY_DEPTH", `${path}.category_id`, "Current site supports at most three category levels");
        if (link.is_primary === true && !issues.some((issue) => issue.field_path === `${path}.category_id`)) canonical_category_path = segments.join("/");
    }
  }
  if (primaryCount > 1) add("MULTIPLE_PRIMARY_CATEGORIES", "categories", "Product may have only one primary category");
  if (productStatus === "published" && primaryCount !== 1) add("MISSING_PRIMARY_CATEGORY", "categories", "Published product needs exactly one valid primary category");

  const images = Array.isArray(data.images) ? data.images : [];
  if (data.images !== undefined && !Array.isArray(data.images)) add("INVALID_LIST", "images", "Images must be an array");
  let validPrimary = 0;
  const imageKeys = new Set<string>();
  for (let i = 0; i < images.length; i++) {
    const image: Obj = obj(images[i]) ? images[i] : {};
    const path = `images[${i}]`;
    if (image.id !== undefined && !uuid(image.id)) add("INVALID_UUID", `${path}.id`, "Image ID must be UUID");
    if (image.product_id !== undefined && image.product_id !== data.id) add("IMAGE_PRODUCT_MISMATCH", `${path}.product_id`, "Image must belong to this product");
    if (!IMAGE_ROLES.has(image.role as string)) add("INVALID_IMAGE_ROLE", `${path}.role`, "Image role must be primary, detail or variant");
    if (!STATES.has((image.status === undefined ? "draft" : image.status) as string)) add("INVALID_STATUS", `${path}.status`, "Invalid image status");
    if (image.variant_id !== undefined && image.variant_id !== null) {
      if (!uuid(image.variant_id)) add("INVALID_UUID", `${path}.variant_id`, "Variant ID must be UUID");
      else if (!variantProductIds.has(image.variant_id) || variantProductIds.get(image.variant_id) !== data.id) add("IMAGE_VARIANT_MISMATCH", `${path}.variant_id`, "Image SKU must belong to the same product");
    }
    if (image.role === "primary" && !optional(image.variant_id)) add("PRIMARY_IMAGE_VARIANT", `${path}.variant_id`, "Primary image cannot reference a SKU");
    if (image.role === "variant" && optional(image.variant_id)) add("VARIANT_IMAGE_SKU", `${path}.variant_id`, "Variant image requires a SKU");
    if (!trimmed(image.storage_key)) add("INVALID_STORAGE_KEY", `${path}.storage_key`, "Storage key must be nonempty and trimmed");
    else {
      if (imageKeys.has(image.storage_key) || context.imageStorageKeys?.has(image.storage_key) && previous?.images?.[image.id as string] !== image.storage_key) add("DUPLICATE_STORAGE_KEY", `${path}.storage_key`, "Storage key is already used");
      imageKeys.add(image.storage_key);
    }
    if (!imageUrl(image.public_url)) add("INVALID_IMAGE_URL", `${path}.public_url`, "Image URL must be a root-relative path or HTTPS URL without whitespace");
    if (image.sort_order !== undefined && (!integer(image.sort_order) || Math.abs(image.sort_order) > 2147483647)) add("INVALID_SORT_ORDER", `${path}.sort_order`, "Sort order must be a PostgreSQL integer");
    if (!optional(image.format) && !IMAGE_FORMATS.has(image.format as string)) add("INVALID_IMAGE_FORMAT", `${path}.format`, "Image format must be jpeg, png, webp or avif");
    for (const dim of ["width", "height"]) if (!optional(image[dim]) && (!positive(image[dim]) || image[dim] > 2147483647)) add("INVALID_IMAGE_DIMENSION", `${path}.${dim}`, "Dimension must be a positive PostgreSQL integer");
    for (const alt of ["alt_en", "alt_zh"]) if (image[alt] !== undefined && !str(image[alt])) add("INVALID_ALT", `${path}.${alt}`, "ALT must be text");
    if (image.role === "primary" && image.status === "published") {
      validPrimary++;
      if (productStatus === "published") for (const alt of ["alt_en", "alt_zh"]) if (!nonblank(image[alt])) add("MISSING_PRIMARY_ALT", `${path}.${alt}`, "Published primary image requires bilingual ALT");
    }
  }
  if (validPrimary > 1) add("MULTIPLE_PRIMARY_IMAGES", "images", "Only one published primary image is allowed");
  if (productStatus === "published") {
    if (!variants.some((v) => obj(v) && v.status === "published")) add("MISSING_PUBLISHED_SKU", "variants", "Published product needs a published SKU");
    if (validPrimary === 0) add("MISSING_PRIMARY_IMAGE", "images", "Published product needs a published primary image");
  }
  return { valid: !issues.some((issue) => issue.severity === "error"), issues, ...(canonical_category_path ? { canonical_category_path } : {}) };
}

/** Validate explicit create/update import rows without persistence. */
export function validateCatalogBatch(rows: readonly CatalogBatchRow[], context: Omit<CatalogValidationContext, "operation" | "previous"> = {}): ValidationResult[] {
  const productCodes = new Set(context.productCodes);
  const slugs = new Set(context.slugs);
  const skus = new Set(context.skus);
  const imageStorageKeys = new Set(context.imageStorageKeys);
  const updateTargets = new Set<string>();
  const batchCodes = new Set<string>();
  const batchSlugs = new Set<string>();
  const batchSkus = new Set<string>();
  return rows.map((row, index) => {
    const input = row.product;
    const result = validateCatalogProduct(input, {
      ...context, operation: row.operation, previous: row.previous, productCodes, slugs, skus, imageStorageKeys,
      row_number: context.row_number === undefined ? index + 1 : context.row_number + index,
    });
    if (obj(input)) {
      const issue = (error_code: string, field_path: string, message: string, sku?: string) => result.issues.push({
        error_code, field_path, message, severity: "error",
        row_number: context.row_number === undefined ? index + 1 : context.row_number + index,
        ...(nonblank(input.product_code) ? { product_code: input.product_code } : {}),
        ...(sku ? { sku } : {}),
      });
      if (row.operation === "update" && row.previous) {
        if (updateTargets.has(row.previous.id)) issue("DUPLICATE_UPDATE_TARGET", "id", "Product appears more than once as an update in this batch");
        updateTargets.add(row.previous.id);
      }
      if (trimmed(input.product_code) && batchCodes.has(input.product_code)) issue("DUPLICATE_PRODUCT_CODE", "product_code", "Product code is repeated in this batch");
      if (str(input.slug) && batchSlugs.has(input.slug)) issue("DUPLICATE_SLUG", "slug", "Slug is repeated in this batch");
      if (trimmed(input.product_code)) batchCodes.add(input.product_code);
      if (str(input.slug)) batchSlugs.add(input.slug);
      if (trimmed(input.product_code)) productCodes.add(input.product_code);
      if (str(input.slug)) slugs.add(input.slug);
      if (Array.isArray(input.variants)) for (let i = 0; i < input.variants.length; i++) {
        const variant = input.variants[i];
        if (!obj(variant) || !trimmed(variant.sku)) continue;
        if (batchSkus.has(variant.sku)) issue("DUPLICATE_SKU", `variants[${i}].sku`, "SKU is repeated in this batch", variant.sku);
        batchSkus.add(variant.sku);
        skus.add(variant.sku);
      }
      if (Array.isArray(input.images)) for (const image of input.images) if (obj(image) && trimmed(image.storage_key)) imageStorageKeys.add(image.storage_key);
    }
    result.valid = !result.issues.some((entry) => entry.severity === "error");
    return result;
  });
}
