import "server-only";
import { createCatalogReadRepository } from "./repository-core.ts";
import { notConfiguredCatalogSource } from "./offline.ts";
import { createAdminAuthClient } from "../admin/supabase-server.ts";
import { adminDependencies } from "../admin/server-access.ts";
import { getServerAdminCursorCodec } from "./server-cursor.ts";

/** Trusted server wiring only. B2-A still has no database adapter or credentials. */
export async function createServerCatalogReadRepository() {
  const client = await createAdminAuthClient();
  return createCatalogReadRepository(notConfiguredCatalogSource,
    client ? { session: client, dependencies: adminDependencies(client) } : null,
    getServerAdminCursorCodec());
}
