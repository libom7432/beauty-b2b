import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { CatalogReadError } from "./errors.ts";
import type { CatalogSort, ProductRow } from "./types.ts";

export type AdminCursorReference = Readonly<{ id: string; witness: string }>;
export type AdminCursorBoundary = Readonly<{ id: string; timestamp: string; productCode: string }>;
export type AdminCursorContext = Readonly<{ sort: CatalogSort; filter: string; direction: "after" | "before" }>;
export interface AdminCursorCodec {
  issue(context: AdminCursorContext, product: ProductRow): string;
  verify(value: string, context: AdminCursorContext): AdminCursorReference;
}

export const ADMIN_CURSOR_V2_MAX_LENGTH = 1024;
export const ADMIN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WITNESS = /^[a-f0-9]{64}$/;
const adminSort = (value: CatalogSort) => ["updated", "updated_desc", "updated_asc",
  "product_code_asc", "product_code_desc"].includes(value);
const invalid = (): never => { throw new CatalogReadError("INVALID_INPUT"); };

/** Detect changes to product fields that can affect Admin sorting or status/type filtering. */
export function adminBoundaryWitness(product: ProductRow): string {
  return createHash("sha256").update(JSON.stringify([
    product.id.toLowerCase(), product.product_code, product.updated_at,
    product.status, product.product_type,
  ]), "utf8").digest("hex");
}

/** V2 has a fixed-size boundary reference. The former signed code-bearing payload is rejected. */
export function createAdminCursorCodec(encodedKey: string): AdminCursorCodec {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw new CatalogReadError("NOT_CONFIGURED");
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encodedKey)
    throw new CatalogReadError("NOT_CONFIGURED");
  const signature = (payload: string) => createHmac("sha256", key).update(payload, "utf8").digest();
  return {
    issue(context, product) {
      if (!ADMIN_UUID.test(product.id) || !WITNESS.test(context.filter) ||
        !adminSort(context.sort) || !["after", "before"].includes(context.direction))
        throw new CatalogReadError("INTERNAL_ERROR");
      const payload = JSON.stringify([2, "admin-v2", context.sort, context.filter,
        context.direction, product.id.toLowerCase(), adminBoundaryWitness(product)]);
      const cursor = `${Buffer.from(payload, "utf8").toString("base64url")}.${signature(payload).toString("base64url")}`;
      if (cursor.length > ADMIN_CURSOR_V2_MAX_LENGTH) throw new CatalogReadError("INTERNAL_ERROR");
      return cursor;
    },
    verify(value, context) {
      if (value.length > ADMIN_CURSOR_V2_MAX_LENGTH ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return invalid();
      const [encodedPayload, encodedSignature] = value.split(".");
      const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
      if (Buffer.from(payload, "utf8").toString("base64url") !== encodedPayload) return invalid();
      const actual = Buffer.from(encodedSignature, "base64url");
      if (actual.length !== 32 || actual.toString("base64url") !== encodedSignature ||
        !timingSafeEqual(signature(payload), actual)) return invalid();
      let fields: unknown;
      try { fields = JSON.parse(payload); } catch { return invalid(); }
      if (!Array.isArray(fields) || fields.length !== 7 || fields[0] !== 2 ||
        fields[1] !== "admin-v2" || fields[2] !== context.sort || fields[3] !== context.filter ||
        fields[4] !== context.direction || typeof fields[5] !== "string" ||
        !ADMIN_UUID.test(fields[5]) || typeof fields[6] !== "string" || !WITNESS.test(fields[6]))
        return invalid();
      return { id: fields[5], witness: fields[6] };
    },
  };
}
