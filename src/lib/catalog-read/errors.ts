export type CatalogReadErrorCode = "NOT_CONFIGURED" | "NOT_FOUND" | "FORBIDDEN" |
  "INVALID_INPUT" | "SOURCE_UNAVAILABLE" | "INTERNAL_ERROR";
export class CatalogReadError extends Error {
  readonly code: CatalogReadErrorCode;
  constructor(code: CatalogReadErrorCode) {
    super(({ NOT_CONFIGURED: "Catalog is not connected", NOT_FOUND: "Product not found",
      FORBIDDEN: "Access denied", INVALID_INPUT: "Invalid catalog query",
      SOURCE_UNAVAILABLE: "Catalog is temporarily unavailable",
      INTERNAL_ERROR: "Catalog could not be read" })[code]);
    this.name = "CatalogReadError";
    this.code = code;
  }
}
