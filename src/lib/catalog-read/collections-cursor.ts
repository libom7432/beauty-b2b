import { createHmac, timingSafeEqual } from "node:crypto";
import { CatalogReadError } from "./errors.ts";
import type { CatalogStatus } from "./types.ts";

export const COLLECTION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COLLECTION_CURSOR_MAX_LENGTH = 512;
const INT32 = (value: unknown): value is number => Number.isInteger(value) &&
  typeof value === "number" && value >= -2147483648 && value <= 2147483647;
export type CollectionCursorContext = Readonly<{ kind: "collections" | "members";
  status: CatalogStatus | null; collectionId: string | null; direction: "after" | "before" }>;
export type CollectionBoundary = Readonly<{ sortOrder: number; id: string }>;
export type CollectionCursorReference = CollectionBoundary & Readonly<{ includeBoundary: boolean }>;
export interface CollectionCursorCodec {
  issue(context: CollectionCursorContext, boundary: CollectionBoundary, includeBoundary?: boolean): string;
  verify(value: string, context: CollectionCursorContext): CollectionCursorReference;
}
const invalid = (): never => { throw new CatalogReadError("INVALID_INPUT"); };
const validContext = (context: CollectionCursorContext) =>
  (context.kind === "collections" && context.collectionId === null &&
    (context.status === null || ["draft", "published", "retired"].includes(context.status)) ||
    context.kind === "members" && context.status === null &&
    typeof context.collectionId === "string" && COLLECTION_UUID.test(context.collectionId)) &&
  (context.direction === "after" || context.direction === "before");

/** Same server secret as Admin V2, with a distinct signed domain and bounded payload. */
export function createCollectionCursorCodec(encodedKey: string): CollectionCursorCodec {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw new CatalogReadError("NOT_CONFIGURED");
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encodedKey)
    throw new CatalogReadError("NOT_CONFIGURED");
  const sign = (payload: string) => createHmac("sha256", key).update(payload, "utf8").digest();
  return {
    issue(context, boundary, includeBoundary = false) {
      if (!validContext(context) || !INT32(boundary.sortOrder) || !COLLECTION_UUID.test(boundary.id) ||
        typeof includeBoundary !== "boolean")
        throw new CatalogReadError("INTERNAL_ERROR");
      const payload = JSON.stringify([2, "admin-collections", context.kind, context.status,
        context.collectionId?.toLowerCase() ?? null, context.direction,
        boundary.sortOrder, boundary.id.toLowerCase(), includeBoundary]);
      const cursor = `${Buffer.from(payload).toString("base64url")}.${sign(payload).toString("base64url")}`;
      if (cursor.length > COLLECTION_CURSOR_MAX_LENGTH) throw new CatalogReadError("INTERNAL_ERROR");
      return cursor;
    },
    verify(value, context) {
      if (!validContext(context) || typeof value !== "string" ||
        value.length > COLLECTION_CURSOR_MAX_LENGTH ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return invalid();
      const [encodedPayload, encodedSignature] = value.split(".");
      const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
      if (Buffer.from(payload).toString("base64url") !== encodedPayload) return invalid();
      const signature = Buffer.from(encodedSignature, "base64url");
      if (signature.length !== 32 || signature.toString("base64url") !== encodedSignature ||
        !timingSafeEqual(sign(payload), signature)) return invalid();
      let fields: unknown;
      try { fields = JSON.parse(payload); } catch { return invalid(); }
      if (!Array.isArray(fields) || fields.length !== 9 || fields[0] !== 2 ||
        fields[1] !== "admin-collections" || fields[2] !== context.kind ||
        fields[3] !== context.status || fields[4] !== (context.collectionId?.toLowerCase() ?? null) ||
        fields[5] !== context.direction || !INT32(fields[6]) ||
        typeof fields[7] !== "string" || !COLLECTION_UUID.test(fields[7]) ||
        typeof fields[8] !== "boolean") return invalid();
      return { sortOrder: fields[6], id: fields[7], includeBoundary: fields[8] };
    },
  };
}
