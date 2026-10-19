import { createHmac, timingSafeEqual } from "node:crypto";
import { CatalogReadError } from "./errors.ts";
import type { CatalogSort } from "./types.ts";

export type AdminCursorBoundary = Readonly<{ id: string; timestamp: string | null; productCode: string | null }>;
export type AdminCursorContext = Readonly<{ sort: CatalogSort; filter: string; direction: "after" | "before" }>;
export interface AdminCursorCodec {
  issue(context: AdminCursorContext, boundary: AdminCursorBoundary): string;
  verify(value: string, context: AdminCursorContext): AdminCursorBoundary;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const invalid = (): never => { throw new CatalogReadError("INVALID_INPUT"); };
const codeSort = (sort: CatalogSort) => sort === "product_code_asc" || sort === "product_code_desc";

/** A random 32-byte base64url key is required; no development or production fallback exists. */
export function createAdminCursorCodec(encodedKey: string): AdminCursorCodec {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw new CatalogReadError("NOT_CONFIGURED");
  const key = Buffer.from(encodedKey, "base64url");
  if (key.length !== 32 || key.toString("base64url") !== encodedKey)
    throw new CatalogReadError("NOT_CONFIGURED");
  const signature = (payload: string) => createHmac("sha256", key).update(payload, "utf8").digest();
  return {
    issue(context, boundary) {
      if (!UUID.test(boundary.id) || (codeSort(context.sort)
        ? !boundary.productCode || !codePattern.test(boundary.productCode)
        : !boundary.timestamp || !timestampPattern.test(boundary.timestamp) ||
          !Number.isFinite(Date.parse(boundary.timestamp)))) throw new CatalogReadError("INTERNAL_ERROR");
      const payload = JSON.stringify([2, "admin", context.sort, context.filter, context.direction,
        boundary.id, codeSort(context.sort) ? null : boundary.timestamp,
        codeSort(context.sort) ? boundary.productCode : null]);
      return `${Buffer.from(payload, "utf8").toString("base64url")}.${signature(payload).toString("base64url")}`;
    },
    verify(value, context) {
      if (value.length > 1024 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(value)) return invalid();
      const [encodedPayload, encodedSignature] = value.split(".");
      const payload = Buffer.from(encodedPayload, "base64url").toString("utf8");
      if (Buffer.from(payload, "utf8").toString("base64url") !== encodedPayload) return invalid();
      const actual = Buffer.from(encodedSignature, "base64url");
      if (actual.length !== 32 || actual.toString("base64url") !== encodedSignature ||
        !timingSafeEqual(signature(payload), actual)) return invalid();
      let fields: unknown;
      try { fields = JSON.parse(payload); } catch { return invalid(); }
      if (!Array.isArray(fields) || fields.length !== 8 || fields[0] !== 2 || fields[1] !== "admin" ||
        fields[2] !== context.sort || fields[3] !== context.filter || fields[4] !== context.direction ||
        typeof fields[5] !== "string" || !UUID.test(fields[5]) ||
        (codeSort(context.sort)
          ? fields[6] !== null || typeof fields[7] !== "string" || !codePattern.test(fields[7])
          : typeof fields[6] !== "string" || !timestampPattern.test(fields[6]) ||
            !Number.isFinite(Date.parse(fields[6])) || fields[7] !== null)) return invalid();
      return { id: fields[5], timestamp: fields[6], productCode: fields[7] };
    },
  };
}
