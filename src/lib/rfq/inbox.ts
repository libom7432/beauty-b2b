export const RFQ_INBOX_PAGE_SIZE = 20;
export const RFQ_INBOX_MAX_PAGE = 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The old Mock catalog persisted slug IDs. Accept them only for historical
// snapshots without MOQ terms and a non-UUID Mock product ID. This value is
// display-only; it must never be used as a current Catalog UUID.
const legacySlug = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;
export function validInboxVariantId(productId: string, variantId: string, historical: boolean): boolean {
  return uuid.test(variantId) || (historical && !uuid.test(productId) &&
    legacySlug.test(productId) && legacySlug.test(variantId));
}

export type RFQInboxStatus = "received" | "reviewed" | "closed";
export type RFQInboxSummary = Readonly<{ id: string; rfqNumber: string; createdAt: string;
  status: RFQInboxStatus; companyName: string; hasBelowMoq: boolean | null }>;
export type RFQInboxItem = Readonly<{ productId: string; sku: string | null; variantId: string | null;
  quantity: number; productName: string; moqAtSubmission: number | null;
  moqUnitAtSubmission: string | null; belowMoq: boolean | null }>;
export type RFQInboxDetail = RFQInboxSummary & Readonly<{ fullName: string; email: string;
  country: string; whatsapp: string | null; requirements: string; items: readonly RFQInboxItem[] }>;
export type RFQInboxPage = Readonly<{ items: readonly RFQInboxSummary[]; page: number; hasMore: boolean }>;
export type RFQInboxListRow = Readonly<{ id: string; rfqNumber: string; createdAt: string;
  status: RFQInboxStatus; companyName: string; itemMoqStates: readonly (boolean | null)[] }>;

export class RFQInboxError extends Error {
  readonly code: "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "NOT_CONNECTED" | "SOURCE_UNAVAILABLE";
  constructor(code: RFQInboxError["code"]) {
    super(code);
    this.name = "RFQInboxError";
    this.code = code;
  }
}

/** A future approved reader must order by createdAt DESC, id DESC and return only the requested page.
 * It must not use the Catalog Admin connection or browser credentials. */
export interface RFQInboxSource {
  list(query: Readonly<{ page: number; limit: number }>): Promise<readonly RFQInboxListRow[]>;
  getById(id: string): Promise<RFQInboxDetail | null>;
}

const validTime = (value: string) => typeof value === "string" && Number.isFinite(Date.parse(value));
const invalid = (): never => { throw new RFQInboxError("SOURCE_UNAVAILABLE"); };

function projectItem(raw: RFQInboxItem): RFQInboxItem {
  const moqValues = [raw?.moqAtSubmission, raw?.moqUnitAtSubmission, raw?.belowMoq];
  const historical = moqValues.every((value) => value === null);
  if (!raw || typeof raw.productId !== "string" || !raw.productId ||
    (raw.sku !== null && typeof raw.sku !== "string") ||
    (raw.variantId !== null && (typeof raw.variantId !== "string" ||
      !validInboxVariantId(raw.productId, raw.variantId, historical))) ||
    !Number.isSafeInteger(raw.quantity) || raw.quantity < 1 ||
    typeof raw.productName !== "string" || !raw.productName.trim()) return invalid();
  if (!historical && (!Number.isSafeInteger(raw.moqAtSubmission) || raw.moqAtSubmission! < 1 ||
    typeof raw.moqUnitAtSubmission !== "string" || !raw.moqUnitAtSubmission.trim() ||
    typeof raw.belowMoq !== "boolean" || raw.belowMoq !== (raw.quantity < raw.moqAtSubmission!))) return invalid();
  return { productId: raw.productId, sku: raw.sku, variantId: raw.variantId,
    quantity: raw.quantity, productName: raw.productName,
    moqAtSubmission: raw.moqAtSubmission, moqUnitAtSubmission: raw.moqUnitAtSubmission,
    belowMoq: raw.belowMoq };
}

