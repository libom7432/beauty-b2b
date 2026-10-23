import "server-only";
import { createAdminCursorCodec, type AdminCursorCodec } from "./admin-cursor.ts";
import { createCollectionCursorCodec, type CollectionCursorCodec } from "./collections-cursor.ts";
import { CatalogReadError } from "./errors.ts";

/** Only trusted server wiring reads this deployment secret. Missing or malformed means no Admin listing. */
export function getServerAdminCursorCodec(): AdminCursorCodec | null {
  try { return createAdminCursorCodec(process.env.ADMIN_CATALOG_CURSOR_SIGNING_KEY ?? ""); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "NOT_CONFIGURED") return null;
    throw error;
  }
}

/** Collections use a separate signed domain; no secret is sent to a browser. */
export function getServerCollectionCursorCodec(): CollectionCursorCodec | null {
  try { return createCollectionCursorCodec(process.env.ADMIN_CATALOG_CURSOR_SIGNING_KEY ?? ""); }
  catch (error) {
    if (error instanceof CatalogReadError && error.code === "NOT_CONFIGURED") return null;
    throw error;
  }
}
