import { createHash, randomBytes } from "node:crypto";
import type { Product } from "@/lib/catalog/types";
import { CatalogReadError } from "@/lib/catalog-read/errors";
import { snapshotRFQItems, snapshotRFQItemsFromPublicCatalog } from "./items";
import type { RFQDraft, RFQItemSnapshot, RFQPublicCatalogLookup, RFQValidationError } from "./types";
import { validateRFQDraft, validateRFQDraftStructure } from "./validation";

export const RFQ_MAX_BODY_BYTES = 32 * 1024;

export type RFQRecord = { id: string; rfqNumber: string; fingerprint: string; status: "received"; createdAt: string };
export type RFQWrite = { key: string; fingerprint: string; rfqNumber: string; draft: RFQDraft; items: RFQItemSnapshot[] };

// A production adapter must make this callback one database transaction. In
// particular, insertRequestIfAbsent must arbitrate the unique idempotency key
// across processes and wait for any competing transaction before findByKey.
export interface RFQTransaction {
  insertRequestIfAbsent(write: RFQWrite): Promise<RFQRecord | null>;
  findByKey(key: string): Promise<RFQRecord | null>;
  insertItems(requestId: string, items: readonly RFQItemSnapshot[]): Promise<void>;
  insertNotificationJob(requestId: string): Promise<void>;
}
export interface RFQRepository {
  transaction<T>(work: (tx: RFQTransaction) => Promise<T>): Promise<T>;
}
export type RFQGuards = {
  trustedOrigin: (request: Request) => Promise<boolean> | boolean;
  allowRequest: (request: Request) => Promise<boolean> | boolean;
};
export type RFQDependencies = {
  catalog: readonly Product[];
  /** Optional public lookup for a future server path; no Mock fallback. */
  trustedCatalog?: RFQPublicCatalogLookup;
  repository: RFQRepository | null;
  guards: RFQGuards | null;
  catalogVerified: boolean;
  number?: () => string;
};

function json(status: number, body: object): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function unknownFields(value: unknown, allowed: readonly string[], prefix = ""): RFQValidationError[] {
  const field = prefix ? prefix.slice(0, -1) : "body";
  if (!plainRecord(value)) return [{ field, code: "INVALID_FORMAT" }];
  // Do not echo attacker-controlled key names; they could themselves contain PII.
  return Object.keys(value).some((key) => !allowed.includes(key))
    ? [{ field, code: "INVALID_FORMAT" }]
    : [];
}

function checkShape(input: unknown): RFQValidationError[] {
  const errors = unknownFields(input, ["contact", "buyerType", "requirements", "customization", "purchaseTimeline", "items"]);
  if (!plainRecord(input)) return errors;
  errors.push(...unknownFields(input.contact, ["fullName", "email", "companyName", "country", "whatsapp", "website"], "contact."));
  if (Array.isArray(input.items)) input.items.forEach((item, index) => {
    errors.push(...unknownFields(item, ["productId", "sku", "quantity"], `items[${index}].`));
  });
  return errors;
}

