import "server-only";
import { createCatalogReadRepository } from "./repository-core.ts";
import { notConfiguredCatalogSource } from "./offline.ts";
import type { CatalogAuthDependencies } from "../catalog-import/admin-auth.ts";

/** Server entrypoint. B1 has no database adapter or credentials. */
export function createServerCatalogReadRepository(admin: Readonly<{
  session: unknown; dependencies: CatalogAuthDependencies }> | null = null) {
  return createCatalogReadRepository(notConfiguredCatalogSource, admin);
}
