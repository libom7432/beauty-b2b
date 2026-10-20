/** Matches the existing import field limit and its trimmed, non-control Product Code rule. */
export const MAX_PRODUCT_CODE_LENGTH = 32_768;
export const MAX_ADMIN_CURSOR_LENGTH = 1024;

export function isReadableProductCode(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_PRODUCT_CODE_LENGTH && value.trim() === value &&
    !/[\p{Cc}]/u.test(value);
}