export function fingerprintRFQ(draft: RFQDraft): string {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const normalized = {
    contact: draft.contact,
    buyerType: draft.buyerType ?? null,
    requirements: draft.requirements,
    customization: [...(draft.customization ?? [])].sort(),
    purchaseTimeline: draft.purchaseTimeline ?? null,
    items: [...draft.items].sort((a, b) =>
      compare(a.productId, b.productId) || compare(a.sku ?? "", b.sku ?? "")
    ).map(({ productId, sku, quantity }) => ({ productId, sku: sku ?? null, quantity })),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export function makeRFQNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `RFQ-${date}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function readBody(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("INVALID_JSON");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RFQ_MAX_BODY_BYTES) throw new Error("BODY_TOO_LARGE");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("INVALID_JSON"); }
}

function validUUID(value: string | null): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function createRFQHandler(deps: RFQDependencies) {
  return async function POST(request: Request): Promise<Response> {
    // Mock catalog and absent production controls are deliberate launch gates.
    if (!deps.catalogVerified || !deps.repository || !deps.guards) return json(503, { error: "RFQ_UNAVAILABLE" });
    try {
      if (!await deps.guards.trustedOrigin(request)) return json(403, { error: "FORBIDDEN" });
      if (!await deps.guards.allowRequest(request)) return json(429, { error: "RATE_LIMITED" });
    } catch { return json(503, { error: "RFQ_UNAVAILABLE" }); }
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? ""))
      return json(415, { error: "UNSUPPORTED_MEDIA_TYPE" });
    const rawKey = request.headers.get("idempotency-key");
    if (!validUUID(rawKey)) return json(400, { error: "INVALID_IDEMPOTENCY_KEY" });
    const key = rawKey.toLowerCase();
    let input: unknown;
    try { input = await readBody(request); }
    catch (error) { return json(error instanceof Error && error.message === "BODY_TOO_LARGE" ? 413 : 400,
      { error: error instanceof Error && error.message === "BODY_TOO_LARGE" ? "BODY_TOO_LARGE" : "INVALID_JSON" }); }
    const shapeErrors = checkShape(input);
    if (shapeErrors.length) return json(422, { error: "VALIDATION_FAILED", fields: shapeErrors });
    const structured = validateRFQDraftStructure(input);
    if (!structured.ok) return json(422, { error: "VALIDATION_FAILED", fields: structured.errors });
    const fingerprint = fingerprintRFQ(structured.value);
    try {
      const outcome = await deps.repository.transaction(async (tx) => {
        const existing = await tx.findByKey(key);
        if (existing) return existing.fingerprint === fingerprint
          ? { status: 200 as const, record: existing }
          : { status: 409 as const };
        // Only a new key needs the live catalog. A historical key may replay
        // after its product or SKU is no longer offered.
        const checked = deps.trustedCatalog ? { ok: true as const, value: structured.value }
          : validateRFQDraft(structured.value, deps.catalog);
        if (!checked.ok) return { status: 422 as const, errors: checked.errors };
        let snapshots;
        if (deps.trustedCatalog) {
          try { snapshots = await snapshotRFQItemsFromPublicCatalog(checked.value.items, deps.trustedCatalog); }
          catch (error) {
            if (error instanceof CatalogReadError && (error.code === "NOT_FOUND" || error.code === "INVALID_INPUT"))
              return { status: 422 as const, errors: [{ field: "items", code: "INVALID_PRODUCT" as const }] };
            throw error;
          }
        } else snapshots = snapshotRFQItems(checked.value.items, deps.catalog);
        if (!snapshots.ok) return { status: 422 as const, errors: snapshots.errors };
        const record = await tx.insertRequestIfAbsent({ key, fingerprint,
          rfqNumber: (deps.number ?? makeRFQNumber)(), draft: checked.value, items: snapshots.value });
        if (record) {
          await tx.insertItems(record.id, snapshots.value);
          await tx.insertNotificationJob(record.id);
          return { status: 201 as const, record };
        }
        const prior = await tx.findByKey(key);
        if (!prior) throw new Error("INCONSISTENT_IDEMPOTENCY_STATE");
        return prior.fingerprint === fingerprint
          ? { status: 200 as const, record: prior }
          : { status: 409 as const };
      });
      if (outcome.status === 409) return json(409, { error: "IDEMPOTENCY_CONFLICT" });
      if (outcome.status === 422) return json(422, { error: "VALIDATION_FAILED", fields: outcome.errors });
      const { id, rfqNumber, status, createdAt } = outcome.record;
      return json(outcome.status, { id, rfqNumber, status, createdAt, replayed: outcome.status === 200 });
    } catch { return json(503, { error: "RFQ_UNAVAILABLE" }); }
  };
}
