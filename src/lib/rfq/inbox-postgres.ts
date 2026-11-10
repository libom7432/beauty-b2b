import { RFQ_INBOX_MAX_PAGE, RFQ_INBOX_PAGE_SIZE, RFQInboxError, validInboxVariantId,
  type RFQInboxDetail, type RFQInboxItem, type RFQInboxListRow, type RFQInboxSource,
  type RFQInboxStatus } from "./inbox.ts";

/** A query-only boundary for a future dedicated RFQ inbox reader role.
 * The RFQ submission role and Catalog Admin pool must never be supplied here.
 * Production wiring remains absent until the role, RLS policy and credential are approved. */
export interface RFQInboxQueryAdapter {
  query<T>(sql: string, values: readonly unknown[]): Promise<{ rows: T[] }>;
}

const unavailable = (): never => { throw new RFQInboxError("SOURCE_UNAVAILABLE"); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const statuses: readonly RFQInboxStatus[] = ["received", "reviewed", "closed"];

// The page CTE bounds request rows before reading item MOQ metadata. No contact
// column, product identity or full product_snapshot enters the list projection.
export const RFQ_INBOX_LIST_SQL = `WITH page AS (
  SELECT id, rfq_number, created_at, status, company_name
  FROM rfq_private.rfq_requests
  ORDER BY created_at DESC, id DESC
  LIMIT $1 OFFSET $2
)
SELECT page.id, page.rfq_number, page.created_at, page.status, page.company_name,
  (SELECT jsonb_agg(jsonb_build_array(i.quantity,
    i.product_snapshot->'moqAtSubmission',
    i.product_snapshot->'moqUnitAtSubmission',
    i.product_snapshot->'belowMoq',
    i.product_snapshot ? 'moqAtSubmission',
    i.product_snapshot ? 'moqUnitAtSubmission',
    i.product_snapshot ? 'belowMoq',
    COALESCE(jsonb_typeof(i.product_snapshot) = 'object'
      AND jsonb_typeof(i.product_snapshot->'productName') = 'object'
      AND jsonb_typeof(i.product_snapshot->'productName'->'en') = 'string'
      AND jsonb_typeof(i.product_snapshot->'productName'->'zh') = 'string'
      AND jsonb_typeof(i.product_snapshot->'productSlug') = 'string'
      AND i.product_snapshot ? 'selectedVariant'
      AND ((i.sku IS NULL AND i.product_snapshot->'selectedVariant' = 'null'::jsonb)
        OR (i.sku IS NOT NULL AND jsonb_typeof(i.product_snapshot->'selectedVariant') = 'object')),
      false)) ORDER BY i.created_at, i.id)
   FROM (SELECT quantity, product_snapshot, sku, created_at, id
     FROM rfq_private.rfq_items WHERE rfq_request_id = page.id
     ORDER BY created_at, id LIMIT 101) i) AS moq_snapshots
FROM page ORDER BY page.created_at DESC, page.id DESC`;

export const RFQ_INBOX_DETAIL_SQL = `SELECT id, rfq_number, created_at, status,
  company_name, full_name, email, country, whatsapp, requirements
FROM rfq_private.rfq_requests WHERE id = $1 LIMIT 1`;

export const RFQ_INBOX_ITEMS_SQL = `SELECT product_id, sku, quantity, product_snapshot
FROM rfq_private.rfq_items WHERE rfq_request_id = $1
ORDER BY created_at ASC, id ASC LIMIT 101`;

type ListRow = { id: unknown; rfq_number: unknown; created_at: unknown; status: unknown;
  company_name: unknown; moq_snapshots: unknown };
type DetailRow = ListRow & { full_name: unknown; email: unknown; country: unknown;
  whatsapp: unknown; requirements: unknown };
type ItemRow = { product_id: unknown; sku: unknown; quantity: unknown; product_snapshot: unknown };

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return unavailable();
  return value as Record<string, unknown>;
}

function time(value: unknown): string {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) return unavailable();
  return date.toISOString();
}

function quantity(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)))
    return unavailable();
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) return unavailable();
  return number;
}

function status(value: unknown): RFQInboxStatus {
  if (!statuses.includes(value as RFQInboxStatus)) return unavailable();
  return value as RFQInboxStatus;
}

function base(row: ListRow) {
  if (typeof row.id !== "string" || !uuid.test(row.id) ||
    typeof row.rfq_number !== "string" || !row.rfq_number ||
    typeof row.company_name !== "string" || !row.company_name.trim()) return unavailable();
  return { id: row.id, rfqNumber: row.rfq_number, createdAt: time(row.created_at),
    status: status(row.status), companyName: row.company_name };
}

type Moq = Pick<RFQInboxItem, "moqAtSubmission" | "moqUnitAtSubmission" | "belowMoq">;
function moq(values: readonly unknown[], present: readonly boolean[], requested: number): Moq {
  if (values.length !== 3) return unavailable();
  const [rawMoq, rawUnit, rawBelow] = values;
  if (present.length !== 3 || present.some((value) => typeof value !== "boolean")) return unavailable();
  // Only absent keys mean historical unknown; explicit JSON null is malformed.
  if (present.every((value) => !value)) {
    if (values.some((value) => value !== null)) return unavailable();
    return { moqAtSubmission: null, moqUnitAtSubmission: null, belowMoq: null };
  }
  if (!present.every(Boolean)) return unavailable();
  if (!Number.isSafeInteger(rawMoq) || (rawMoq as number) < 1 ||
    typeof rawUnit !== "string" || !rawUnit.trim() || rawUnit.length > 64 ||
    typeof rawBelow !== "boolean" || rawBelow !== (requested < (rawMoq as number)))
    return unavailable();
  return { moqAtSubmission: rawMoq as number, moqUnitAtSubmission: rawUnit, belowMoq: rawBelow };
}