function projectDetail(raw: RFQInboxDetail): RFQInboxDetail {
  if (!raw || !uuid.test(raw.id) || typeof raw.rfqNumber !== "string" || !raw.rfqNumber ||
    !validTime(raw.createdAt) || !["received", "reviewed", "closed"].includes(raw.status) ||
    typeof raw.companyName !== "string" || !raw.companyName.trim() ||
    typeof raw.fullName !== "string" || !raw.fullName.trim() ||
    typeof raw.email !== "string" || !raw.email.trim() ||
    typeof raw.country !== "string" || !/^[A-Z]{2}$/.test(raw.country) ||
    (raw.whatsapp !== null && typeof raw.whatsapp !== "string") ||
    typeof raw.requirements !== "string" || !Array.isArray(raw.items) || !raw.items.length) return invalid();
  const items = raw.items.map(projectItem);
  const hasBelowMoq = items.some((item) => item.belowMoq === true) ? true :
    items.some((item) => item.belowMoq === null) ? null : false;
  return { id: raw.id, rfqNumber: raw.rfqNumber, createdAt: raw.createdAt,
    status: raw.status, companyName: raw.companyName, hasBelowMoq,
    fullName: raw.fullName, email: raw.email, country: raw.country,
    whatsapp: raw.whatsapp, requirements: raw.requirements, items };
}

function projectSummary(raw: RFQInboxListRow): RFQInboxSummary {
  if (!raw || !uuid.test(raw.id) || typeof raw.rfqNumber !== "string" || !raw.rfqNumber ||
    !validTime(raw.createdAt) || !["received", "reviewed", "closed"].includes(raw.status) ||
    typeof raw.companyName !== "string" || !raw.companyName.trim() ||
    !Array.isArray(raw.itemMoqStates) || !raw.itemMoqStates.length ||
    raw.itemMoqStates.some((state) => state !== true && state !== false && state !== null)) return invalid();
  const hasBelowMoq = raw.itemMoqStates.includes(true) ? true :
    raw.itemMoqStates.includes(null) ? null : false;
  return { id: raw.id, rfqNumber: raw.rfqNumber, createdAt: raw.createdAt,
    status: raw.status, companyName: raw.companyName, hasBelowMoq };
}

/** Reauthorize every operation; a missing real source cannot become a demo data fallback. */
export function createRFQInboxRepository(source: RFQInboxSource | null, authorize: () => Promise<void>) {
  const ready = async () => {
    try { await authorize(); } catch { throw new RFQInboxError("FORBIDDEN"); }
    if (!source) throw new RFQInboxError("NOT_CONNECTED");
  };
  return {
    async list(page = 1): Promise<RFQInboxPage> {
      await ready();
      if (!Number.isSafeInteger(page) || page < 1 || page > RFQ_INBOX_MAX_PAGE)
        throw new RFQInboxError("INVALID_INPUT");
      let rows: readonly RFQInboxListRow[];
      try { rows = await source!.list({ page, limit: RFQ_INBOX_PAGE_SIZE + 1 }); }
      catch { throw new RFQInboxError("SOURCE_UNAVAILABLE"); }
      if (!Array.isArray(rows) || rows.length > RFQ_INBOX_PAGE_SIZE + 1) return invalid();
      const projected = rows.map(projectSummary);
      for (let i = 1; i < projected.length; i++) {
        const left = projected[i - 1], right = projected[i];
        if (left.createdAt < right.createdAt || (left.createdAt === right.createdAt && left.id <= right.id)) return invalid();
      }
      return { items: projected.slice(0, RFQ_INBOX_PAGE_SIZE), page,
        hasMore: projected.length > RFQ_INBOX_PAGE_SIZE };
    },
    async getById(id: string): Promise<RFQInboxDetail> {
      await ready();
      if (typeof id !== "string" || !uuid.test(id)) throw new RFQInboxError("INVALID_INPUT");
      let row: RFQInboxDetail | null;
      try { row = await source!.getById(id); }
      catch { throw new RFQInboxError("SOURCE_UNAVAILABLE"); }
      if (!row) throw new RFQInboxError("NOT_FOUND");
      const detail = projectDetail(row);
      if (detail.id.toLowerCase() !== id.toLowerCase()) return invalid();
      return detail;
    },
  };
}
