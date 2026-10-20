import { isReadableProductCode, MAX_PRODUCT_CODE_LENGTH } from "../catalog-read/product-code.ts";

/** Opaque single segment avoids slash, percent, and Unicode path decoding ambiguity. */
export function encodeProductCodeSegment(code: string): string {
  return Buffer.from(code, "utf8").toString("base64url");
}

export function decodeProductCodeSegment(segment: string): string | null {
  if (segment.length > MAX_PRODUCT_CODE_LENGTH * 4 + 16 ||
    !/^[A-Za-z0-9_-]+$/.test(segment)) return null;
  try {
    const bytes = Buffer.from(segment, "base64url");
    if (bytes.toString("base64url") !== segment) return null;
    const code = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return isReadableProductCode(code) ? code : null;
  } catch { return null; }
}