function listRow(row: ListRow): RFQInboxListRow {
  if (!Array.isArray(row.moq_snapshots) || !row.moq_snapshots.length ||
    row.moq_snapshots.length > 100) return unavailable();
  const itemMoqStates = row.moq_snapshots.map((entry: unknown) => {
    if (!Array.isArray(entry) || entry.length !== 8 || entry[7] !== true) return unavailable();
    return moq(entry.slice(1, 4), entry.slice(4, 7), quantity(entry[0])).belowMoq;
  });
  return { ...base(row), itemMoqStates };
}

function item(row: ItemRow): RFQInboxItem {
  const snapshot = record(row.product_snapshot);
  const name = record(snapshot.productName);
  const variant = snapshot.selectedVariant;
  if (typeof row.product_id !== "string" || !row.product_id.trim() ||
    (row.sku !== null && (typeof row.sku !== "string" || !row.sku.trim())) ||
    typeof name.en !== "string" || !name.en.trim() ||
    typeof name.zh !== "string" || !name.zh.trim() ||
    typeof snapshot.productSlug !== "string" || !snapshot.productSlug.trim() ||
    (row.sku === null && variant !== null) || (row.sku !== null && variant === null))
    return unavailable();
  let variantId: string | null = null;
  const requested = quantity(row.quantity);
  const keys = ["moqAtSubmission", "moqUnitAtSubmission", "belowMoq"];
  const terms = moq(keys.map((key) => snapshot[key] ?? null),
    keys.map((key) => Object.hasOwn(snapshot, key)), requested);
  if (terms.moqAtSubmission !== null && !uuid.test(row.product_id as string)) return unavailable();
  if (variant !== null) {
    const selected = record(variant);
    if (typeof selected.id !== "string" ||
      !validInboxVariantId(row.product_id as string, selected.id, terms.moqAtSubmission === null) ||
      !selected.attributes || typeof selected.attributes !== "object" ||
      Array.isArray(selected.attributes)) return unavailable();
    variantId = selected.id;
  }
  return { productId: row.product_id as string, sku: row.sku as string | null,
    variantId, quantity: requested, productName: name.en, ...terms };
}

function detail(row: DetailRow, items: readonly ItemRow[]): RFQInboxDetail {
  if (typeof row.full_name !== "string" || !row.full_name.trim() ||
    typeof row.email !== "string" || !row.email.trim() ||
    typeof row.country !== "string" || !/^[A-Z]{2}$/.test(row.country) ||
    (row.whatsapp !== null && typeof row.whatsapp !== "string") ||
    typeof row.requirements !== "string" || !items.length || items.length > 100)
    return unavailable();
  const projected = items.map(item);
  const hasBelowMoq = projected.some((entry) => entry.belowMoq === true) ? true :
    projected.some((entry) => entry.belowMoq === null) ? null : false;
  return { ...base(row), fullName: row.full_name, email: row.email, country: row.country,
    whatsapp: row.whatsapp, requirements: row.requirements, items: projected, hasBelowMoq };
}

/** A null adapter means no trusted dedicated connection is configured. */
export function createPostgreSQLRFQInboxSource(adapter: RFQInboxQueryAdapter | null): RFQInboxSource | null {
  if (!adapter) return null;
  return {
    async list({ page, limit }) {
      if (!Number.isSafeInteger(page) || page < 1 || page > RFQ_INBOX_MAX_PAGE ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > RFQ_INBOX_PAGE_SIZE + 1)
        throw new RFQInboxError("INVALID_INPUT");
      try {
        const result = await adapter.query<ListRow>(RFQ_INBOX_LIST_SQL, [limit, (page - 1) * RFQ_INBOX_PAGE_SIZE]);
        if (!Array.isArray(result?.rows) || result.rows.length > limit) return unavailable();
        return result.rows.map(listRow);
      } catch (error) {
        if (error instanceof RFQInboxError) throw error;
        throw new RFQInboxError("SOURCE_UNAVAILABLE");
      }
    },
    async getById(id) {
      if (typeof id !== "string" || !uuid.test(id)) throw new RFQInboxError("INVALID_INPUT");
      try {
        const request = await adapter.query<DetailRow>(RFQ_INBOX_DETAIL_SQL, [id]);
        if (!Array.isArray(request?.rows) || request.rows.length > 1) return unavailable();
        const row = request.rows[0];
        if (!row) return null;
        const found = base(row);
        if (found.id.toLowerCase() !== id.toLowerCase()) return unavailable();
        const entries = await adapter.query<ItemRow>(RFQ_INBOX_ITEMS_SQL, [id]);
        if (!Array.isArray(entries?.rows) || entries.rows.length > 101) return unavailable();
        return detail(row, entries.rows);
      } catch (error) {
        if (error instanceof RFQInboxError) throw error;
        throw new RFQInboxError("SOURCE_UNAVAILABLE");
      }
    },
  };
}
