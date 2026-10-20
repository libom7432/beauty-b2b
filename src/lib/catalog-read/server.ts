import "server-only";
import { createCatalogReadRepository } from "./repository-core.ts";
import { notConfiguredCatalogSource } from "./offline.ts";
import { createAdminAuthClient } from "../admin/supabase-server.ts";
import { adminDependencies } from "../admin/server-access.ts";
import { getServerAdminCursorCodec } from "./server-cursor.ts";
import { getSupabaseCatalogReadSource } from "./postgres-supabase.ts";
import { CatalogReadError } from "./errors.ts";

/** Trusted server wiring. Missing approval/configuration remains Not Connected. */
export async function createServerCatalogReadRepository() {
  const client = await createAdminAuthClient();
  let source = notConfiguredCatalogSource;
  if (process.env.CATALOG_READ_SOURCE === "supabase" && process.env.NODE_ENV === "production") {
    try { source = getSupabaseCatalogReadSource(); }
    catch (error) {
      if (!(error instanceof CatalogReadError && error.code === "NOT_CONFIGURED")) throw error;
    }
  }
  return createCatalogReadRepository(source,
    client ? { session: client, dependencies: adminDependencies(client) } : null,
    getServerAdminCursorCodec());
}
