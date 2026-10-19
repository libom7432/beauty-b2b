import "server-only";
import { createAdminCursorCodec, type AdminCursorCodec } from "./admin-cursor.ts";
import { CatalogReadError } from "./errors.ts";

/** Only trusted server wiring reads this deployment secret. Missing or malformed means no Admin listing. */
export function getServerAdminCursorCodec(): AdminCursorCodec | null {
  try { return createAdminCursorCodec(process.env.ADMIN_CATALOG_CURSOR_SIGNING_KEY ?? ""); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "NOT_CONFIGURED") return null;
    throw error;
  }
}
